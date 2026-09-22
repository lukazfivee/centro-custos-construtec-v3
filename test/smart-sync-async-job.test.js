const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.PGLITE_DATA_DIR = path.join(os.tmpdir(), 'centro-custos-smartsync-async');
process.env.RESTORE_ROOT_DIR = path.join(os.tmpdir(), 'centro-custos-smartsync-async-restore');
process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.ADMIN_INITIAL_PASSWORD = 'Admin@123456';
process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
process.env.INSTANCE_NAME = 'Instalação de teste';
delete process.env.DATABASE_URL;

require('../server');
delete process.env.DATABASE_URL;

const { initializeDatabase, closeDatabase, getDb, getInstanceIdentity } = require('../db');
const { createApp } = require('../server');
const { stableHash, FORMAT_VERSION } = require('../services/smartSync');
const jobs = require('../lib/jobs');

async function setup() {
  fs.rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
  await initializeDatabase();
}

function buildLargePackage(categoryCount) {
  const instance = getInstanceIdentity();
  const categories = Array.from({ length: categoryCount }, (_, i) => ({
    publicId: crypto.randomUUID(),
    name: `Categoria Sync ${i + 1}`,
    type: 'despesa',
    active: true,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  const payload = { categories, costCenters: [], suppliers: [], transactions: [] };
  return {
    formatVersion: FORMAT_VERSION,
    packageId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    source: { id: instance.id, name: instance.name },
    payload,
    payloadHash: stableHash(payload),
  };
}

test('pacote grande de sincronização inteligente vira job em segundo plano e fica consultável até succeeded', async () => {
  await setup();
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    await runScenario(base);
  } finally {
    await new Promise((r) => server.close(r));
    await closeDatabase();
  }
});

async function runScenario(base) {
  const loginResp = await fetch(base + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@teste.local', senha: 'Admin@123456' }),
  });
  const { token } = await loginResp.json();
  assert.ok(token, 'login deve retornar token');

  const pack = buildLargePackage(201); // acima do ASYNC_ITEM_THRESHOLD (200)
  const resp = await fetch(base + '/sincronizacao-inteligente/importar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nomeArquivo: 'grande.ccsync', conteudo: JSON.stringify(pack) }),
  });
  const dispatched = await resp.json();

  assert.equal(resp.status, 202, `esperado 202 (aceito para processamento), recebeu ${resp.status}: ${JSON.stringify(dispatched)}`);
  assert.equal(dispatched.async, true);
  assert.equal(dispatched.itens, 201);
  assert.ok(dispatched.jobId, 'deve retornar um jobId rastreável');
  assert.equal(dispatched.status, 'queued');

  // Consulta imediata: o job deve existir e estar rastreável mesmo antes de concluir.
  const statusResp1 = await fetch(base + `/jobs/${dispatched.jobId}`, { headers: { Authorization: `Bearer ${token}` } });
  const status1 = await statusResp1.json();
  assert.equal(statusResp1.status, 200);
  assert.ok(['queued', 'running', 'succeeded'].includes(status1.status));

  // Espera determinística pela conclusão (sem depender de polling com timeout real).
  await jobs.flushQueue();

  const statusResp2 = await fetch(base + `/jobs/${dispatched.jobId}`, { headers: { Authorization: `Bearer ${token}` } });
  const status2 = await statusResp2.json();
  assert.equal(status2.status, 'succeeded');
  assert.equal(status2.resultado.duplicado, false);
  assert.equal(status2.resultado.resumo.incluidos, 201);

  const count = (await getDb().query("SELECT COUNT(*)::int AS total FROM categories WHERE name LIKE 'Categoria Sync %'")).rows[0].total;
  assert.equal(count, 201, 'as 201 categorias devem ter sido persistidas pelo job em segundo plano');

  // Reenviar o mesmo pacote (mesmo packageId) deve ser idempotente: não reprocessa,
  // retorna o job já succeeded.
  const resp2 = await fetch(base + '/sincronizacao-inteligente/importar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nomeArquivo: 'grande.ccsync', conteudo: JSON.stringify(pack) }),
  });
  const dispatched2 = await resp2.json();
  assert.equal(dispatched2.jobId, dispatched.jobId, 'mesmo packageId deve reaproveitar o job existente (idempotência)');

  const countAfterRetry = (await getDb().query("SELECT COUNT(*)::int AS total FROM categories WHERE name LIKE 'Categoria Sync %'")).rows[0].total;
  assert.equal(countAfterRetry, 201, 'reenvio idempotente não deve duplicar categorias');
}
