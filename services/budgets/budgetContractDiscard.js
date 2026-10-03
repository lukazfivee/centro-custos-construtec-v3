// Descarte e recuperacao da obra pedidos pelo Orcamentos, pelo id do contrato (contract_id da importacao).
// Usa o mesmo arquivo de obras descartadas do descarte manual (services/costCenterArchive.js).
const { recordAudit } = require('../audit');
const { discardCostCenter, restoreCostCenter, movementCount } = require('../costCenterArchive');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value, max) => String(value || '').trim().slice(0, max);

class IntegrationError extends Error {
  constructor(statusCode, code, message, extra = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.extra = extra;
  }
}

async function findContract(db, contractId) {
  if (!UUID.test(contractId)) return null;
  return (await db.query(`SELECT pc.id, pc.cost_center_id, cc.code, cc.name FROM project_contracts pc
    JOIN cost_centers cc ON cc.id = pc.cost_center_id WHERE pc.id = $1`, [contractId])).rows[0] || null;
}

// Registro de descarte ainda nao restaurado que guarda este contrato.
async function findOpenDiscard(db, contractId) {
  if (!UUID.test(contractId)) return null;
  return (await db.query(`SELECT id, code, name, discarded_at, discarded_by_name FROM discarded_cost_centers
    WHERE restored_at IS NULL AND payload->'project_contracts' @> jsonb_build_array(jsonb_build_object('id', $1::text))
    ORDER BY discarded_at DESC LIMIT 1`, [contractId])).rows[0] || null;
}

const actorOf = (body) => ({ id: null, name: `Orçamentos · ${clean(body?.actorName, 120) || 'Usuário'}` });

async function discardByContract(db, contractId, body, requester) {
  const contract = await findContract(db, contractId);
  if (!contract) return { ok: true, discarded: false, alreadyGone: true };
  const count = await movementCount(db, contract.cost_center_id);
  if (count > 0) {
    throw new IntegrationError(409, 'HAS_MOVEMENT', 'A obra tem movimento financeiro e não pode ser descartada.', { movementCount: count });
  }
  const proposal = clean(body?.proposalNumber, 80);
  const extra = clean(body?.reason, 300);
  const reason = [`Proposta ${proposal || 'de origem'} descartada no Orçamentos`, extra].filter(Boolean).join(' · ');
  const actor = actorOf(body);
  let result;
  try {
    result = await discardCostCenter(db, contract.cost_center_id, actor, reason);
  } catch (error) {
    if (error.statusCode === 409) {
      throw new IntegrationError(409, 'HAS_MOVEMENT', error.message, { movementCount: await movementCount(db, contract.cost_center_id) });
    }
    throw error;
  }
  await recordAudit({
    entityType: 'obra', entityId: contract.cost_center_id, action: 'descartada',
    summary: `Obra / centro descartado pelo Orçamentos: ${result.center.name}`,
    data: { codigo: result.center.code, motivo: reason, descarte: result.discardId, contrato: contract.id, solicitante: requester?.name || null },
    user: actor,
  });
  return { ok: true, discarded: true, discardId: result.discardId, costCenterCode: result.center.code };
}

async function restoreByContract(db, contractId, body, requester) {
  if (await findContract(db, contractId)) return { ok: true, restored: false, alreadyActive: true };
  const record = await findOpenDiscard(db, contractId);
  if (!record) throw new IntegrationError(404, 'NOT_DISCARDED', 'Não há obra descartada para este contrato.');
  const actor = actorOf(body);
  let center;
  try {
    ({ center } = await restoreCostCenter(db, record.id, actor));
  } catch (error) {
    if (error.statusCode === 409) throw new IntegrationError(409, 'RESTORE_CONFLICT', error.message);
    if (error.statusCode === 404) throw new IntegrationError(404, 'NOT_DISCARDED', error.message);
    throw error;
  }
  await recordAudit({
    entityType: 'obra', entityId: center.id, action: 'restaurada',
    summary: `Obra / centro restaurado pelo Orçamentos: ${center.name}`,
    data: { codigo: center.code, descarte: record.id, contrato: contractId, solicitante: requester?.name || null },
    user: actor,
  });
  return { ok: true, restored: true, costCenterId: center.id, costCenterCode: center.code };
}

module.exports = { discardByContract, restoreByContract, findOpenDiscard, IntegrationError };
