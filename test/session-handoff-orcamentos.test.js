const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, hasSQLite } = require('./password-reset-fixture.test');
const maybe = hasSQLite ? test : test.skip;

const KEY = 'o'.repeat(40);
const withKey = (env) => { env.CONSTRUTEC_IDENTITY_KEY = KEY; return { 'x-construtec-identity-key': KEY }; };

maybe('handoff do Orçamentos vira sessão central filha, só com a chave do Orçamentos', async () => {
  const { env, call, token } = await setup();
  const headers = withKey(env);
  const issued = await call('POST', '/v1/auth/handoff', { token, body: { target: 'orcamentos' } });
  assert.equal(issued.status, 200);
  assert.equal(env.DB.raw.prepare('SELECT target FROM session_handoffs').get().target, 'orcamentos');

  const semChave = await call('POST', '/v1/auth/handoff/consume', { body: { code: issued.data.code, target: 'orcamentos' } });
  assert.equal(semChave.status, 403);
  const consumed = await call('POST', '/v1/auth/handoff/consume', { headers, body: { code: issued.data.code, target: 'orcamentos' } });
  assert.equal(consumed.status, 200);
  assert.match(consumed.data.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(consumed.data.user.email, 'admin@rcconstrutec.com.br');
  assert.equal(consumed.data.user.active, true);

  const session = await call('GET', '/v1/auth/session', { token: consumed.data.sessionToken });
  assert.equal(session.status, 200);
  const child = env.DB.raw.prepare("SELECT instance_name,parent_session_hash FROM cloud_sessions WHERE instance_name='Orçamentos web'").get();
  assert.ok(child.parent_session_hash);
  assert.equal((await call('POST', '/v1/auth/handoff/consume', { headers, body: { code: issued.data.code, target: 'orcamentos' } })).data.code, 'HANDOFF_INVALID');

  // "Sair" no app encerra também a sessão do Orçamentos.
  assert.equal((await call('POST', '/v1/auth/logout', { token })).data.revoked, 2);
  assert.equal((await call('GET', '/v1/auth/session', { token: consumed.data.sessionToken })).status, 401);
});

maybe('código só vale no destino para o qual foi emitido', async () => {
  const { env, call, token } = await setup();
  const headers = withKey(env);
  env.API = { getByName() { throw new Error('ponte não deveria ser chamada'); } };
  const paraCentro = await call('POST', '/v1/auth/handoff', { token, body: { target: 'centro-custos' } });
  const trocado = await call('POST', '/v1/auth/handoff/consume', { headers, body: { code: paraCentro.data.code, target: 'orcamentos' } });
  assert.equal(trocado.data.code, 'HANDOFF_INVALID');

  const paraOrc = await call('POST', '/v1/auth/handoff', { token, body: { target: 'orcamentos' } });
  assert.equal((await call('POST', '/v1/auth/handoff/consume', { body: { code: paraOrc.data.code } })).data.code, 'HANDOFF_INVALID');
  // As tentativas erradas não gastam o código.
  assert.equal((await call('POST', '/v1/auth/handoff/consume', { headers, body: { code: paraOrc.data.code, target: 'orcamentos' } })).status, 200);

  assert.equal((await call('POST', '/v1/auth/handoff', { token, body: { target: 'chamados' } })).data.code, 'TARGET_INVALID');
  assert.equal((await call('POST', '/v1/auth/handoff/consume', { body: { code: paraOrc.data.code, target: 'chamados' } })).data.code, 'TARGET_INVALID');
});
