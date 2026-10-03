// Descarte e recuperacao de obra (centro de custos) sem movimento financeiro.
// Uma obra vinda de orcamento aprovado tem contrato e base de custo selada; isso nao impede o descarte
// por um administrador, desde que nao haja lancamento, rateio, recorrencia, medicao nem nota fiscal.
// O conteudo e guardado em JSON (discarded_cost_centers) e a obra pode ser restaurada.
const { httpError } = require('../lib/http');

// Se houver alguma linha nestas tabelas, a obra tem movimento e nao pode ser descartada.
const MOVEMENT = [
  ['transactions', 'lançamentos'],
  ['transaction_allocations', 'rateios de lançamentos'],
  ['recurring_templates', 'recorrências'],
  ['expense_allocations', 'apropriações de despesas'],
  ['cost_recognitions', 'reconhecimentos de custos'],
  ['labor_measurements', 'medições de mão de obra'],
  ['contract_measurements', 'medições contratuais'],
  ['cost_center_invoices', 'notas fiscais vinculadas'],
  ['cost_center_invoices_ledger', 'notas fiscais'],
];

const CONTRACTS = 'SELECT id FROM project_contracts WHERE cost_center_id=$1';
const BASELINES = `SELECT id FROM budget_baselines WHERE contract_id IN (${CONTRACTS})`;
// Importacao so entra se nenhuma outra obra a usa.
const IMPORTS = `SELECT bi.id FROM budget_imports bi
  WHERE bi.id IN (SELECT import_id FROM budget_baselines WHERE contract_id IN (${CONTRACTS}))
  AND NOT EXISTS (SELECT 1 FROM budget_baselines bb WHERE bb.import_id=bi.id AND bb.contract_id NOT IN (${CONTRACTS}))`;

// Ordem de restauracao (pais primeiro). O descarte apaga na ordem inversa.
const STRUCTURE = [
  ['budget_imports', `id IN (${IMPORTS})`],
  ['budget_import_events', `import_id IN (${IMPORTS})`],
  ['cost_centers', 'id=$1'],
  ['project_contracts', 'cost_center_id=$1'],
  ['budget_baselines', `id IN (${BASELINES})`],
  ['budget_control_items', `contract_id IN (${CONTRACTS})`],
  ['budget_material_lines', `baseline_id IN (${BASELINES})`],
  ['budget_labor_lines', `baseline_id IN (${BASELINES})`],
  ['cost_center_proposals', 'cost_center_id=$1'],
  ['user_cost_centers', 'cost_center_id=$1'],
];
// Linhas de base de custo selada tem gatilho contra alteracao; so o descarte e a restauracao os desligam.
const GUARDED = [
  ['budget_baselines', 'baseline_immutable_guard'],
  ['budget_material_lines', 'baseline_materials_immutable_guard'],
  ['budget_labor_lines', 'baseline_labor_immutable_guard'],
];

async function movements(db, id) {
  const found = [];
  for (const [table, label] of MOVEMENT) {
    const { rows } = await db.query(`SELECT 1 FROM ${table} WHERE cost_center_id=$1 LIMIT 1`, [id]);
    if (rows.length) found.push(label);
  }
  return found;
}

// O que impede o descarte, agrupado como o celular mostra (so leitura).
const GROUPS = [
  ['lancamentos', ['transactions']],
  ['rateios', ['transaction_allocations', 'expense_allocations', 'cost_recognitions']],
  ['recorrentes', ['recurring_templates']],
  ['medicoes', ['labor_measurements', 'contract_measurements']],
  ['notas', ['cost_center_invoices', 'cost_center_invoices_ledger']],
];
async function movementSummary(db, id) {
  const out = {};
  for (const [key, tables] of GROUPS) {
    out[key] = 0;
    for (const table of tables) out[key] += (await db.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE cost_center_id=$1`, [id])).rows[0].n;
  }
  return out;
}

async function toggleGuards(db, enable) {
  for (const [table, trigger] of GUARDED) {
    const { rows } = await db.query('SELECT 1 FROM pg_trigger WHERE tgname=$1', [trigger]);
    if (rows.length) await db.query(`ALTER TABLE ${table} ${enable ? 'ENABLE' : 'DISABLE'} TRIGGER ${trigger}`);
  }
}

// Quantos registros de movimento a obra tem (usado pelo Orcamentos antes de descartar a proposta).
async function movementCount(db, id) {
  let total = 0;
  for (const [table] of MOVEMENT) {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE cost_center_id=$1`, [id]);
    total += rows[0].n;
  }
  return total;
}

async function discardCostCenter(db, id, user, reason) {
  return db.transaction(async (tx) => {
    const center = (await tx.query('SELECT id,public_id,code,name FROM cost_centers WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!center) throw httpError(404, 'Centro de custo não encontrado.');
    const blockers = await movements(tx, id);
    if (blockers.length) throw httpError(409, `Esta obra tem ${blockers.join(', ')}. Só obra sem movimento pode ser descartada; inative a obra para preservá-la.`);
    const payload = {};
    for (const [table, where] of STRUCTURE) {
      payload[table] = (await tx.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS rows FROM ${table} t WHERE ${where}`, [id])).rows[0].rows;
    }
    await toggleGuards(tx, false);
    // As importacoes se definem pelo contrato; guardar os ids antes de apagar o contrato.
    const importIds = payload.budget_imports.map((row) => row.id);
    for (const [table, where] of [...STRUCTURE].reverse()) {
      if (table === 'cost_centers') continue;
      if (table === 'budget_imports') await tx.query('DELETE FROM budget_imports WHERE id = ANY($1::uuid[])', [importIds]);
      else if (table === 'budget_import_events') await tx.query('DELETE FROM budget_import_events WHERE import_id = ANY($1::uuid[])', [importIds]);
      else await tx.query(`DELETE FROM ${table} WHERE ${where}`, [id]);
    }
    await toggleGuards(tx, true);
    await tx.query('INSERT INTO cost_center_tombstones (public_id) VALUES ($1) ON CONFLICT (public_id) DO NOTHING', [center.public_id]);
    await tx.query('DELETE FROM cost_centers WHERE id=$1', [id]);
    const saved = (await tx.query(
      `INSERT INTO discarded_cost_centers (cost_center_public_id,code,name,reason,payload,discarded_by,discarded_by_name)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id`,
      [center.public_id, center.code, center.name, reason || null, JSON.stringify(payload), user?.id || null, user?.name || 'Sistema'],
    )).rows[0];
    return { discardId: saved.id, center };
  });
}

async function listDiscarded(db) {
  const { rows } = await db.query(`SELECT id, code, name, reason, discarded_by_name, discarded_at, restored_at, restored_by_name,
      (payload->'project_contracts'->0->>'id') IS NOT NULL AS tinha_contrato,
      payload->'cost_centers'->0->>'client' AS cliente, payload->'cost_centers'->0->>'contract_amount' AS valor_contrato,
      payload->'project_contracts'->0->>'number' AS contrato_numero
    FROM discarded_cost_centers ORDER BY discarded_at DESC LIMIT 200`);
  return rows;
}

async function restoreCostCenter(db, discardId, user) {
  return db.transaction(async (tx) => {
    const row = (await tx.query('SELECT * FROM discarded_cost_centers WHERE id=$1 FOR UPDATE', [discardId])).rows[0];
    if (!row) throw httpError(404, 'Registro de obra descartada não encontrado.');
    if (row.restored_at) throw httpError(409, 'Esta obra já foi restaurada.');
    const payload = row.payload;
    const center = payload.cost_centers?.[0];
    if (!center) throw httpError(409, 'O registro não tem os dados da obra.');
    const clash = (await tx.query('SELECT 1 FROM cost_centers WHERE id=$1 OR public_id=$2 OR LOWER(code)=LOWER($3) LIMIT 1', [center.id, center.public_id, center.code])).rows;
    if (clash.length) throw httpError(409, 'Já existe uma obra com o mesmo código ou identificador. Renomeie ou exclua a existente antes de restaurar.');
    await toggleGuards(tx, false);
    for (const [table] of STRUCTURE) {
      const rows = payload[table] || [];
      if (!rows.length) continue;
      await tx.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(rows)]);
    }
    await toggleGuards(tx, true);
    await tx.query('DELETE FROM cost_center_tombstones WHERE public_id=$1', [center.public_id]);
    await tx.query('UPDATE discarded_cost_centers SET restored_at=NOW(), restored_by_name=$2 WHERE id=$1', [discardId, user?.name || 'Sistema']);
    // Mantem a sequencia de ids acima do maior restaurado.
    await tx.query("SELECT setval(pg_get_serial_sequence('cost_centers','id'), GREATEST((SELECT MAX(id) FROM cost_centers), 1))");
    return { center };
  });
}

module.exports = { discardCostCenter, restoreCostCenter, listDiscarded, movementCount, movements, movementSummary };
