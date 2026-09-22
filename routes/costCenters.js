const { allocatedTransactionsSql } = require('../services/financialProjection');
const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { parsePagination, wantsPagination, paginationMeta } = require('../lib/pagination');
const { csvLine, decimalBr } = require('../lib/csv');
const { validDate, currentMonth, validMonth, monthRange } = require('../lib/dates');
const { recordAudit } = require('../services/audit');
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
const { getPortfolioSummary } = require('../services/budgets/budgetPortfolio');
const { getCostCenterCurveS } = require('../services/budgets/budgetCurveS');

const router = express.Router();
router.use(autenticar);

router.get('/portfolio-summary', asyncRoute(async (req, res) => {
  res.json(await getPortfolioSummary(getDb()));
}));

router.get('/:id/curva-s', asyncRoute(async (req, res) => {
  res.json(await getCostCenterCurveS(getDb(), positiveId(req.params.id)));
}));

const COST_CENTERS_SELECT = `
  SELECT cc.id, cc.code AS codigo, cc.name AS nome, cc.responsible AS responsavel,
    cc.client AS cliente, cc.contract_number AS contrato,
    cc.start_date::text AS data_inicio, cc.end_date::text AS data_fim,
    cc.contract_amount AS valor_contrato, cc.project_status AS situacao,
    cc.monthly_budget AS orcamento, cc.active AS ativo, cc.description AS descricao,cc.revision,
    COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa'
      AND t.transaction_date >= $1 AND t.transaction_date < $2),0) AS total_comprometido_mes,
    COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa'),0) AS total_comprometido,
    COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa' AND t.financial_status='liquidado'),0) AS total_despesas,
    COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='receita' AND t.financial_status='liquidado'),0) AS total_receitas
  FROM cost_centers cc LEFT JOIN ${allocatedTransactionsSql} t ON t.cost_center_id=cc.id AND t.deleted_at IS NULL`;

router.get('/', asyncRoute(async (req, res) => {
  const { month, range } = reportMonth(req.query);
  const orderBy = 'cc.active DESC, cc.name';

  if (!wantsPagination(req.query)) {
    const { rows } = await getDb().query(
      `${COST_CENTERS_SELECT} GROUP BY cc.id ORDER BY ${orderBy} LIMIT 500`, [range.start, range.end]);
    res.setHeader('X-Result-Limit', '500');
    return res.json(rows.map(row => ({...row,mes_orcamento:month})));
  }

  const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
  const [dataResult, countResult] = await Promise.all([
    getDb().query(
      `${COST_CENTERS_SELECT} GROUP BY cc.id ORDER BY ${orderBy} LIMIT $3 OFFSET $4`,
      [range.start, range.end, limit, offset]),
    getDb().query('SELECT COUNT(*)::int AS total FROM cost_centers'),
  ]);
  const total = Number(countResult.rows[0]?.total || 0);
  res.setHeader('X-Total-Count', String(total));
  return res.json({
    itens: dataResult.rows.map(row => ({...row,mes_orcamento:month})),
    paginacao: paginationMeta(total, page, limit),
  });
}));

router.get('/:id/detalhes', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const { month, range } = reportMonth(req.query);
  const db = getDb();
  const centerResult = await db.query(`
    SELECT cc.id, cc.code AS codigo, cc.name AS nome, cc.responsible AS responsavel,
      cc.client AS cliente, cc.contract_number AS contrato, cc.description AS descricao,
      cc.start_date::text AS data_inicio, cc.end_date::text AS data_fim,
      cc.contract_amount AS valor_contrato, cc.project_status AS situacao,
      cc.monthly_budget AS orcamento, cc.active AS ativo,cc.revision,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa'
        AND t.transaction_date >= $2 AND t.transaction_date < $3),0) AS total_comprometido_mes,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa'),0) AS total_comprometido,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa' AND t.financial_status='liquidado'),0) AS total_despesas,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='receita' AND t.financial_status='liquidado'),0) AS total_receitas,
      COUNT(t.id) FILTER (WHERE t.deleted_at IS NULL) AS total_lancamentos
    FROM cost_centers cc LEFT JOIN ${allocatedTransactionsSql} t ON t.cost_center_id=cc.id
    WHERE cc.id=$1 GROUP BY cc.id
  `, [id, range.start, range.end]);
  if (!centerResult.rows[0]) throw httpError(404, 'Centro de custo não encontrado.');
  const center = centerResult.rows[0];
  center.mes_orcamento = month;
  const { rows: transactions } = await db.query(`
    SELECT t.id, t.public_id, t.type AS tipo, t.description AS descricao, t.counterparty AS favorecido,
      t.amount AS valor,t.original_amount AS valor_original,t.accounting_sign AS sinal_contabil,t.reversal_of AS estorno_de,
      t.reversal_reason AS motivo_estorno,t.reversed_at,
      t.transaction_date::text AS data, t.due_date::text AS vencimento,
      t.financial_status AS status_financeiro, t.document_number AS documento,
      t.payment_method AS forma_pagamento, t.notes AS observacao,
      CASE WHEN t.financial_status='pendente' AND t.due_date<CURRENT_DATE THEN 'vencido'
        ELSE t.financial_status END AS situacao,
      c.name AS categoria
    FROM ${allocatedTransactionsSql} t JOIN categories c ON c.id=t.category_id
    WHERE t.cost_center_id=$1 AND t.deleted_at IS NULL
    ORDER BY t.transaction_date DESC,t.id DESC
  `, [id]);
  res.json({ centro: center, lancamentos: transactions });
}));

router.get('/exportar.csv', asyncRoute(async (req, res) => {
  const { rows } = await getDb().query(`
    SELECT cc.code, cc.name, cc.client, cc.contract_number, cc.responsible,
      cc.start_date, cc.end_date, cc.contract_amount, cc.monthly_budget, cc.project_status, cc.active,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa'),0) AS committed,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa' AND t.financial_status='liquidado'),0) AS expenses,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='receita' AND t.financial_status='liquidado'),0) AS revenues,
      COUNT(t.id) AS transactions_count
    FROM cost_centers cc LEFT JOIN ${allocatedTransactionsSql} t ON t.cost_center_id=cc.id AND t.deleted_at IS NULL
    GROUP BY cc.id ORDER BY cc.active DESC, cc.name
  `);
  const lines = [csvLine(['Código','Obra / centro','Cliente','Contrato','Responsável','Início','Término','Valor contratado','Orçamento mensal','Receitas recebidas','Despesas pagas','Total comprometido','Lançamentos','Situação','Status'])];
  rows.forEach((row) => lines.push(csvLine([
    row.code, row.name, row.client, row.contract_number, row.responsible, row.start_date, row.end_date,
    decimalBr(row.contract_amount), decimalBr(row.monthly_budget), decimalBr(row.revenues),
    decimalBr(row.expenses), decimalBr(row.committed), row.transactions_count, row.project_status,
    row.active ? 'Ativo' : 'Inativo',
  ])));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="centros-de-custo.csv"');
  res.send(`\uFEFF${lines.join('\r\n')}`);
}));

router.post('/', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const data = validate(req.body);
  const publicId = crypto.randomUUID();
  const { rows } = await getDb().query(
    `INSERT INTO cost_centers
      (public_id,code,name,responsible,monthly_budget,client,contract_number,start_date,end_date,contract_amount,project_status,description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,revision`,
    [publicId,data.code,data.name,data.responsible,data.budget,data.client,data.contractNumber,
      data.startDate,data.endDate,data.contractAmount,data.projectStatus,data.description]
  );
  await recordAudit({entityType:'obra',entityId:rows[0].id,action:'criada',summary:'Obra / centro criado: '+data.name,data,user:req.usuario});
  res.status(201).json(rows[0]);
}));

router.put('/:id', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const data = validate(req.body);
  const result = await getDb().query(
    `UPDATE cost_centers SET code=$1,name=$2,responsible=$3,monthly_budget=$4,active=$5,
       client=$6,contract_number=$7,start_date=$8,end_date=$9,contract_amount=$10,
       project_status=$11,description=$12,revision=revision+1,updated_at=NOW() WHERE id=$13 RETURNING revision`,
    [data.code,data.name,data.responsible,data.budget,req.body.ativo !== false,data.client,
      data.contractNumber,data.startDate,data.endDate,data.contractAmount,data.projectStatus,
      data.description,positiveId(req.params.id)]
  );
  if (!result.rowCount) throw httpError(404, 'Centro de custo não encontrado.');
  await recordAudit({entityType:'obra',entityId:req.params.id,action:'atualizada',summary:'Obra / centro atualizado: '+data.name,data:{...data,revision:result.rows[0].revision},user:req.usuario});
  res.json({ ok: true,revisao:result.rows[0].revision });
}));

router.delete('/:id', exigirPapel('admin'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const check = await getDb().query('SELECT id, name FROM cost_centers WHERE id = $1', [id]);
  if (!check.rows[0]) throw httpError(404, 'Centro de custo não encontrado.');
  const hasTransactions = await getDb().query('SELECT 1 FROM transactions WHERE cost_center_id = $1 LIMIT 1', [id]);
  if (hasTransactions.rows.length) throw httpError(409, 'Centro de custo possui lançamentos vinculados. Exclua-os primeiro ou inative o centro.');
  const hasBaselines = await getDb().query('SELECT 1 FROM project_contracts WHERE cost_center_id = $1 LIMIT 1', [id]);
  if (hasBaselines.rows.length) throw httpError(409, 'Centro de custo possui contratos/baselines vinculados. Remova-os primeiro.');
  await getDb().query('DELETE FROM cost_centers WHERE id = $1', [id]);
  await recordAudit({entityType:'obra',entityId:id,action:'excluida',summary:'Obra / centro excluído: '+check.rows[0].name,data:null,user:req.usuario});
  res.json({ ok: true });
}));

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

router.post('/:id/apropriacoes', exigirPapel('admin', 'gestor'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  if (req.body.allocationId) {
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

router.post('/:id/apropriacoes/:allocId/desmapear', exigirPapel('admin', 'gestor'), asyncRoute(async (req, res) => {
  const result = await unmapAllocation(getDb(), req.params.allocId);
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

router.post('/:id/medicoes', exigirPapel('admin', 'gestor'), asyncRoute(async (req, res) => {
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

function reportMonth(query) {
  const month = query.mes || currentMonth();
  if (!validMonth(month)) throw httpError(400, 'Mês inválido. Use AAAA-MM.');
  return {month,range:monthRange(month)};
}

function validate(body) {
  const code = String(body.codigo || '').trim();
  const name = String(body.nome || '').trim();
  const responsible = String(body.responsavel || '').trim() || null;
  const budget = Number(body.orcamento || 0);
  const client = String(body.cliente || '').trim() || null;
  const contractNumber = String(body.contrato || '').trim() || null;
  const startDate = String(body.data_inicio || '').trim() || null;
  const endDate = String(body.data_fim || '').trim() || null;
  const contractAmount = Number(body.valor_contrato || 0);
  const projectStatus = String(body.situacao || 'planejamento');
  const description = String(body.descricao || '').trim() || null;
  if (!code || !name) throw httpError(400, 'Informe código e nome.');
  if (!Number.isFinite(budget) || budget < 0) throw httpError(400, 'Orçamento inválido.');
  if (!Number.isFinite(contractAmount) || contractAmount < 0) throw httpError(400, 'Valor contratado inválido.');
  if (startDate && !validDate(startDate)) throw httpError(400, 'Data inicial inválida.');
  if (endDate && !validDate(endDate)) throw httpError(400, 'Data final inválida.');
  if (startDate && endDate && endDate < startDate) throw httpError(400, 'A data final não pode ser anterior à inicial.');
  if (!['planejamento','execucao','pausado','concluido'].includes(projectStatus)) throw httpError(400, 'Situação da obra inválida.');
  return { code:code.slice(0,40),name:name.slice(0,140),responsible:responsible?.slice(0,120),budget,
    client:client?.slice(0,160),contractNumber:contractNumber?.slice(0,80),startDate,endDate,
    contractAmount,projectStatus,description };
}

module.exports = router;
