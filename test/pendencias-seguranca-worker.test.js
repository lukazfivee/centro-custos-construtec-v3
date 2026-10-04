// Pendencias da revisao de seguranca (A4 e M1) no Worker: limite de login pelo IP real repassado e por
// e-mail, e a lista `apps` da conta valendo no login do Centro e no handoff.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, hasSQLite } = require('./password-reset-fixture.test');
const maybe = hasSQLite ? test : test.skip;

const KEY = 'o'.repeat(40);
const service = (ip, extra = {}) => ({ 'x-construtec-identity-key': KEY, 'x-construtec-client-ip': ip, ...extra });

async function withKey() {
  const ctx = await setup();
  ctx.env.CONSTRUTEC_IDENTITY_KEY = KEY;
  return ctx;
}

const wrong = (n) => ({ email: `ninguem${n}@rcconstrutec.com.br`, password: 'errada-123456' });

// ---- A4: limite por IP real e por e-mail ----

maybe('A4: IP repassado sem a chave de servico e ignorado (cliente comum nao forja o cabecalho)', async () => {
  const { call } = await withKey();
  // O setup ja gastou 1 do balde do IP de borda; o cabecalho forjado nao abre baldes novos.
  let status = 401;
  let tentativas = 0;
  while (status === 401 && tentativas < 70) {
    tentativas += 1;
    status = (await call('POST', '/v1/auth/login', { body: wrong(tentativas), headers: { 'x-construtec-client-ip': `198.51.100.${tentativas}` } })).status;
  }
  assert.equal(status, 429);
  assert.ok(tentativas <= 60, `bloqueou em ${tentativas}`);
});

maybe('A4: com a chave de servico, o limite usa o IP real e um IP esgotado nao trava os outros', async () => {
  const { call, email, password } = await withKey();
  for (let i = 0; i < 60; i += 1) {
    const r = await call('POST', '/v1/auth/login', { body: wrong(i), headers: service('198.51.100.1') });
    assert.equal(r.status, 401);
  }
  assert.equal((await call('POST', '/v1/auth/login', { body: wrong(100), headers: service('198.51.100.1') })).status, 429);
  // Outra pessoa, mesmo IP de saida do Container, entra normalmente.
  const ok = await call('POST', '/v1/auth/login', { body: { email, password }, headers: service('198.51.100.2') });
  assert.equal(ok.status, 200);
  // Cabecalho de IP malformado cai no IP de borda (que aqui nao esta esgotado).
  const bad = await call('POST', '/v1/auth/login', { body: { email, password }, headers: service('<script>', { 'x-construtec-client-ip': '<script>' }) });
  assert.equal(bad.status, 200);
});

maybe('A4: 10 falhas por e-mail travam esse e-mail em qualquer IP, sem afetar os outros', async () => {
  const { call, email, password } = await withKey();
  for (let i = 0; i < 10; i += 1) {
    const r = await call('POST', '/v1/auth/login', { body: { email, password: 'errada-123456' }, headers: service(`198.51.100.${i + 1}`) });
    assert.equal(r.status, 401, `tentativa ${i + 1}`);
  }
  const travado = await call('POST', '/v1/auth/login', { body: { email, password }, headers: service('198.51.100.77') });
  assert.equal(travado.status, 429);
  assert.equal(travado.data.code, 'RATE_LIMITED');
  const outro = await call('POST', '/v1/auth/login', { body: wrong(1), headers: service('198.51.100.77') });
  assert.equal(outro.status, 401);
});

maybe('A4: fluxo legitimo intacto, poucas falhas e logins corretos nao travam', async () => {
  const { call, email, password } = await withKey();
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await call('POST', '/v1/auth/login', { body: { email, password: 'errada-123456' } })).status, 401);
  }
  for (let i = 0; i < 12; i += 1) {
    assert.equal((await call('POST', '/v1/auth/login', { body: { email, password } })).status, 200, `login ${i + 1}`);
  }
});

// ---- M1: apps da conta ----

const setApps = (env, email, apps) => env.DB.raw.prepare('UPDATE cloud_users SET apps=? WHERE email=?').run(apps === null ? null : JSON.stringify(apps), email);

maybe('M1: login do Centro exige o app centro; Orcamentos usa a chave de servico sem cabecalho de app', async () => {
  const { env, call, email, password } = await withKey();
  setApps(env, email, ['orcamentos']);
  const direto = await call('POST', '/v1/auth/login', { body: { email, password } });
  assert.equal(direto.status, 403);
  assert.equal(direto.data.code, 'APP_NOT_ALLOWED');
  assert.match(direto.data.error, /Centro de Custos/);
  const container = await call('POST', '/v1/auth/login', { body: { email, password }, headers: service('198.51.100.5', { 'x-construtec-app': 'centro' }) });
  assert.equal(container.status, 403);
  // Senha errada continua sendo 401 (a resposta nao revela o acesso por app).
  assert.equal((await call('POST', '/v1/auth/login', { body: { email, password: 'errada-123456' } })).status, 401);
  // O Orcamentos (chave sem cabecalho de app) entra: quem decide o app dele e o proprio Orcamentos.
  assert.equal((await call('POST', '/v1/auth/login', { body: { email, password }, headers: service('198.51.100.5') })).status, 200);
  setApps(env, email, ['centro']);
  assert.equal((await call('POST', '/v1/auth/login', { body: { email, password } })).status, 200);
  assert.equal((await call('POST', '/v1/auth/login', { body: { email, password }, headers: service('198.51.100.5', { 'x-construtec-app': 'centro' }) })).status, 200);
});

maybe('M1: conta antiga sem apps definido (ou com os dois) entra normalmente', async () => {
  const { env, call, email, password } = await withKey();
  setApps(env, email, null);
  assert.equal((await call('POST', '/v1/auth/login', { body: { email, password } })).status, 200);
  setApps(env, email, ['centro', 'orcamentos']);
  assert.equal((await call('POST', '/v1/auth/login', { body: { email, password } })).status, 200);
});

maybe('M1: handoff so sai e so entra para app que a conta tem', async () => {
  const { env, call, email, password, token } = await withKey();
  // Os dois apps: emite os dois destinos.
  assert.equal((await call('POST', '/v1/auth/handoff', { token, body: { target: 'centro-custos' } })).status, 200);
  assert.equal((await call('POST', '/v1/auth/handoff', { token, body: { target: 'orcamentos' } })).status, 200);

  setApps(env, email, ['orcamentos']);
  const centro = await call('POST', '/v1/auth/handoff', { token, body: { target: 'centro-custos' } });
  assert.equal(centro.status, 403);
  assert.equal(centro.data.code, 'APP_NOT_ALLOWED');
  assert.equal((await call('POST', '/v1/auth/handoff', { token, body: { target: 'orcamentos' } })).status, 200);

  setApps(env, email, ['centro']);
  const orc = await call('POST', '/v1/auth/handoff', { token, body: { target: 'orcamentos' } });
  assert.equal(orc.status, 403);
  assert.match(orc.data.error, /Orçamentos/);
  assert.equal((await call('POST', '/v1/auth/handoff', { token, body: { target: 'centro-custos' } })).status, 200);

  // Codigo emitido antes da revogacao do app nao e trocado depois dela.
  setApps(env, email, null);
  const emitido = await call('POST', '/v1/auth/handoff', { token, body: { target: 'orcamentos' } });
  assert.equal(emitido.status, 200);
  setApps(env, email, ['centro']);
  const consumo = await call('POST', '/v1/auth/handoff/consume', { headers: { 'x-construtec-identity-key': KEY }, body: { code: emitido.data.code, target: 'orcamentos' } });
  assert.equal(consumo.status, 403);
  assert.equal(consumo.data.code, 'APP_NOT_ALLOWED');
  assert.ok(password);
});
