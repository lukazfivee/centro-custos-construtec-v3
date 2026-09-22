const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

test('TASK-2026-09-20-02 - Realizado não duplica quando linhas compartilham control_item_id', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-dup-item-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'dup-item-secret-com-mais-de-32-caracteres-ok';
  process.env.ADMIN_INITIAL_PASSWORD = 'dup-item-1234';
  process.env.ADMIN_INITIAL_EMAIL = 'dup-item@teste.local';

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { getCostCenterBudgetComparison } = require('../services/budgets/budgetComparison');

  context.after(async () => {
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await initializeDatabase();
  const db = getDb();

  const ccRes = await db.query(
    `INSERT INTO cost_centers (public_id, code, name, monthly_budget, active, project_status)
     VALUES (gen_random_uuid(),'DUP-001','Obra duplicada',0,true,'execucao') RETURNING id`
  );
  const ccId = ccRes.rows[0].id;

  // Contrato + baseline vigente
  const importId = crypto.randomUUID();
  const contractId = crypto.randomUUID();
  const baselineId = crypto.randomUUID();
  await db.query(
    `INSERT INTO budget_imports (id, source_system, namespace_id, series_id, source_proposal_id, source_revision, payload_hash, payload, contract_id)
     VALUES ($1,'teste',gen_random_uuid(),'DUP1','prop-DUP1',0,'hash-dup1','{}'::jsonb,$2)`,
    [importId, contractId]
  );
  await db.query(
    `INSERT INTO project_contracts (id, cost_center_id, source_system, namespace_id, series_id, number, status)
     VALUES ($1,$2,'teste',gen_random_uuid(),'DUP1','CTR-DUP','active')`,
    [contractId, ccId]
  );
  await db.query(
    `INSERT INTO budget_baselines
       (id, contract_id, import_id, version, client_snapshot, work_snapshot, pricing,
        materials_cost, labor_cost, base_cost, contract_value, additions, sales_rounding_adjustment)
     VALUES ($1,$2,$3,0,'{}','{}','{}',400,0,400,500,0,0)`,
    [baselineId, contractId, importId]
  );
  await db.query('UPDATE project_contracts SET current_baseline_id=$1 WHERE id=$2', [baselineId, contractId]);

  // 2 linhas de material com o MESMO control_item_id (R$200 cada, R$400 orçado total)
  const controlItemId = crypto.randomUUID();
  await db.query(
    `INSERT INTO budget_control_items (id, contract_id, kind, name, unit) VALUES ($1,$2,'material','material teste','un')`,
    [controlItemId, contractId]
  );
  for (const pos of [1, 2]) {
    await db.query(
      `INSERT INTO budget_material_lines
         (id, baseline_id, control_item_id, source_line_id, position, code, description, category, unit, quantity, unit_cost, total_cost, allocated_sale)
       VALUES ($1,$2,$3,$4,$5,'1212121212','material teste','Material','un',2,100,200,250)`,
      [crypto.randomUUID(), baselineId, controlItemId, `L${pos}`, pos]
    );
  }

  // cost_recognitions: R$450 + R$150 = R$600 para o control_item_id
  for (const amount of [450, 150]) {
    await db.query(
      `INSERT INTO cost_recognitions (cost_center_id, contract_id, control_item_id, recognition_date, amount, sign, status)
       VALUES ($1,$2,$3,'2026-09-15',$4,1,'approved')`,
      [ccId, contractId, controlItemId, amount]
    );
  }

  await context.test('cenario com control_item duplicado: realizado = 600 (não 1200)', async () => {
    const comp = await getCostCenterBudgetComparison(db, ccId);
    assert.equal(comp.hasBudget, true);
    const linhas = comp.items.filter((i) => i.controlItemId === controlItemId);
    assert.equal(linhas.length, 2, 'duas linhas de orçamento com o mesmo control_item');
    const somaLinhas = linhas.reduce((acc, i) => acc + i.realizedCost, 0);
    assert.equal(somaLinhas, 600, 'soma de realizedCost das linhas deve ser o total real (600), não 1200');
    assert.equal(comp.summary.realizedMappedCost, 600);
    assert.equal(comp.summary.realizedCost, 600);
    assert.equal(comp.summary.budgetedDirectCost, 400, 'orçado por linha preservado (200+200)');
    // Exposure/balance/burnRate coerentes: base_cost=400, realizado=600
    assert.equal(comp.summary.exposure, 600);
    assert.equal(comp.summary.balance, -200);
    assert.equal(comp.summary.burnRatePercent, 150, 'consumo 150%, não 300%');
  });

  await context.test('sem duplicidade: comportamento inalterado (uma linha por control_item)', async () => {
    const cc2 = await db.query(
      `INSERT INTO cost_centers (public_id, code, name, monthly_budget, active, project_status)
       VALUES (gen_random_uuid(),'DUP-002','Obra normal',0,true,'execucao') RETURNING id`
    );
    const ccId2 = cc2.rows[0].id;
    const importId2 = crypto.randomUUID();
    const contractId2 = crypto.randomUUID();
    const baselineId2 = crypto.randomUUID();
    await db.query(
      `INSERT INTO budget_imports (id, source_system, namespace_id, series_id, source_proposal_id, source_revision, payload_hash, payload, contract_id)
       VALUES ($1,'teste',gen_random_uuid(),'DUP2','prop-DUP2',0,'hash-dup2','{}'::jsonb,$2)`,
      [importId2, contractId2]
    );
    await db.query(
      `INSERT INTO project_contracts (id, cost_center_id, source_system, namespace_id, series_id, number, status)
       VALUES ($1,$2,'teste',gen_random_uuid(),'DUP2','CTR-DUP2','active')`,
      [contractId2, ccId2]
    );
    await db.query(
      `INSERT INTO budget_baselines
         (id, contract_id, import_id, version, client_snapshot, work_snapshot, pricing,
          materials_cost, labor_cost, base_cost, contract_value, additions, sales_rounding_adjustment)
       VALUES ($1,$2,$3,0,'{}','{}','{}',300,0,300,400,0,0)`,
      [baselineId2, contractId2, importId2]
    );
    await db.query('UPDATE project_contracts SET current_baseline_id=$1 WHERE id=$2', [baselineId2, contractId2]);

    const itens = [crypto.randomUUID(), crypto.randomUUID()];
    for (const [idx, itemId] of itens.entries()) {
      await db.query(
        `INSERT INTO budget_control_items (id, contract_id, kind, name, unit) VALUES ($1,$2,'material',$3,'un')`,
        [itemId, contractId2, `item ${idx}`]
      );
      await db.query(
        `INSERT INTO budget_material_lines
           (id, baseline_id, control_item_id, source_line_id, position, code, description, category, unit, quantity, unit_cost, total_cost, allocated_sale)
         VALUES ($1,$2,$3,$4,$5,'C','desc','Material','un',1,$6,$6,$7)`,
        [crypto.randomUUID(), baselineId2, itemId, `L${idx}`, idx + 1, 100 * (idx + 1), 120 * (idx + 1)]
      );
      await db.query(
        `INSERT INTO cost_recognitions (cost_center_id, contract_id, control_item_id, recognition_date, amount, sign, status)
         VALUES ($1,$2,$3,'2026-09-15',$4,1,'approved')`,
        [ccId2, contractId2, itemId, 50 * (idx + 1)]
      );
    }

    const comp = await getCostCenterBudgetComparison(db, ccId2);
    assert.equal(comp.summary.realizedMappedCost, 150, '50 + 100');
    assert.equal(comp.summary.realizedCost, 150);
    assert.equal(comp.items.length, 2);
    assert.equal(comp.items[0].realizedCost, 50);
    assert.equal(comp.items[1].realizedCost, 100);
  });
});
