// Exclusao reversivel de cobrancas no Worker (D1 de mentira em SQLite): excluir, listar, restaurar,
// permissao, e que a cobranca excluida some dos indicadores sem tocar na obra espelhada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setup, hasSQLite } = require('./password-reset-fixture.test');
const maybe = hasSQLite ? test : test.skip;

const root = path.join(__dirname, '..', 'cloudflare', 'center-container');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

maybe('Worker: excluir e restaurar cobranca e reversivel, protegido por papel e fora dos indicadores', async () => {
  const { env, token } = await setup();
  const comercial = await import(pathToFileURL(path.join(root, 'commercialSync.js')).href);
  const raw = env.DB.raw;
  raw.exec(`CREATE TABLE sync_entities (org_id TEXT NOT NULL, entity_type TEXT NOT NULL, public_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT, payload TEXT NOT NULL, payload_hash TEXT NOT NULL, source_instance_id TEXT, source_instance_name TEXT, source_user_email TEXT,
    event_id INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, server_updated_at TEXT NOT NULL, PRIMARY KEY (org_id, entity_type, public_id))`);
  const obra = (id, code, valor, ordem) => raw.prepare("INSERT INTO sync_entities(org_id,entity_type,public_id,payload,payload_hash,created_at,server_updated_at) VALUES('rcconstrutec.com.br','obra',?,?,'h','2026-10-01','2026-10-0'||?)")
    .run(id, JSON.stringify({ code, name: `Obra ${code}`, client: 'Cliente', contractAmount: valor, projectStatus: 'execucao' }), String(ordem));
  obra(A, 'CC-PA-1001', 1000, 1);
  obra(B, 'CC-PA-1002', 500, 2);
  obra(C, 'CC-PA-1003', 250, 3);

  const call = async (method, pathname, body, tk = token) => {
    const response = await comercial.handleCommercialSync(new Request(`https://centro.test${pathname}`, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}`, 'cf-connecting-ip': '203.0.113.9' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    return { status: response.status, data: await response.json() };
  };

  // A primeira chamada cria as tabelas comerciais; so depois a migracao 013 acrescenta as colunas.
  const inicial = await call('GET', '/v1/client-followups');
  assert.equal(inicial.status, 200);
  assert.equal(inicial.data.items.length, 3);
  raw.exec(fs.readFileSync(path.join(root, 'd1-migrations', '013-cobranca-excluida.sql'), 'utf8'));

  // Cobranca B tem acompanhamento salvo (paga); A e C nao tem linha em client_followups.
  const salvar = await call('PUT', `/v1/client-followups/${B}`, { operationalStatus: 'finalizada', financialStatus: 'pago', receivableAmount: 500, contractAmount: 500, clientEmails: [] });
  assert.equal(salvar.status, 200);

  // Excluir sem linha previa cria a linha com os padroes da obra.
  const excluiA = await call('POST', `/v1/client-followups/${A}/delete`, { motivo: 'Item de teste' });
  assert.equal(excluiA.status, 200);
  assert.equal(excluiA.data.deletedByEmail, 'admin@rcconstrutec.com.br');
  const linhaA = raw.prepare('SELECT * FROM client_followups WHERE cost_center_public_id=?').get(A);
  assert.equal(linhaA.deleted_reason, 'Item de teste');
  assert.equal(linhaA.contract_amount, 1000);
  assert.equal(linhaA.financial_status, 'a_faturar');
  assert.ok(linhaA.deleted_at);

  // Excluir de novo e 409; obra desconhecida e 404; id invalido e 400.
  assert.equal((await call('POST', `/v1/client-followups/${A}/delete`, {})).status, 409);
  assert.equal((await call('POST', '/v1/client-followups/44444444-4444-4444-8444-444444444444/delete', {})).status, 404);
  assert.equal((await call('POST', '/v1/client-followups/nada/delete', {})).status, 400);
  assert.equal((await call('POST', `/v1/client-followups/${C}/restore`, {})).status, 409);

  // Sem corpo tambem exclui (motivo e opcional). Cobranca paga tambem pode ser excluida.
  const excluiB = await fetchSemCorpo(comercial, env, token, B);
  assert.equal(excluiB.status, 200);

  // A lista padrao ignora as excluidas e os indicadores so contam as demais.
  const lista = await call('GET', '/v1/client-followups');
  assert.deepEqual(lista.data.items.map((i) => i.publicId), [C]);
  assert.equal(lista.data.summary.totalReceber, 250);
  assert.equal(lista.data.items[0].deletedAt, null);

  // ?excluidas=1 lista so as excluidas, com quem/quando/motivo.
  const excluidas = await call('GET', '/v1/client-followups?excluidas=1');
  assert.deepEqual(excluidas.data.items.map((i) => i.publicId).sort(), [A, B]);
  const itemA = excluidas.data.items.find((i) => i.publicId === A);
  assert.equal(itemA.deletedReason, 'Item de teste');
  assert.equal(itemA.deletedByEmail, 'admin@rcconstrutec.com.br');
  assert.ok(itemA.deletedAt);
  assert.equal(excluidas.data.items.find((i) => i.publicId === B).financialStatus, 'pago');

  // A obra espelhada continua intacta (so a cobranca foi marcada).
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sync_entities WHERE entity_type='obra'").get().n, 3);

  // Sem papel de admin/gestor nao exclui nem restaura; a lista continua liberada para leitura.
  raw.prepare("UPDATE cloud_users SET role='supervisor'").run();
  assert.equal((await call('POST', `/v1/client-followups/${C}/delete`, {})).status, 403);
  assert.equal((await call('POST', `/v1/client-followups/${A}/restore`, {})).status, 403);
  assert.equal((await call('GET', '/v1/client-followups')).status, 200);
  assert.equal((await call('POST', `/v1/client-followups/${C}/delete`, {}, 'token-invalido')).status, 401);
  raw.prepare("UPDATE cloud_users SET role='gestor'").run();

  // Restaurar volta a cobranca para a lista com os dados que ela tinha.
  const restaura = await call('POST', `/v1/client-followups/${B}/restore`, {});
  assert.equal(restaura.status, 200);
  assert.equal((await call('POST', `/v1/client-followups/${B}/restore`, {})).status, 409);
  const depois = await call('GET', '/v1/client-followups');
  assert.deepEqual(depois.data.items.map((i) => i.publicId).sort(), [B, C]);
  assert.equal(depois.data.items.find((i) => i.publicId === B).financialStatus, 'pago');
  assert.equal(depois.data.summary.totalReceber, 250);
  assert.deepEqual((await call('GET', '/v1/client-followups?excluidas=1')).data.items.map((i) => i.publicId), [A]);

  // Editar o acompanhamento nao desfaz a exclusao.
  assert.equal((await call('PUT', `/v1/client-followups/${A}`, { operationalStatus: 'finalizada', financialStatus: 'a_faturar' })).status, 200);
  assert.equal((await call('GET', '/v1/client-followups')).data.items.some((i) => i.publicId === A), false);
});

async function fetchSemCorpo(comercial, env, token, id) {
  const response = await comercial.handleCommercialSync(new Request(`https://centro.test/v1/client-followups/${id}/delete`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': '203.0.113.9' },
  }), env);
  return { status: response.status, data: await response.json() };
}
