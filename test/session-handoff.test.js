const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setup, hasSQLite } = require('./password-reset-fixture.test');
const maybe = hasSQLite ? test : test.skip;

maybe('handoff emite código aleatório e guarda somente hash', async () => {
  const { env, call, token } = await setup();
  const issued = await call('POST', '/v1/auth/handoff', { token, body: { target: 'centro-custos' } });
  assert.equal(issued.status, 200);
  assert.match(issued.data.code, /^[A-Za-z0-9_-]{43}$/);
  const row = env.DB.raw.prepare('SELECT code_hash,session_hash,expires_at FROM session_handoffs').get();
  assert.equal(row.code_hash, crypto.createHash('sha256').update(issued.data.code).digest('hex'));
  assert.notEqual(row.session_hash, token);
  assert.equal(row.expires_at, issued.data.expiresAt);
});

maybe('handoff expirado ou já usado retorna HANDOFF_INVALID', async () => {
  const { env, call, token } = await setup();
  const issued = await call('POST', '/v1/auth/handoff', { token, body: { target: 'centro-custos' } });
  env.DB.raw.exec('UPDATE session_handoffs SET expires_at=0');
  assert.equal((await call('POST', '/v1/auth/handoff/consume', { body: { code: issued.data.code } })).data.code, 'HANDOFF_INVALID');
  env.DB.raw.exec('UPDATE session_handoffs SET expires_at=9999999999,used_at=1');
  assert.equal((await call('POST', '/v1/auth/handoff/consume', { body: { code: issued.data.code } })).data.code, 'HANDOFF_INVALID');
});

maybe('handoff válido devolve o formato web e impede reutilização', async () => {
  const { env, call, token } = await setup();
  let bridgeCalls = 0;
  env.API = { getByName() { return { fetch: async (request) => {
    bridgeCalls += 1;
    const body = await request.json();
    assert.match(body.sessionHash, /^[a-f0-9]{64}$/);
    assert.equal(request.headers.get('x-sync-key'), env.SYNC_SHARED_KEY);
    return Response.json({ token:'jwt-web',usuario:{ id:7,nome:'Admin',email:body.user.email,role:'admin' },instancia:{ id:'inst',name:'Cloud' } });
  } }; } };
  const issued = await call('POST', '/v1/auth/handoff', { token, body: { target: 'centro-custos' } });
  const consumed = await call('POST', '/v1/auth/handoff/consume', { body: { code: issued.data.code } });
  assert.deepEqual(consumed, { status:200,data:{ token:'jwt-web',usuario:{ id:7,nome:'Admin',email:'admin@rcconstrutec.com.br',role:'admin' },instancia:{ id:'inst',name:'Cloud' } } });
  assert.equal(bridgeCalls, 1);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM cloud_sessions').get().n, 2);
  assert.equal((await call('POST', '/v1/auth/handoff/consume', { body: { code: issued.data.code } })).data.code, 'HANDOFF_INVALID');
});

maybe('falha da ponte consome o código sem deixar sessão web', async () => {
  const { env, call, token } = await setup();
  env.API = { getByName() { return { fetch: async () => Response.json({ ok:false }, { status:503 }) }; } };
  const issued = await call('POST', '/v1/auth/handoff', { token, body: { target:'centro-custos' } });
  const failed = await call('POST', '/v1/auth/handoff/consume', { body: { code:issued.data.code } });
  assert.equal(failed.status, 503);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM cloud_sessions').get().n, 1);
  assert.equal((await call('POST', '/v1/auth/handoff/consume', { body: { code:issued.data.code } })).data.code, 'HANDOFF_INVALID');
});

maybe('consulta interna por hash exige chave e acompanha revogação', async () => {
  const { env, call, token } = await setup();
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const userId = env.DB.raw.prepare('SELECT user_id FROM cloud_sessions').get().user_id;
  const body = { sessionHash:hash,userId };
  assert.equal((await call('GET', '/v1/auth/session', { token:`hash:${hash}` })).status, 401);
  assert.equal((await call('GET', '/v1/auth/session', { token:`hash:${hash}`,headers:{ 'x-sync-key':env.SYNC_SHARED_KEY } })).status, 200);
  assert.equal((await call('POST', '/v1/auth/session-hash', { body })).status, 401);
  assert.equal((await call('POST', '/v1/auth/session-hash', { body,headers:{ 'x-sync-key':env.SYNC_SHARED_KEY } })).status, 200);
  env.DB.raw.prepare('DELETE FROM cloud_sessions WHERE token_hash=?').run(hash);
  assert.equal((await call('POST', '/v1/auth/session-hash', { body,headers:{ 'x-sync-key':env.SYNC_SHARED_KEY } })).status, 401);
});
