const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

test('TASK-2026-09-20-01 - Allocation unmapped automática para despesa liquidada', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-auto-alloc-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'auto-alloc-secret-com-mais-de-32-caracteres-ok';
  process.env.ADMIN_INITIAL_PASSWORD = 'auto-alloc-123';
  process.env.ADMIN_INITIAL_EMAIL = 'auto-alloc@teste.local';

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');

  let server;
  context.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await initializeDatabase();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const db = getDb();

  async function request(route, method = 'GET', body, status = 200, token = '') {
    const response = await fetch(base + route, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${route}: ${text}`);
    return text ? JSON.parse(text) : null;
  }

  const auth = (await request('/auth/login', 'POST', { email: 'auto-alloc@teste.local', senha: 'auto-alloc-123' })).token;
  const categories = await request('/categorias', 'GET', undefined, 200, auth);
  const categoryFor = (tipo) => {
    const c = categories.find((x) => x.tipo === 'ambos') || categories.find((x) => x.tipo === tipo);
    return c.id;
  };

  async function allocCount(transactionId) {
    const r = await db.query('SELECT count(*)::int AS n FROM expense_allocations WHERE transaction_id=$1', [transactionId]);
    return r.rows[0].n;
  }

  async function createCostCenter(codigo) {
    const cc = await request('/centros-custo', 'POST', { codigo, nome: `Obra ${codigo}`, orcamento: 0, situacao: 'execucao' }, 201, auth);
    return cc.id;
  }

  async function giveBudget(costCenterId, seriesSeed) {
    const importId = crypto.randomUUID();
    const contractId = crypto.randomUUID();
    const baselineId = crypto.randomUUID();
    await db.query(
      `INSERT INTO budget_imports (id, source_system, namespace_id, series_id, source_proposal_id, source_revision, payload_hash, payload, contract_id)
       VALUES ($1,'teste',gen_random_uuid(),$2,$3,0,'hash-$2','{}'::jsonb,$4)`,
      [importId, seriesSeed, `prop-${seriesSeed}`, contractId]
    );
    await db.query(
      `INSERT INTO project_contracts (id, cost_center_id, source_system, namespace_id, series_id, number, status)
       VALUES ($1,$2,'teste',gen_random_uuid(),$3,$4,'active')`,
      [contractId, costCenterId, seriesSeed, `CTR-${seriesSeed}`]
    );
    await db.query(
      `INSERT INTO budget_baselines
         (id, contract_id, import_id, version, client_snapshot, work_snapshot, pricing,
          materials_cost, labor_cost, base_cost, contract_value, additions, sales_rounding_adjustment)
       VALUES ($1,$2,$3,0,'{}','{}','{}',1000,1000,2000,2500,0,0)`,
      [baselineId, contractId, importId]
    );
    await db.query('UPDATE project_contracts SET current_baseline_id=$1 WHERE id=$2', [baselineId, contractId]);
    return { contractId, baselineId };
  }

  const postLancamento = (overrides) => request('/lancamentos', 'POST', {
    tipo: overrides.tipo || 'despesa',
    cost_center_id: overrides.costCenterId, category_id: categoryFor(overrides.tipo || 'despesa'),
    descricao: overrides.descricao || 'Despesa teste', valor: overrides.valor || 100,
    data: overrides.data || '2026-09-15', status_financeiro: overrides.statusFinanceiro || 'liquidado',
  }, 201, auth);

  await context.test('POST despesa liquidada com contrato ativo cria allocation unmapped', async () => {
    const ccId = await createCostCenter('AUTO-001');
    await giveBudget(ccId, 'S1');
    const tx = await postLancamento({ costCenterId: ccId, valor: 123.45 });
    const { rows } = await db.query(
      'SELECT * FROM expense_allocations WHERE transaction_id=$1', [tx.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].mapping_status, 'unmapped');
    assert.equal(rows[0].control_item_id, null);
    assert.equal(rows[0].cost_center_id, ccId);
    assert.equal(Number(rows[0].amount), 123.45);
    assert.ok(rows[0].contract_id);
  });

  await context.test('Receita liquidada NÃO gera allocation', async () => {
    const ccId = await createCostCenter('AUTO-002');
    await giveBudget(ccId, 'S2');
    const tx = await postLancamento({ costCenterId: ccId, tipo: 'receita', descricao: 'Receita teste' });
    assert.equal(await allocCount(tx.id), 0);
  });

  await context.test('Despesa pendente NÃO gera allocation', async () => {
    const ccId = await createCostCenter('AUTO-003');
    await giveBudget(ccId, 'S3');
    const tx = await postLancamento({ costCenterId: ccId, statusFinanceiro: 'pendente' });
    assert.equal(await allocCount(tx.id), 0);
  });

  await context.test('Centro sem contrato/baseline NÃO gera allocation', async () => {
    const ccId = await createCostCenter('AUTO-004');
    const tx = await postLancamento({ costCenterId: ccId });
    assert.equal(await allocCount(tx.id), 0);
  });

  await context.test('PUT pendente→liquidado cria allocation; PUT seguinte não duplica', async () => {
    const ccId = await createCostCenter('AUTO-005');
    await giveBudget(ccId, 'S5');
    const tx = await postLancamento({ costCenterId: ccId, statusFinanceiro: 'pendente', valor: 77 });
    assert.equal(await allocCount(tx.id), 0);

    await request(`/lancamentos/${tx.id}`, 'PUT', {
      tipo: 'despesa', cost_center_id: ccId, category_id: categoryFor('despesa'),
      descricao: 'Despesa teste', valor: 77, data: '2026-09-15',
      status_financeiro: 'liquidado', revisao: 1,
    }, 200, auth);
    assert.equal(await allocCount(tx.id), 1);

    await request(`/lancamentos/${tx.id}`, 'PUT', {
      tipo: 'despesa', cost_center_id: ccId, category_id: categoryFor('despesa'),
      descricao: 'Despesa teste editada', valor: 77, data: '2026-09-15',
      status_financeiro: 'liquidado', revisao: 2,
    }, 200, auth);
    assert.equal(await allocCount(tx.id), 1, 'não deve duplicar allocation');
  });

  await context.test('Allocation automática aparece na lista de unmapped e no orçado-realizado', async () => {
    const ccId = await createCostCenter('AUTO-006');
    await giveBudget(ccId, 'S6');
    const tx = await postLancamento({ costCenterId: ccId, valor: 200 });
    const allocations = await request(`/centros-custo/${ccId}/apropriacoes?status=unmapped`, 'GET', undefined, 200, auth);
    assert.equal(allocations.length, 1);
    assert.equal(allocations[0].transaction_id, tx.id);
    const comp = await request(`/centros-custo/${ccId}/orcado-realizado`, 'GET', undefined, 200, auth);
    assert.equal(comp.hasBudget, true);
    assert.equal(comp.summary.realizedUnmappedCost, 200);
    assert.equal(comp.summary.realizedCost, 200);
  });
});
