const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-integ-discard-test-'));
process.env.DATABASE_URL = '';
process.env.PGLITE_DATA_DIR = path.join(tempDir, 'data');
process.env.JWT_SECRET = 'test-jwt-secret-with-minimum-32-chars-long';
process.env.ADMIN_INITIAL_EMAIL = 'integ@teste.local';
process.env.ADMIN_INITIAL_PASSWORD = 'IntegPassword123!';
delete process.env.CONSTRUTEC_INTEGRATION_KEY;
delete process.env.CONSTRUTEC_INTEGRATION_LOOPBACK_ONLY;

const { initializeDatabase, getDb, closeDatabase } = require('../db');
const { createApp } = require('../server');
const { confirmImport } = require('../services/budgets/budgetImportService');
const { expectedIntegrationKey } = require('../routes/integracaoOrcamentos');

test('Orcamentos descarta e recupera a obra pelo contrato (chave de integracao)', async (context) => {
  await initializeDatabase();
  const db = getDb();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const key = expectedIntegrationKey();
  const integ = async (method, url, body) => {
    const response = await fetch(`${base}/integracao/orcamentos${url}`, { method, headers: { 'Content-Type': 'application/json', 'X-Construtec-Integration-Key': key }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };

  const envelope = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/proposal-approved.v1.example.json'), 'utf8'));
  const { costCenterId } = await confirmImport(db, { envelope, confirmedHash: envelope.payloadSha256 }, 1);
  const contractId = (await db.query('SELECT id FROM project_contracts WHERE cost_center_id=$1', [costCenterId])).rows[0].id;
  const { code } = (await db.query('SELECT code FROM cost_centers WHERE id=$1', [costCenterId])).rows[0];
  const unknown = '00000000-0000-4000-8000-000000000000';

  assert.equal((await integ('GET', `/contratos/${contractId}/resumo`)).status, 200);
  assert.equal((await integ('GET', `/contratos/${unknown}/resumo`)).status, 404);
  assert.deepEqual((await integ('POST', `/contratos/${unknown}/restaurar`, { actorName: 'Ana' })).data.code, 'NOT_DISCARDED');

  // Restaurar com a obra ativa.
  const active = await integ('POST', `/contratos/${contractId}/restaurar`, { actorName: 'Ana' });
  assert.deepEqual([active.status, active.data], [200, { ok: true, restored: false, alreadyActive: true }]);

  // Descartar sem movimento.
  const discarded = await integ('POST', `/contratos/${contractId}/descartar`, { actorName: 'Ana', reason: 'cliente desistiu', proposalNumber: 'P-12' });
  assert.equal(discarded.status, 200, JSON.stringify(discarded.data));
  assert.equal(discarded.data.discarded, true);
  assert.equal(discarded.data.costCenterCode, code);
  assert.ok(discarded.data.discardId);
  const saved = (await db.query('SELECT reason, discarded_by_name FROM discarded_cost_centers WHERE id=$1', [discarded.data.discardId])).rows[0];
  assert.equal(saved.discarded_by_name, 'Orçamentos · Ana');
  assert.equal(saved.reason, 'Proposta P-12 descartada no Orçamentos · cliente desistiu');
  assert.ok((await db.query("SELECT 1 FROM audit_log WHERE action='descartada' AND entity_id=$1", [costCenterId])).rows.length);

  // Ja descartada / contrato inexistente.
  assert.deepEqual((await integ('POST', `/contratos/${contractId}/descartar`, { actorName: 'Ana' })).data, { ok: true, discarded: false, alreadyGone: true });
  assert.deepEqual((await integ('POST', `/contratos/${unknown}/descartar`, { actorName: 'Ana' })).data, { ok: true, discarded: false, alreadyGone: true });

  // Resumo de contrato descartado: 410.
  const gone = await integ('GET', `/contratos/${contractId}/resumo`);
  assert.equal(gone.status, 410);
  assert.equal(gone.data.code, 'CENTER_DISCARDED');
  assert.equal(gone.data.discarded, true);
  assert.equal(gone.data.costCenterCode, code);
  assert.equal(gone.data.discardedBy, 'Orçamentos · Ana');
  assert.ok(gone.data.discardedAt);

  // Restaurar.
  const restored = await integ('POST', `/contratos/${contractId}/restaurar`, { actorName: 'Bruno' });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.deepEqual(restored.data, { ok: true, restored: true, costCenterId, costCenterCode: code });
  assert.equal((await db.query('SELECT restored_by_name FROM discarded_cost_centers WHERE id=$1', [discarded.data.discardId])).rows[0].restored_by_name, 'Orçamentos · Bruno');
  assert.equal((await integ('GET', `/contratos/${contractId}/resumo`)).status, 200);
  assert.ok((await db.query("SELECT 1 FROM audit_log WHERE action='restaurada'")).rows.length);

  // Conflito de codigo: descarta, cria outra obra com o mesmo codigo, tenta restaurar.
  await integ('POST', `/contratos/${contractId}/descartar`, { actorName: 'Ana' });
  await db.query("INSERT INTO cost_centers (code, name, public_id) VALUES ($1, 'Outra', gen_random_uuid())", [code]);
  const clash = await integ('POST', `/contratos/${contractId}/restaurar`, { actorName: 'Ana' });
  assert.equal(clash.status, 409);
  assert.equal(clash.data.code, 'RESTORE_CONFLICT');
  assert.ok(clash.data.erro);
  await db.query('DELETE FROM cost_centers WHERE code=$1', [code]);
  assert.equal((await integ('POST', `/contratos/${contractId}/restaurar`, { actorName: 'Ana' })).status, 200);

  // Com movimento: 409 e nada muda.
  const login = await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'integ@teste.local', senha: 'IntegPassword123!' }) })).json();
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };
  const category = (await (await fetch(`${base}/categorias`, { headers: auth })).json())[0].id;
  const tx = await fetch(`${base}/lancamentos`, { method: 'POST', headers: auth, body: JSON.stringify({ tipo: 'despesa', cost_center_id: costCenterId, category_id: category, descricao: 'Gasto', valor: 10, data: '2026-09-15', status_financeiro: 'pendente' }) });
  assert.equal(tx.status, 201);
  const blocked = await integ('POST', `/contratos/${contractId}/descartar`, { actorName: 'Ana' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'HAS_MOVEMENT');
  assert.equal(blocked.data.movementCount, 1);
  assert.ok(blocked.data.erro);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM cost_centers WHERE id=$1', [costCenterId])).rows[0].n, 1);
});
