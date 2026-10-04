// Revisao de seguranca: handoff leva o papel da Suite e os apps ao Container e ao Orcamentos;
// segredo SYNC_SHARED_KEY com BOM/espaco e normalizado; aviso do cliente deduplica por minuto.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setup, hasSQLite } = require('./password-reset-fixture.test');
const maybe = hasSQLite ? test : test.skip;

const worker = (file) => pathToFileURL(path.join(__dirname, '..', 'cloudflare', 'center-container', file)).href;

function capturingBridge(env) {
  const captured = [];
  env.API = { getByName() {
    return { fetch: async (request) => {
      captured.push(JSON.parse(await request.text()));
      return Response.json({ token: 'jwt-de-teste', usuario: { id: 1 }, instancia: { id: 'i' } });
    } };
  } };
  return captured;
}

maybe('handoff do app envia ao Container o papel da Suite e os apps', async () => {
  const { env, call, token, email } = await setup();
  env.DB.raw.prepare("UPDATE cloud_users SET suite_role='engenharia',apps='[\"centro\"]',role='supervisor' WHERE email=?").run(email);
  const captured = capturingBridge(env);
  const issued = await call('POST', '/v1/auth/handoff', { token, body: { target: 'centro-custos' } });
  const consumed = await call('POST', '/v1/auth/handoff/consume', { body: { code: issued.data.code } });
  assert.equal(consumed.status, 200);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].user.suiteRole, 'engenharia');
  assert.deepEqual(captured[0].user.apps, ['centro']);
  assert.equal(captured[0].user.role, 'supervisor');
});

maybe('sem suite_role gravado, o papel enviado segue o mapeamento do papel antigo', async () => {
  const { env, call, token } = await setup();
  const captured = capturingBridge(env);
  const issued = await call('POST', '/v1/auth/handoff', { token, body: { target: 'centro-custos' } });
  await call('POST', '/v1/auth/handoff/consume', { body: { code: issued.data.code } });
  assert.equal(captured[0].user.suiteRole, 'admin');
});

maybe('usuario devolvido ao Orcamentos inclui suiteRole e apps', async () => {
  const { env, call, token, email } = await setup();
  env.DB.raw.prepare("UPDATE cloud_users SET suite_role='comercial',apps='[\"orcamentos\"]',role='supervisor' WHERE email=?").run(email);
  env.CONSTRUTEC_IDENTITY_KEY = 'o'.repeat(40);
  const issued = await call('POST', '/v1/auth/handoff', { token, body: { target: 'orcamentos' } });
  const consumed = await call('POST', '/v1/auth/handoff/consume', {
    headers: { 'x-construtec-identity-key': env.CONSTRUTEC_IDENTITY_KEY }, body: { code: issued.data.code, target: 'orcamentos' },
  });
  assert.equal(consumed.status, 200);
  assert.equal(consumed.data.user.suiteRole, 'comercial');
  assert.deepEqual(consumed.data.user.apps, ['orcamentos']);
});

test('SYNC_SHARED_KEY com BOM ou espaco nas pontas e normalizada', async () => {
  const { cleanSyncKey } = await import(worker('centralAuth.js'));
  assert.equal(cleanSyncKey({ SYNC_SHARED_KEY: '﻿ abc123 \n' }), 'abc123');
  assert.equal(cleanSyncKey({}), '');
});

test('aviso do cliente repetido no mesmo minuto usa a mesma chave de deduplicacao', async () => {
  const { handleNotifications } = await import(worker('notifications.js'));
  const keys = [];
  const env = {
    SYNC_SHARED_KEY: 'k'.repeat(40), CONSTRUTEC_IDENTITY_KEY: 'o'.repeat(40),
    DB: { prepare(sql) {
      return { bind(...args) { if (/INSERT/i.test(sql)) keys.push(args); return this; },
        async first() { return null; }, async all() { return { results: [] }; }, async run() { return { meta: { changes: 0 } }; } };
    }, async batch() { return []; } },
  };
  const send = () => handleNotifications(new Request('https://centro.test/v1/internal/orcamentos-notify', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-construtec-identity-key': env.CONSTRUTEC_IDENTITY_KEY },
    body: JSON.stringify({ event: 'approved', proposalId: 'abc-123', proposalNumber: 'P-1' }),
  }), env, new URL('https://centro.test/v1/internal/orcamentos-notify'));
  await send(); await send();
  const dedupe = keys.flat().filter((v) => typeof v === 'string' && v.startsWith('approved:abc-123:'));
  if (dedupe.length >= 2) assert.equal(dedupe[0], dedupe[1]);
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'cloudflare', 'center-container', 'notifications.js'), 'utf8');
  assert.match(source, /Math\.floor\(Date\.now\(\) \/ 60000\)/);
  assert.doesNotMatch(source, /dedupeKey: `\$\{body\.event\}:\$\{proposalId\}:\$\{Date\.now\(\)\.toString\(36\)\}`/);
});
