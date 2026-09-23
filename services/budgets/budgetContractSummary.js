// Resumo de acompanhamento de um contrato para o Construtec Orcamentos
// (docs/superpowers/specs/2026-09-22-sincronizacao-orcamentos-design.md, no
// repositorio do Orcamentos). Somente totais: nada de lancamentos individuais
// nem fornecedores. Reaproveita o calculo de Orcado vs realizado.
const { getCostCenterBudgetComparison } = require('./budgetComparison');

// Valores do comparativo ja vem com 2 casas; converte para centavos com
// arredondamento HALF_UP (meio para longe de zero), sem passar por float * 100.
function toCents(value) {
  const number = Number(value || 0);
  const [whole, fraction = ''] = Math.abs(number).toFixed(3).split('.');
  const thousandths = Number(whole) * 1000 + Number(fraction);
  const cents = Math.floor(thousandths / 10) + (thousandths % 10 >= 5 ? 1 : 0);
  return number < 0 ? -cents : cents;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getContractSummary(pool, contractId) {
  if (!UUID.test(String(contractId))) return null;
  const found = await pool.query(`
    SELECT pc.id, pc.cost_center_id, cc.project_status, cc.code, cc.name
    FROM project_contracts pc
    JOIN cost_centers cc ON cc.id = pc.cost_center_id
    WHERE pc.id = $1
  `, [contractId]);
  const contract = found.rows[0];
  if (!contract) return null;

  const comparison = await getCostCenterBudgetComparison(pool, contract.cost_center_id, { contractId: contract.id });
  const base = {
    contractId: contract.id,
    costCenterId: contract.cost_center_id,
    costCenterCode: contract.code,
    costCenterName: contract.name,
    costCenterStatus: contract.project_status,
    updatedAt: new Date().toISOString(),
  };
  if (!comparison.hasBudget) return { ...base, hasBudget: false };

  const summary = comparison.summary;
  return {
    ...base,
    hasBudget: true,
    baseline: {
      id: comparison.contract.baselineId,
      version: comparison.contract.baselineVersion,
      contractValueCents: toCents(summary.contractValue),
      baseCostCents: toCents(summary.baseCost),
      sealedAt: comparison.contract.approvedAt,
    },
    realizedCents: toCents(summary.realizedCost),
    realizedPercent: summary.burnRatePercent,
    balanceCents: toCents(summary.balance),
    overBudget: Boolean(summary.isOverBudget),
    unlinkedExpenseCents: toCents(summary.realizedUnmappedCost),
  };
}

module.exports = { getContractSummary, toCents };
