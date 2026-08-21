const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { csvLine, decimalBr } = require('../lib/csv');
const { validDate } = require('../lib/dates');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

router.get('/', asyncRoute(async (req, res) => {
  const { rows } = await getDb().query(`
    SELECT cc.id, cc.code AS codigo, cc.name AS nome, cc.responsible AS responsavel,
      cc.client AS cliente, cc.contract_number AS contrato,
      cc.start_date::text AS data_inicio, cc.end_date::text AS data_fim,
      cc.contract_amount AS valor_contrato, cc.project_status AS situacao,
      cc.monthly_budget AS orcamento, cc.active AS ativo, cc.description AS descricao,cc.revision,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa'),0) AS total_comprometido,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa' AND t.financial_status='liquidado'),0) AS total_despesas,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='receita' AND t.financial_status='liquidado'),0) AS total_receitas
    FROM cost_centers cc LEFT JOIN transactions t ON t.cost_center_id=cc.id AND t.deleted_at IS NULL
    GROUP BY cc.id ORDER BY cc.active DESC, cc.name
  `);
  res.json(rows);
}));

router.get('/:id/detalhes', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const db = getDb();
  const centerResult = await db.query(`
    SELECT cc.id, cc.code AS codigo, cc.name AS nome, cc.responsible AS responsavel,
      cc.client AS cliente, cc.contract_number AS contrato, cc.description AS descricao,
      cc.start_date::text AS data_inicio, cc.end_date::text AS data_fim,
      cc.contract_amount AS valor_contrato, cc.project_status AS situacao,
      cc.monthly_budget AS orcamento, cc.active AS ativo,cc.revision,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa'),0) AS total_comprometido,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa' AND t.financial_status='liquidado'),0) AS total_despesas,
      COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='receita' AND t.financial_status='liquidado'),0) AS total_receitas,
      COUNT(t.id) FILTER (WHERE t.deleted_at IS NULL) AS total_lancamentos
    FROM cost_centers cc LEFT JOIN transactions t ON t.cost_center_id=cc.id
    WHERE cc.id=$1 GROUP BY cc.id
  `, [id]);
  if (!centerResult.rows[0]) throw httpError(404, 'Centro de custo não encontrado.');
  const center = centerResult.rows[0];
  const { rows: transactions } = await db.query(`
    SELECT t.id, t.public_id, t.type AS tipo, t.description AS descricao, t.counterparty AS favorecido,
      t.amount AS valor,t.accounting_sign AS sinal_contabil,t.reversal_of AS estorno_de,
      t.reversal_reason AS motivo_estorno,t.reversed_at,
      t.transaction_date::text AS data, t.due_date::text AS vencimento,
      t.financial_status AS status_financeiro, t.document_number AS documento,
      t.payment_method AS forma_pagamento, t.notes AS observacao,
      CASE WHEN t.financial_status='pendente' AND t.due_date<CURRENT_DATE THEN 'vencido'
        ELSE t.financial_status END AS situacao,
      c.name AS categoria
    FROM transactions t JOIN categories c ON c.id=t.category_id
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
    FROM cost_centers cc LEFT JOIN transactions t ON t.cost_center_id=cc.id AND t.deleted_at IS NULL
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
