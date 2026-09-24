const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./password-reset-fixture.test');

test('revoke-others mantém a sessão atual e lista sem hash ou token', async () => {
  const { call, email, password, token } = await setup();
  const other = await call('POST', '/v1/auth/login', { body: { email, password }, headers: { 'x-instance-name': 'Android teste' } });
  const listed = await call('GET', '/v1/auth/sessions', { token });
  assert.equal(listed.data.sessions.length, 2);
  assert.equal(listed.data.sessions.filter((session) => session.current).length, 1);
  assert.equal(listed.data.sessions.find((session) => !session.current).instanceName, 'Android teste');
  assert.ok(listed.data.sessions.every((session) => !('token_hash' in session) && !('token' in session)));
  const revoked = await call('POST', '/v1/auth/sessions/revoke-others', { token });
  assert.deepEqual(revoked, { status: 200, data: { ok: true, revoked: 1 } });
  assert.equal((await call('GET', '/v1/auth/session', { token })).status, 200);
  assert.equal((await call('GET', '/v1/auth/session', { token: other.data.sessionToken })).status, 401);
});
