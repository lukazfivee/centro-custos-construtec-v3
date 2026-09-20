const crypto = require('crypto');

/**
 * Cria ou atualiza alocação de despesa vinculada a um item de controle orçamentário
 */
async function recordExpenseAllocation(pool, params) {
  const {
    transactionId,
    costCenterId,
    amount,
    contractId = null,
    controlItemId = null,
    materialLineId = null,
    laborLineId = null,
    quantity = null,
    unit = null,
    notes = null,
  } = params;

  if (!transactionId || !costCenterId || amount == null) {
    throw new Error('PARAMETROS_INVALIDOS: transactionId, costCenterId e amount são obrigatórios');
  }

  // Reuso idempotente: se já existe alocação unmapped da transação (ex.: criada automaticamente),
  // mapeia/reutiliza em vez de duplicar.
  const prev = await pool.query(
    `SELECT id FROM expense_allocations
     WHERE transaction_id = $1 AND mapping_status = 'unmapped'
     ORDER BY created_at LIMIT 1`,
    [transactionId]
  );
  if (prev.rows[0]) {
    if (!controlItemId) return { id: prev.rows[0].id, mappingStatus: 'unmapped' };
    await mapExistingAllocation(pool, {
      allocationId: prev.rows[0].id, contractId, controlItemId,
      materialLineId, laborLineId, quantity, unit, notes,
    });
    return { id: prev.rows[0].id, mappingStatus: 'mapped' };
  }

  const mappingStatus = controlItemId ? 'mapped' : 'unmapped';
  const id = crypto.randomUUID();

  // Validar se o item de controle pertence ao contrato se informado
  if (controlItemId && contractId) {
    const itemCheck = await pool.query(
      'SELECT id FROM budget_control_items WHERE id = $1 AND contract_id = $2',
      [controlItemId, contractId]
    );
    if (itemCheck.rows.length === 0) {
      throw new Error('ITEM_CONTROLE_INVALIDO: O item de controle não pertence ao contrato informado');
    }
  }

  await pool.query(`
    INSERT INTO expense_allocations
      (id, transaction_id, cost_center_id, contract_id, control_item_id, material_line_id, labor_line_id, amount, quantity, unit, mapping_status, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `, [
    id,
    transactionId,
    costCenterId,
    contractId,
    controlItemId,
    materialLineId,
    laborLineId,
    amount,
    quantity,
    unit,
    mappingStatus,
    notes,
  ]);

  // Se for mapeado, criar reconhecimento de custo direto
  if (mappingStatus === 'mapped') {
    const tx = await pool.query('SELECT transaction_date, type FROM transactions WHERE id = $1', [transactionId]);
    const recDate = tx.rows[0]?.transaction_date || new Date().toISOString().slice(0, 10);
    const sign = tx.rows[0]?.type === 'estorno' ? -1 : 1;

    await pool.query(`
      INSERT INTO cost_recognitions
        (id, cost_center_id, contract_id, allocation_id, control_item_id, recognition_date, amount, sign, status, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved', $9)
    `, [
      crypto.randomUUID(),
      costCenterId,
      contractId,
      id,
      controlItemId,
      recDate,
      amount,
      sign,
      notes,
    ]);
  }

  return { id, mappingStatus };
}

/**
 * Mapeia uma alocação preexistente para um item de controle de baseline
 */
async function mapExistingAllocation(pool, params) {
  const {
    allocationId,
    contractId,
    controlItemId,
    materialLineId = null,
    laborLineId = null,
    quantity = null,
    unit = null,
    notes = null,
  } = params;

  if (!allocationId || !contractId || !controlItemId) {
    throw new Error('PARAMETROS_INVALIDOS: allocationId, contractId e controlItemId são obrigatórios');
  }

  const allocRes = await pool.query('SELECT * FROM expense_allocations WHERE id = $1', [allocationId]);
  if (allocRes.rows.length === 0) {
    throw new Error('ALOCACAO_NAO_ENCONTRADA: Alocação não encontrada');
  }
  const alloc = allocRes.rows[0];

  // Verificar item de controle
  const itemCheck = await pool.query(
    'SELECT id FROM budget_control_items WHERE id = $1 AND contract_id = $2',
    [controlItemId, contractId]
  );
  if (itemCheck.rows.length === 0) {
    throw new Error('ITEM_CONTROLE_INVALIDO: O item de controle não pertence ao contrato');
  }

  await pool.query(`
    UPDATE expense_allocations
    SET contract_id = $1,
        control_item_id = $2,
        material_line_id = $3,
        labor_line_id = $4,
        quantity = $5,
        unit = $6,
        mapping_status = 'mapped',
        notes = COALESCE($7, notes)
    WHERE id = $8
  `, [contractId, controlItemId, materialLineId, laborLineId, quantity, unit, notes, allocationId]);

  // Atualizar ou criar cost_recognition
  const tx = await pool.query('SELECT transaction_date, type FROM transactions WHERE id = $1', [alloc.transaction_id]);
  const recDate = tx.rows[0]?.transaction_date || new Date().toISOString().slice(0, 10);
  const sign = tx.rows[0]?.type === 'estorno' ? -1 : 1;

  await pool.query('DELETE FROM cost_recognitions WHERE allocation_id = $1', [allocationId]);
  await pool.query(`
    INSERT INTO cost_recognitions
      (id, cost_center_id, contract_id, allocation_id, control_item_id, recognition_date, amount, sign, status, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved', $9)
  `, [
    crypto.randomUUID(),
    alloc.cost_center_id,
    contractId,
    allocationId,
    controlItemId,
    recDate,
    alloc.amount,
    sign,
    notes,
  ]);

  return { success: true, allocationId, controlItemId };
}

/**
 * Desfaz o mapeamento de uma alocação (retorna a unmapped)
 */
async function unmapAllocation(pool, allocationId) {
  await pool.query(`
    UPDATE expense_allocations
    SET contract_id = NULL,
        control_item_id = NULL,
        material_line_id = NULL,
        labor_line_id = NULL,
        mapping_status = 'unmapped'
    WHERE id = $1
  `, [allocationId]);

  await pool.query('DELETE FROM cost_recognitions WHERE allocation_id = $1', [allocationId]);
  return { success: true, allocationId };
}

/**
 * Lista alocações de um centro de custo com metadados da transação
 */
async function listCostCenterAllocations(pool, costCenterId, filters = {}) {
  const { status } = filters;
  let sql = `
    SELECT
      ea.id,
      ea.transaction_id,
      ea.cost_center_id,
      ea.contract_id,
      ea.control_item_id,
      ea.amount,
      ea.quantity,
      ea.unit,
      ea.mapping_status,
      ea.notes,
      ea.created_at,
      t.transaction_date AS transaction_date,
      t.description AS transaction_description,
      t.payment_method,
      t.type AS transaction_type,
      bci.name AS control_item_name,
      bci.kind AS control_item_kind
    FROM expense_allocations ea
    JOIN transactions t ON t.id = ea.transaction_id
    LEFT JOIN budget_control_items bci ON bci.id = ea.control_item_id
    WHERE ea.cost_center_id = $1
  `;
  const params = [costCenterId];

  if (status) {
    sql += ' AND ea.mapping_status = $2';
    params.push(status);
  }

  sql += ' ORDER BY t.transaction_date DESC, ea.created_at DESC';
  const result = await pool.query(sql, params);
  return result.rows;
}

module.exports = {
  recordExpenseAllocation,
  mapExistingAllocation,
  unmapAllocation,
  listCostCenterAllocations,
};
