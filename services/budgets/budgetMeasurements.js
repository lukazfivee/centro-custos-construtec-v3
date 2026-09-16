const crypto = require('crypto');

/**
 * Registra medição periódica de avanço de mão de obra
 */
async function recordLaborMeasurement(pool, params) {
  const {
    contractId,
    costCenterId,
    periodStart,
    periodEnd,
    teamHours,
    costAmount,
    lines = [],
    userId = null,
    notes = null,
  } = params;

  if (!contractId || !costCenterId || !periodStart || !periodEnd) {
    throw new Error('PARAMETROS_INVALIDOS: contractId, costCenterId, periodStart e periodEnd são obrigatórios');
  }

  const measurementId = crypto.randomUUID();

  await pool.query(`
    INSERT INTO labor_measurements
      (id, contract_id, cost_center_id, period_start, period_end, status, team_hours, cost_amount, notes, created_by)
    VALUES ($1, $2, $3, $4, $5, 'approved', $6, $7, $8, $9)
  `, [
    measurementId,
    contractId,
    costCenterId,
    periodStart,
    periodEnd,
    teamHours || 0,
    costAmount || 0,
    notes,
    userId,
  ]);

  for (const line of lines) {
    await pool.query(`
      INSERT INTO labor_measurement_lines
        (id, measurement_id, control_item_id, team_hours, cost_amount, evidence_ref)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      crypto.randomUUID(),
      measurementId,
      line.controlItemId,
      line.teamHours || 0,
      line.costAmount || 0,
      line.evidenceRef || null,
    ]);
  }

  return { id: measurementId, contractId, teamHours, costAmount };
}

/**
 * Consulta medições de mão de obra de um contrato
 */
async function listLaborMeasurements(pool, contractId) {
  const res = await pool.query(`
    SELECT lm.id, lm.contract_id, lm.cost_center_id, lm.period_start, lm.period_end,
           lm.status, lm.team_hours, lm.cost_amount, lm.notes, lm.created_at
    FROM labor_measurements lm
    WHERE lm.contract_id = $1
    ORDER BY lm.period_start DESC
  `, [contractId]);
  return res.rows;
}

/**
 * Registra medição contratual ao cliente (faturamento / avanço físico)
 */
async function recordContractMeasurement(pool, params) {
  const {
    contractId,
    costCenterId,
    measurementNumber,
    periodStart,
    periodEnd,
    measuredAmount,
    billedTransactionId = null,
    userId = null,
    notes = null,
  } = params;

  if (!contractId || !costCenterId || measurementNumber == null || !periodStart || !periodEnd || measuredAmount == null) {
    throw new Error('PARAMETROS_INVALIDOS: Dados incompletos para registro da medição contratual');
  }

  const id = crypto.randomUUID();

  await pool.query(`
    INSERT INTO contract_measurements
      (id, contract_id, cost_center_id, measurement_number, period_start, period_end, measured_amount, billed_transaction_id, status, notes, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved', $9, $10)
  `, [
    id,
    contractId,
    costCenterId,
    measurementNumber,
    periodStart,
    periodEnd,
    measuredAmount,
    billedTransactionId,
    notes,
    userId,
  ]);

  return { id, contractId, measurementNumber, measuredAmount };
}

/**
 * Consulta medições contratuais ao cliente
 */
async function listContractMeasurements(pool, contractId) {
  const res = await pool.query(`
    SELECT cm.id, cm.contract_id, cm.cost_center_id, cm.measurement_number,
           cm.period_start, cm.period_end, cm.measured_amount, cm.billed_transaction_id,
           cm.status, cm.notes, cm.created_at
    FROM contract_measurements cm
    WHERE cm.contract_id = $1
    ORDER BY cm.measurement_number ASC
  `, [contractId]);
  return res.rows;
}

module.exports = {
  recordLaborMeasurement,
  listLaborMeasurements,
  recordContractMeasurement,
  listContractMeasurements,
};
