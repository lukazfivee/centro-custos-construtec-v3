const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setup } = require('./password-reset-fixture.test');

test('handoff emite código aleatório e guarda somente hash', async () => {
  const { env, call, token } = await setup();
  const issued = await call('POST', '/v1/auth/handoff', { token, body: { target: 'centro-custos' } });
  assert.equal(issued.status, 200);
  assert.match(issued.data.code, /^[A-Za-z0-9_-]{43}$/);
  const row = env.DB.raw.prepare('SELECT code_hash,session_hash,expires_at FROM session_handoffs').get();
  assert.equal(row.code_hash, crypto.createHash('sha256').update(issued.data.code).digest('hex'));
  assert.notEqual(row.session_hash, token);
  assert.equal(row.expires_at, issued.data.expiresAt);
});

test('handoff expirado ou já usado retorna HANDOFF_INVALID', async () => {
  const { env, call, token } = await setup();
  const issued = await call('POST', '/v1/auth/handoff', { token, body: { target: 'centro-custos' } });
  env.DB.raw.exec('UPDATE session_handoffs SET expires_at=0');
  assert.equal((await call('POST', '/v1/auth/handoff/consume', { body: { code: issued.data.code } })).data.code, 'HANDOFF_INVALID');
  env.DB.raw.exec('UPDATE session_handoffs SET expires_at=9999999999,used_at=1');
  assert.equal((await call('POST', '/v1/auth/handoff/consume', { body: { code: issued.data.code } })).data.code, 'HANDOFF_INVALID');
});

test('handoff válido não cria uma sessão web sem ponte com Express', async () => {
  const { call, token } = await setup();
  const issued = await call('POST', '/v1/auth/handoff', { token, body: { target: 'centro-custos' } });
  const consumed = await call('POST', '/v1/auth/handoff/consume', { body: { code: issued.data.code } });
  assert.equal(consumed.status, 503);
  assert.equal(consumed.data.code, 'SERVER_ERROR');
});
