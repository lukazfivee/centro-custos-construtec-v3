// Orcamento da obra: baselines, orcado x realizado (e CSV), apropriacoes de gastos e medicoes.
// Separado de routes/costCenters.js (limite de 350 linhas); montado no mesmo /api/centros-custo.
const express = require('express');
const { getDb } = require('../db');
const { autenticar } = require('../middleware/auth');
const { paramObra, bloquearEscopado } = require('../services/obraScope');
const { exigirPermissao } = require('../services/permissions');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { csvLine, decimalBr } = require('../lib/csv');
const { getCostCenterBudgetComparison } = require('../services/budgets/budgetComparison');
const {
  recordExpenseAllocation,
  mapExistingAllocation,
  unmapAllocation,
  listCostCenterAllocations,
} = require('../services/budgets/budgetAllocations');
const {
  recordLaborMeasurement,
  listLaborMeasurements,
  recordContractMeasurement,
  listContractMeasurements,
} = require('../services/budgets/budgetMeasurements');

const router = express.Router();
router.use(autenticar);
router.param('id', paramObra);

// Um gasto (apropriacao) so pode ser vinculado ou desvinculado pela obra a que pertence.
async function ensureAllocationOfCenter(allocationId, costCenterId) {
  const id = String(allocationId || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw httpError(400, 'Gasto inválido.');
  const { rows } = await getDb().query('SELECT id FROM expense_allocations WHERE id=$1 AND cost_center_id=$2', [id, costCenterId]);
  if (!rows[0]) throw httpError(404, 'Gasto não encontrado nesta obra.');
  return id;
}

router.get('/:id/baselines', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const result = await getDb().query(`
    SELECT b.id, b.contract_id, b.version, b.predecessor_id, b.materials_cost,
      b.labor_cost, b.base_cost, b.contract_value, b.additions, b.sealed_at,
      b.id = pc.current_baseline_id AS is_current, pc.number AS contract_number
    FROM budget_baselines b
    JOIN project_contracts pc ON pc.id = b.contract_id
    WHERE pc.cost_center_id = $1
    ORDER BY b.version DESC
  `, [id]);
  res.json(result.rows);
}));

router.get('/:id/orcado-realizado', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const comparison = await getCostCenterBudgetComparison(getDb(), id, req.query);
  res.json(comparison);
}));

router.get('/:id/orcado-realizado/csv', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const comparison = await getCostCenterBudgetComparison(getDb(), id, req.query);
  const centerRes = await getDb().query('SELECT code, name FROM cost_centers WHERE id = $1', [id]);
  if (!centerRes.rows[0]) throw httpError(404, 'Centro de custo não encontrado.');
  const center = centerRes.rows[0];

  const lines = [
    csvLine(['CONSTRUTEC ENGENHARIA — RELATÓRIO DE ORÇADO VS. REALIZADO']),
    csvLine(['Obra / Centro', `${center.code} — ${center.name}`]),
    csvLine(['Contrato', comparison.contract?.number || '—']),
    csvLine(['Baseline Versão', comparison.contract?.baselineVersion != null ? `REV0${comparison.contract.baselineVersion}` : '—']),
    csvLine(['Data da Emissão', new Date().toLocaleDateString('pt-BR')]),
    csvLine([]),
    csvLine(['RESUMO EXECUTIVO']),
    csvLine(['Valor Contratual', decimalBr(comparison.summary?.contractValue)]),
    csvLine(['Custo Base Orçado', decimalBr(comparison.summary?.baseCost)]),
    csvLine(['Realizado Líquido', decimalBr(comparison.summary?.realizedCost)]),
    csvLine(['Exposição Total', decimalBr(comparison.summary?.exposure)]),
    csvLine(['Saldo Disponível', decimalBr(comparison.summary?.balance)]),
    csvLine(['Consumo do Orçamento (%)', `${decimalBr(comparison.summary?.burnRatePercent)}%`]),
    csvLine(['Horas Equipe Consumidas', `${comparison.laborHours?.consumed || 0}h / ${comparison.laborHours?.planned || 0}h`]),
    csvLine(['Despesas Não Mapeadas', decimalBr(comparison.unmapped?.totalCost)]),
    csvLine([]),
    csvLine([
      'Código', 'Insumo / Descrição', 'Tipo', 'Categoria', 'Unidade',
      'Qtd Orçada', 'Custo Unit. (R$)', 'Custo Total Orçado (R$)',
      'Realizado Líquido (R$)', 'Desvio (R$)', 'Desvio (%)', 'Saldo (R$)',
      'Classe ABC', 'Status'
    ]),
  ];

  const aIds = new Set((comparison.abcCurve?.a || []).map(x => x.controlItemId));
  const bIds = new Set((comparison.abcCurve?.b || []).map(x => x.controlItemId));
  const cIds = new Set((comparison.abcCurve?.c || []).map(x => x.controlItemId));

  (comparison.items || []).forEach((item) => {
    const abcClass = aIds.has(item.controlItemId) ? 'A' : bIds.has(item.controlItemId) ? 'B' : cIds.has(item.controlItemId) ? 'C' : '—';
    const status = item.isOverBudget ? 'Estourado' : (item.realizedCost > 0 ? 'Em execução' : 'Não iniciado');
    lines.push(csvLine([
      item.code || '—',
      item.name || item.description,
      item.kind === 'labor' ? 'Mão de Obra' : 'Material',
      item.category || '—',
      item.unit || '—',
      decimalBr(item.budgetedQuantity),
      decimalBr(item.budgetedUnitCost),
      decimalBr(item.budgetedCost),
      decimalBr(item.realizedCost),
      decimalBr(item.variance),
      item.variancePercent != null ? `${decimalBr(item.variancePercent)}%` : '—',
      decimalBr(item.balance),
      abcClass,
      status,
    ]));
  });

  if (comparison.unmapped?.items?.length) {
    lines.push(csvLine([]));
    lines.push(csvLine(['LANÇAMENTOS NÃO MAPEADOS (SEM VÍNCULO AO ORÇAMENTO)']));
    lines.push(csvLine(['Data', 'Descrição', 'Valor (R$)']));
    comparison.unmapped.items.forEach((u) => {
      lines.push(csvLine([u.date || '—', u.description || 'Despesa', decimalBr(u.amount)]));
    });
  }

  const safeCode = (center.code || `obra-${id}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `orcado-vs-realizado-${safeCode}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${lines.join('\r\n')}`);
}));

router.get('/:id/apropriacoes', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const allocations = await listCostCenterAllocations(getDb(), id, req.query);
  res.json(allocations);
}));

router.post('/:id/apropriacoes', exigirPermissao('p5'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  if (req.body.allocationId) {
    await ensureAllocationOfCenter(req.body.allocationId, id);
    const result = await mapExistingAllocation(getDb(), {
      allocationId: req.body.allocationId,
      contractId: req.body.contractId,
      controlItemId: req.body.controlItemId,
      materialLineId: req.body.materialLineId,
      laborLineId: req.body.laborLineId,
      quantity: req.body.quantity,
      unit: req.body.unit,
      notes: req.body.notes,
    });
    return res.json(result);
  }

  const result = await recordExpenseAllocation(getDb(), {
    ...req.body,
    costCenterId: id,
  });
  res.status(201).json(result);
}));

router.post('/:id/apropriacoes/:allocId/desmapear', exigirPermissao('p5'), asyncRoute(async (req, res) => {
  const allocationId = await ensureAllocationOfCenter(req.params.allocId, positiveId(req.params.id));
  const result = await unmapAllocation(getDb(), allocationId);
  res.json(result);
}));

router.get('/:id/medicoes', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const contractRes = await getDb().query('SELECT id FROM project_contracts WHERE cost_center_id = $1 AND status = \'active\' LIMIT 1', [id]);
  if (!contractRes.rows[0]) return res.json({ labor: [], contracts: [] });
  const contractId = contractRes.rows[0].id;
  const [labor, contracts] = await Promise.all([
    listLaborMeasurements(getDb(), contractId),
    listContractMeasurements(getDb(), contractId),
  ]);
  res.json({ contractId, labor, contracts });
}));

router.post('/:id/medicoes', exigirPermissao('p12'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const { type = 'labor', ...params } = req.body;
  let contractId = params.contractId;
  if (!contractId) {
    const cRes = await getDb().query('SELECT id FROM project_contracts WHERE cost_center_id = $1 AND status = \'active\' LIMIT 1', [id]);
    if (!cRes.rows[0]) throw httpError(400, 'Obra sem contrato ativo para registrar medições.');
    contractId = cRes.rows[0].id;
  }
  if (type === 'contract') {
    const result = await recordContractMeasurement(getDb(), { ...params, contractId, costCenterId: id, userId: req.usuario?.id });
    return res.status(201).json(result);
  }
  const result = await recordLaborMeasurement(getDb(), { ...params, contractId, costCenterId: id, userId: req.usuario?.id });
  res.status(201).json(result);
}));

module.exports = router;
