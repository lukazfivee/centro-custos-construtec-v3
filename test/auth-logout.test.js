const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, hasSQLite } = require('./password-reset-fixture.test');
const maybe = hasSQLite ? test : test.skip;

function fakeBridge(env) {
  env.API = { getByName() { return { fetch: async () => Response.json({ token: 'jwt-web', usuario: { id: 7 }, instancia: { id: 'inst' } }) }; } };
}

async function openWeb(call, token) {
  const issued = await call('POST', '/v1/auth/handoff', { token, body: { target: 'centro-custos' } });
  const consumed = await call('POST', '/v1/auth/handoff/consume', { body: { code: issued.data.code } });
  assert.equal(consumed.status, 200);
}

maybe('handoff liga a sessão web à sessão do app que a criou', async () => {
  const { env, call, token } = await setup();
  fakeBridge(env);
  await openWeb(call, token);
  const rows = env.DB.raw.prepare('SELECT token_hash,parent_session_hash,instance_name FROM cloud_sessions ORDER BY created_at').all();
  const web = rows.find((row) => row.instance_name === 'Centro de Custos web');
  const app = rows.find((row) => row.instance_name !== 'Centro de Custos web');
  assert.equal(web.parent_session_hash, app.token_hash);
  assert.equal(app.parent_session_hash, null);
});

maybe('logout encerra a sessão atual e as sessões web criadas por ela', async () => {
  const { env, call, email, password, token } = await setup();
  fakeBridge(env);
  await openWeb(call, token);
  await openWeb(call, token);
  const other = (await call('POST', '/v1/auth/login', { body: { email, password } })).data.sessionToken;
  await openWeb(call, other);
  const pending = await call('POST', '/v1/auth/handoff', { token, body: { target: 'centro-custos' } });
  const out = await call('POST', '/v1/auth/logout', { token });
  assert.deepEqual(out, { status: 200, data: { ok: true, revoked: 3 } });
  assert.equal((await call('GET', '/v1/auth/session', { token })).status, 401);
  assert.equal((await call('GET', '/v1/auth/session', { token: other })).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM cloud_sessions').get().n, 2, 'sobram a outra sessão e a web dela');
  assert.equal((await call('POST', '/v1/auth/handoff/consume', { body: { code: pending.data.code } })).data.code, 'HANDOFF_INVALID');
  const again = await call('POST', '/v1/auth/logout', { token });
  assert.deepEqual(again, { status: 200, data: { ok: true, revoked: 0 } });
});

maybe('logout sem token continua 200, como antes, e não apaga nada', async () => {
  const { env, call } = await setup();
  const out = await call('POST', '/v1/auth/logout');
  assert.deepEqual(out, { status: 200, data: { ok: true, revoked: 0 } });
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM cloud_sessions').get().n, 1);
});

maybe('revoke-others preserva as sessões web do próprio aparelho e derruba as dos outros', async () => {
  const { env, call, email, password, token } = await setup();
  fakeBridge(env);
  await openWeb(call, token);
  const other = (await call('POST', '/v1/auth/login', { body: { email, password } })).data.sessionToken;
  await openWeb(call, other);
  const out = await call('POST', '/v1/auth/sessions/revoke-others', { token });
  assert.deepEqual(out, { status: 200, data: { ok: true, revoked: 2 } });
  const rows = env.DB.raw.prepare('SELECT instance_name FROM cloud_sessions').all().map((row) => row.instance_name);
  assert.equal(rows.length, 2);
  assert.ok(rows.includes('Centro de Custos web'));
  assert.equal((await call('GET', '/v1/auth/session', { token: other })).status, 401);
});
