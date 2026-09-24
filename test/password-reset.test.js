const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./password-reset-fixture.test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const vm = require('node:vm');

function captureEmail(t, env) {
  const original = global.fetch;
  const sent = [];
  env.EMAIL_PROVIDER_API_KEY = 'test-key';
  env.EMAIL_FROM = 'no-reply@rcconstrutec.com.br';
  global.fetch = async (_url, options) => { sent.push(JSON.parse(options.body)); return Response.json({ id: 'test' }); };
  t.after(() => { global.fetch = original; });
  return sent;
}
function linkToken(sent, index = 0) {
  return new URL(sent[index].text.match(/https:\/\/[^\s]+/)[0]).hash.slice(3);
}

test('pedido é genérico inclusive para e-mail inexistente e sem segredo', async () => {
  const { env, call, email } = await setup();
  assert.deepEqual(await call('POST', '/v1/auth/password-reset/request', { body: { email } }), { status: 202, data: { ok: true } });
  assert.deepEqual(await call('POST', '/v1/auth/password-reset/request', { body: { email: 'ausente@rcconstrutec.com.br' } }), { status: 202, data: { ok: true } });
  const rows = env.DB.raw.prepare('SELECT token_hash FROM password_reset_tokens').all();
  assert.equal(rows.length, 1);
  assert.match(rows[0].token_hash, /^[a-f0-9]{64}$/);
});

test('limites por e-mail e IP respondem 202 sem envio', async (t) => {
  const { env, call, email } = await setup();
  const sent = captureEmail(t, env);
  let now = Date.now();
  const original = Date.now;
  Date.now = () => now;
  t.after(() => { Date.now = original; });
  for (let i = 0; i < 4; i += 1) {
    assert.equal((await call('POST', '/v1/auth/password-reset/request', { body: { email } })).status, 202);
    now += 61_000;
  }
  assert.equal(sent.length, 3);
  const source = env.DB.raw.prepare('SELECT * FROM cloud_users LIMIT 1').get();
  for (let i = 0; i < 8; i += 1) {
    const extraEmail = `outro${i}@rcconstrutec.com.br`;
    env.DB.raw.prepare(`INSERT INTO cloud_users(id,org_id,name,email,password_salt,password_hash,password_iterations,role,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(`user-${i}`, source.org_id, 'Outro', extraEmail,
      source.password_salt, source.password_hash, source.password_iterations, source.role, 1, source.created_at, source.updated_at);
    await call('POST', '/v1/auth/password-reset/request', { body: { email: extraEmail } });
  }
  assert.equal(sent.length, 9, 'seis novos envios completam o limite de dez requisições no IP');
  assert.equal(env.DB.raw.prepare("SELECT count FROM mobile_auth_limits WHERE bucket LIKE 'reset-ip:%'").get().count, 12);
});

test('reenvio antes de 60 s não envia e novo pedido invalida token anterior', async (t) => {
  const { env, call, email } = await setup();
  const sent = captureEmail(t, env);
  let now = Date.now(); const original = Date.now; Date.now = () => now; t.after(() => { Date.now = original; });
  await call('POST', '/v1/auth/password-reset/request', { body: { email } });
  now += 59_000;
  await call('POST', '/v1/auth/password-reset/request', { body: { email } });
  assert.equal(sent.length, 1);
  now += 2_000;
  await call('POST', '/v1/auth/password-reset/request', { body: { email } });
  assert.equal(sent.length, 2);
  const old = await call('POST', '/v1/auth/password-reset/confirm', { body: { token: linkToken(sent), password: 'NovaSenha1!' } });
  assert.equal(old.data.code, 'TOKEN_INVALID');
});

test('confirmação válida troca senha, revoga todas as sessões e impede reuso', async (t) => {
  const { env, call, email, password, token } = await setup();
  const sent = captureEmail(t, env);
  const second = await call('POST', '/v1/auth/login', { body: { email, password } });
  await call('POST', '/v1/auth/password-reset/request', { body: { email } });
  const reset = linkToken(sent);
  const weak = await call('POST', '/v1/auth/password-reset/confirm', { body: { token: reset, password: 'abc' } });
  assert.equal(weak.data.code, 'WEAK_PASSWORD');
  const confirmed = await call('POST', '/v1/auth/password-reset/confirm', { body: { token: reset, password: 'NovaSenha1!' } });
  assert.deepEqual(confirmed, { status: 200, data: { ok: true, revokedSessions: 2 } });
  assert.equal((await call('GET', '/v1/auth/session', { token })).status, 401);
  assert.equal((await call('GET', '/v1/auth/session', { token: second.data.sessionToken })).status, 401);
  assert.equal((await call('POST', '/v1/auth/password-reset/confirm', { body: { token: reset, password: 'OutraSenha1!' } })).data.code, 'TOKEN_INVALID');
  assert.equal((await call('POST', '/v1/auth/login', { body: { email, password } })).status, 401);
  assert.equal((await call('POST', '/v1/auth/login', { body: { email, password: 'NovaSenha1!' } })).status, 200);
});

test('token expirado retorna TOKEN_EXPIRED', async (t) => {
  const { env, call, email } = await setup();
  const sent = captureEmail(t, env);
  await call('POST', '/v1/auth/password-reset/request', { body: { email } });
  env.DB.raw.exec('UPDATE password_reset_tokens SET expires_at=0');
  const expired = await call('POST', '/v1/auth/password-reset/confirm', { body: { token: linkToken(sent), password: 'NovaSenha1!' } });
  assert.equal(expired.status, 400);
  assert.equal(expired.data.code, 'TOKEN_EXPIRED');
});

test('página de redefinição tem script válido e assetlinks depende do certificado', async () => {
  const page = await import(pathToFileURL(path.join(__dirname, '..', 'cloudflare', 'center-container', 'resetPage.js')).href);
  const response = page.resetPage();
  const html = await response.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script));
  assert.ok(script.includes('/\\d/'));
  const checks = vm.runInNewContext(`${script.match(/const checks=([^;]+);/)[0]} checks`);
  assert.deepEqual(Array.from(checks, (check) => check('Senha123!')), [true, true, true, true]);
  assert.equal(page.assetLinks({}).status, 404);
  const certificate = Array(32).fill('AB').join(':');
  const asset = await page.assetLinks({ ANDROID_CERT_SHA256: certificate }).json();
  assert.equal(asset[0].target.sha256_cert_fingerprints[0], certificate);
});
