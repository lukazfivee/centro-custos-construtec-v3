const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const mockUrl = pathToFileURL(path.join(__dirname, '..', 'scripts', 'mock-central-auth.mjs')).href;
const HEADERS = { 'content-type': 'application/json', 'x-instance-id': '5b0e8a7e-0000-4000-8000-000000000001', 'x-instance-name': 'Android · Teste Mock', 'x-client': 'suite-android/test' };

async function start(options) {
  const { createMockCentral, DEMO_USERS } = await import(mockUrl);
  const server = createMockCentral(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, route, body, token, extra = {}) => {
    const headers = { ...HEADERS, ...extra };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(base + route, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  const login = () => call('POST', '/v1/auth/login', { email: DEMO_USERS[0].email, password: DEMO_USERS[0].password });
  return { server, call, login, demo: DEMO_USERS[0], close: () => new Promise((r) => server.close(r)) };
}

test('mock: login, credencial invalida e conta legada', async (t) => {
  const m = await start();
  t.after(m.close);
  const ok = await m.login();
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
  assert.ok(ok.json.sessionToken.length >= 40);
  assert.ok(ok.json.expiresAt > Date.now() / 1000);
  assert.equal(ok.json.user.email, m.demo.email);
  assert.equal((await m.call('POST', '/v1/auth/login', { email: m.demo.email, password: 'errada' })).status, 401);
  const legacy = await m.call('POST', '/v1/auth/login', { email: 'legado@rcconstrutec.com.br', password: m.demo.password });
  assert.equal(legacy.status, 409);
  assert.equal(legacy.json.code, 'PASSWORD_PROFILE_LEGACY');
});

test('mock: sessao, lista de aparelhos e sair dos outros', async (t) => {
  const m = await start();
  t.after(m.close);
  const first = (await m.login()).json.sessionToken;
  const second = (await m.login()).json.sessionToken;
  const session = await m.call('GET', '/v1/auth/session', null, first);
  assert.equal(session.status, 200);
  assert.equal(session.json.user.name, 'Maria Clara Souza');
  const list = await m.call('GET', '/v1/auth/sessions', null, first);
  assert.equal(list.json.sessions.length, 2);
  assert.equal(list.json.sessions.filter((s) => s.current).length, 1);
  assert.equal(JSON.stringify(list.json).includes(first), false);
  const revoked = await m.call('POST', '/v1/auth/sessions/revoke-others', {}, first);
  assert.deepEqual(revoked.json, { ok: true, revoked: 1 });
  assert.equal((await m.call('GET', '/v1/auth/session', null, second)).json.code, 'SESSION_INVALID');
  assert.equal((await m.call('GET', '/v1/auth/session', null, first)).status, 200);
});

test('mock: redefinicao de senha com uso unico, senha fraca e revogacao', async (t) => {
  const m = await start();
  t.after(m.close);
  const token = (await m.login()).json.sessionToken;
  const unknown = await m.call('POST', '/v1/auth/password-reset/request', { email: 'ninguem@rcconstrutec.com.br' });
  assert.equal(unknown.status, 202);
  assert.equal(m.server.mock.outbox.length, 0);
  assert.equal((await m.call('POST', '/v1/auth/password-reset/request', { email: m.demo.email })).status, 202);
  const resetToken = m.server.mock.outbox[0].token;
  const weak = await m.call('POST', '/v1/auth/password-reset/confirm', { token: resetToken, password: 'fraca' });
  assert.equal(weak.json.code, 'WEAK_PASSWORD');
  const done = await m.call('POST', '/v1/auth/password-reset/confirm', { token: resetToken, password: 'NovaSenha1' });
  assert.deepEqual(done.json, { ok: true, revokedSessions: 1 });
  assert.equal((await m.call('GET', '/v1/auth/session', null, token)).status, 401);
  const reused = await m.call('POST', '/v1/auth/password-reset/confirm', { token: resetToken, password: 'NovaSenha1' });
  assert.equal(reused.json.code, 'TOKEN_INVALID');
  const relogin = await m.call('POST', '/v1/auth/login', { email: m.demo.email, password: 'NovaSenha1' });
  assert.equal(relogin.status, 200);
});

test('mock: reenvio respeita 60s e o link expira em 30 min', async (t) => {
  let clock = Date.now();
  const m = await start({ now: () => clock });
  t.after(m.close);
  await m.call('POST', '/v1/auth/password-reset/request', { email: m.demo.email });
  await m.call('POST', '/v1/auth/password-reset/request', { email: m.demo.email });
  assert.equal(m.server.mock.outbox.length, 1);
  clock += 61 * 1000;
  await m.call('POST', '/v1/auth/password-reset/request', { email: m.demo.email });
  assert.equal(m.server.mock.outbox.length, 2);
  const stale = m.server.mock.outbox[0].token;
  assert.equal((await m.call('POST', '/v1/auth/password-reset/confirm', { token: stale, password: 'NovaSenha1' })).json.code, 'TOKEN_INVALID');
  clock += 31 * 60 * 1000;
  const late = await m.call('POST', '/v1/auth/password-reset/confirm', { token: m.server.mock.outbox[1].token, password: 'NovaSenha1' });
  assert.equal(late.json.code, 'TOKEN_EXPIRED');
});

test('mock: handoff e de uso unico e nao exige token no consumo', async (t) => {
  const m = await start();
  t.after(m.close);
  const token = (await m.login()).json.sessionToken;
  const handoff = await m.call('POST', '/v1/auth/handoff', { target: 'centro-custos' }, token);
  assert.equal(handoff.status, 200);
  assert.ok(handoff.json.expiresAt - Date.now() / 1000 <= 61);
  const consumed = await m.call('POST', '/v1/auth/handoff/consume', { code: handoff.json.code });
  assert.equal(consumed.json.ok, true);
  assert.equal(consumed.json.usuario.email, m.demo.email);
  const again = await m.call('POST', '/v1/auth/handoff/consume', { code: handoff.json.code });
  assert.equal(again.json.code, 'HANDOFF_INVALID');
  assert.equal((await m.call('POST', '/v1/auth/handoff', { target: 'centro-custos' })).status, 401);
});

test('mock: serve as telas locais sem sair da pasta de assets', async (t) => {
  const m = await start();
  t.after(m.close);
  const { port } = m.server.address();
  const ok = await fetch(`http://127.0.0.1:${port}/auth/rules.js`);
  assert.equal(ok.status, 200);
  const escape = await fetch(`http://127.0.0.1:${port}/auth/..%2F..%2FAndroidManifest.xml`);
  assert.equal(escape.status, 404);
});
