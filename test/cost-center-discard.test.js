const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-discard-test-'));
process.env.DATABASE_URL = '';
process.env.PGLITE_DATA_DIR = path.join(tempDir, 'data');
process.env.JWT_SECRET = 'test-jwt-secret-with-minimum-32-chars-long';
process.env.ADMIN_INITIAL_EMAIL = 'descarte@teste.local';
process.env.ADMIN_INITIAL_PASSWORD = 'DescartePassword123!';

const { initializeDatabase, getDb, closeDatabase } = require('../db');
const { createApp } = require('../server');
const { confirmImport } = require('../services/budgets/budgetImportService');

const TABLES = ['cost_centers', 'project_contracts', 'budget_imports', 'budget_baselines', 'budget_control_items', 'budget_material_lines', 'budget_labor_lines'];

test('descartar e recuperar obra vinda de orcamento aprovado, sem movimento', async (context) => {
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
  const call = async (method, url, token, body) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };
  const admin = (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'descarte@teste.local', senha: 'DescartePassword123!' }) })).json()).token;

  const envelope = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/proposal-approved.v1.example.json'), 'utf8'));
  const { costCenterId } = await confirmImport(db, { envelope, confirmedHash: envelope.payloadSha256 }, 1);
  const counts = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, (await db.query(`SELECT COUNT(*)::int AS n FROM ${t}`)).rows[0].n])));
  const before = await counts();
  assert.ok(before.project_contracts >= 1 && before.budget_baselines >= 1 && before.budget_material_lines + before.budget_labor_lines > 0, 'a obra importada tem contrato e base de custo');
  const { code } = (await db.query('SELECT code FROM cost_centers WHERE id=$1', [costCenterId])).rows[0];

  // Excluir pela rota antiga segue barrado; o descarte pede o codigo da obra.
  assert.equal((await call('DELETE', `/centros-custo/${costCenterId}`, admin)).status, 409);
  assert.equal((await call('POST', `/centros-custo/${costCenterId}/descartar`, admin, { confirmar: 'errado' })).status, 400);

  // Impedimentos (so leitura, usado pelo celular): obra importada sem movimento.
  assert.deepEqual((await call('GET', `/centros-custo/${costCenterId}/impedimentos`, admin)).data, { lancamentos: 0, rateios: 0, recorrentes: 0, medicoes: 0, notas: 0 });
  assert.equal((await call('GET', '/centros-custo/999999/impedimentos', admin)).status, 404);

  // Descarte sem movimento.
  const discarded = await call('POST', `/centros-custo/${costCenterId}/descartar`, admin, { confirmar: code, motivo: 'obra de teste' });
  assert.equal(discarded.status, 200, JSON.stringify(discarded.data));
  const after = await counts();
  assert.equal(after.cost_centers, before.cost_centers - 1);
  assert.equal(after.budget_control_items + after.budget_material_lines + after.budget_labor_lines, 0);
  assert.equal(after.project_contracts, 0);
  assert.equal(after.budget_baselines, 0);
  assert.equal(after.budget_imports, 0);

  const list = await call('GET', '/centros-custo/descartadas', admin);
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].code, code);
  assert.equal(list.data[0].discarded_by_name.length > 0, true);
  assert.ok('cliente' in list.data[0] && 'valor_contrato' in list.data[0] && 'contrato_numero' in list.data[0]);
  assert.ok((await db.query("SELECT 1 FROM audit_log WHERE action='descartada'")).rows.length);

  // Recuperar: tudo volta como era.
  const restored = await call('POST', `/centros-custo/descartadas/${list.data[0].id}/restaurar`, admin);
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.deepEqual(await counts(), before);
  assert.equal((await call('POST', `/centros-custo/descartadas/${list.data[0].id}/restaurar`, admin)).status, 409, 'so restaura uma vez');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM cost_center_tombstones')).rows[0].n, 0);
  assert.equal((await call('GET', `/centros-custo/${costCenterId}/detalhes`, admin)).status, 200);
  // A obra restaurada pode ser descartada e restaurada de novo.
  const again = await call('POST', `/centros-custo/${costCenterId}/descartar`, admin, { confirmar: code });
  assert.equal(again.status, 200);
  const last = (await call('GET', '/centros-custo/descartadas', admin)).data.find((row) => !row.restored_at);
  assert.equal((await call('POST', `/centros-custo/descartadas/${last.id}/restaurar`, admin)).status, 200);
  assert.deepEqual(await counts(), before);

  // Com movimento (lancamento), nao descarta e nada e apagado. Lancamento e imutavel: a obra fica como esta.
  const category = (await call('GET', '/categorias', admin)).data[0].id;
  const tx = await call('POST', '/lancamentos', admin, { tipo: 'despesa', cost_center_id: costCenterId, category_id: category, descricao: 'Gasto', valor: 10, data: '2026-09-15', status_financeiro: 'pendente' });
  assert.equal(tx.status, 201);
  const blocked = await call('POST', `/centros-custo/${costCenterId}/descartar`, admin, { confirmar: code });
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.erro, /lançamentos/);
  assert.equal((await call('GET', `/centros-custo/${costCenterId}/impedimentos`, admin)).data.lancamentos, 1);
  assert.deepEqual(await counts(), before, 'recusado: nada foi apagado');

  // Lancamento excluido nao conta como movimento: a obra descarta, e o lancamento excluido vai junto e volta na restauracao.
  assert.equal((await call('DELETE', `/lancamentos/${tx.data.id}`, admin)).status, 200);
  assert.equal((await call('GET', `/centros-custo/${costCenterId}/impedimentos`, admin)).data.lancamentos, 0);
  const txRow = async () => (await db.query('SELECT id, deleted_at IS NOT NULL AS excluido FROM transactions WHERE id=$1', [tx.data.id])).rows[0];
  assert.equal((await txRow()).excluido, true);
  const withDeleted = await call('POST', `/centros-custo/${costCenterId}/descartar`, admin, { confirmar: code });
  assert.equal(withDeleted.status, 200, JSON.stringify(withDeleted.data));
  assert.equal(await txRow(), undefined, 'o lancamento excluido sai junto com a obra');
  const pending = (await call('GET', '/centros-custo/descartadas', admin)).data.find((row) => !row.restored_at);
  assert.equal((await call('POST', `/centros-custo/descartadas/${pending.id}/restaurar`, admin)).status, 200);
  assert.deepEqual(await txRow(), { id: tx.data.id, excluido: true }, 'volta como excluido');
  assert.deepEqual(await counts(), before);
  // Continua imutavel depois de restaurado.
  await assert.rejects(db.query('UPDATE transactions SET description=$2 WHERE id=$1', [tx.data.id, 'x']));
});
