const { financialTransactionsSql, allocatedTransactionsSql } = require('../services/financialProjection');
const express = require('express');
const { getDb } = require('../db');
const { autenticar } = require('../middleware/auth');
const { obrasDaConsulta } = require('../services/obraScope');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { currentMonth, validMonth, monthRange, monthsEndingAt, todaySql } = require('../lib/dates');

const router = express.Router();
router.use(autenticar);

router.get('/resumo', asyncRoute(async (req, res) => {
  const started = process.hrtime.bigint();
  const month = req.query.mes || currentMonth();
  if (!validMonth(month)) throw httpError(400, 'Mês inválido. Use AAAA-MM.');
  const centerId = req.query.centroId ? positiveId(req.query.centroId, 'Centro de custo') : null;
  // Lista de obras do filtro: a obra pedida, ou so as do usuario escopado; null = todas.
  const obras = await obrasDaConsulta(req);
  const scopeIds = centerId ? [centerId] : obras;
  const range = monthRange(month);
  const sourceSql = scopeIds ? allocatedTransactionsSql : financialTransactionsSql;
  const params = [range.start, range.end, scopeIds];
  const db = getDb();
  // Quantos meses na evolucao: 6 por padrao (painel atual); o desktop novo pede 12.
  const trendCount = req.query.meses == null ? 6 : Number(req.query.meses);
  if (!Number.isInteger(trendCount) || trendCount < 1 || trendCount > 24) throw httpError(400, 'Meses da evolução inválidos. Use de 1 a 24.');
  const months = monthsEndingAt(month, trendCount);

  const [summary, overdue, centers, categories, recent, trend] = await Promise.all([
    db.query(`
      SELECT
        COALESCE(SUM(amount * accounting_sign) FILTER (WHERE type='receita' AND financial_status='liquidado'
          AND transaction_date >= $1 AND transaction_date < $2),0) AS receitas,
        COALESCE(SUM(amount * accounting_sign) FILTER (WHERE type='despesa' AND financial_status='liquidado'
          AND transaction_date >= $1 AND transaction_date < $2),0) AS despesas,
        COALESCE(SUM(amount * accounting_sign) FILTER (WHERE type='receita' AND financial_status='pendente'
          AND COALESCE(due_date,transaction_date) >= $1 AND COALESCE(due_date,transaction_date) < $2),0) AS a_receber,
        COALESCE(SUM(amount * accounting_sign) FILTER (WHERE type='despesa' AND financial_status='pendente'
          AND COALESCE(due_date,transaction_date) >= $1 AND COALESCE(due_date,transaction_date) < $2),0) AS a_pagar,
        COUNT(*) FILTER (WHERE transaction_date >= $1 AND transaction_date < $2) AS qtd_lancamentos,
        COUNT(DISTINCT id) FILTER (WHERE type='receita' AND financial_status='liquidado' AND accounting_sign=1
          AND transaction_date >= $1 AND transaction_date < $2) AS qtd_recebidos,
        COUNT(DISTINCT id) FILTER (WHERE type='despesa' AND financial_status='liquidado' AND accounting_sign=1
          AND transaction_date >= $1 AND transaction_date < $2) AS qtd_pagos
      FROM ${sourceSql} t WHERE deleted_at IS NULL AND ($3::int[] IS NULL OR cost_center_id = ANY($3::int[]))
    `, params),
    db.query(`
      SELECT COALESCE(SUM(amount * accounting_sign),0) AS total,COUNT(*) AS quantidade
      FROM ${sourceSql} t WHERE deleted_at IS NULL AND financial_status='pendente'
        AND due_date<${todaySql()} AND accounting_sign=1 AND ($1::int[] IS NULL OR cost_center_id = ANY($1::int[]))
    `, [scopeIds]),
    db.query(`
      SELECT cc.id,cc.code AS codigo,cc.name AS nome,cc.client AS cliente,
        cc.monthly_budget AS orcamento,cc.project_status AS situacao,
        COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='receita' AND t.financial_status='liquidado'),0) AS receitas,
        COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa' AND t.financial_status='liquidado'),0) AS despesas,
        COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.type='despesa'),0) AS comprometido,
        COUNT(t.id) AS qtd_lancamentos
      FROM cost_centers cc LEFT JOIN ${allocatedTransactionsSql} t ON t.cost_center_id=cc.id AND t.deleted_at IS NULL
        AND t.transaction_date >= $1 AND t.transaction_date < $2
      WHERE cc.active=TRUE AND ($3::int[] IS NULL OR cc.id = ANY($3::int[]))
      GROUP BY cc.id ORDER BY despesas DESC,cc.name
    `, params),
    db.query(`
      SELECT c.id,c.name AS categoria,t.type AS tipo,SUM(t.amount * t.accounting_sign) AS total,COUNT(*) AS quantidade
      FROM ${sourceSql} t JOIN categories c ON c.id=t.category_id
      WHERE t.deleted_at IS NULL AND t.transaction_date >= $1 AND t.transaction_date < $2
        AND ($3::int[] IS NULL OR t.cost_center_id = ANY($3::int[]))
      GROUP BY c.id,t.type ORDER BY t.type,total DESC
    `, params),
    db.query(`
      SELECT t.id,t.type AS tipo,t.transaction_date::text AS data,t.description AS descricao,
        t.due_date::text AS vencimento,t.financial_status AS status_financeiro,
        t.accounting_sign AS sinal_contabil,t.reversal_of AS estorno_de,
        CASE WHEN t.financial_status='pendente' AND t.due_date<${todaySql()} THEN 'vencido'
          ELSE t.financial_status END AS situacao,
        t.amount AS valor,cc.name AS centro_nome,c.name AS categoria,
        t.counterparty AS favorecido,t.document_number AS documento,
        t.settlement_date::text AS data_liquidacao,cc.code AS centro_codigo
      FROM ${sourceSql} t JOIN cost_centers cc ON cc.id=t.cost_center_id
      JOIN categories c ON c.id=t.category_id
      WHERE t.deleted_at IS NULL AND t.transaction_date >= $1 AND t.transaction_date < $2
        AND ($3::int[] IS NULL OR t.cost_center_id = ANY($3::int[]))
      ORDER BY t.created_at DESC LIMIT 8
    `, params),
    db.query(`
      SELECT TO_CHAR(DATE_TRUNC('month',transaction_date),'YYYY-MM') AS mes,
        COALESCE(SUM(amount * accounting_sign) FILTER (WHERE type='receita'),0) AS receitas,
        COALESCE(SUM(amount * accounting_sign) FILTER (WHERE type='despesa'),0) AS despesas
      FROM ${sourceSql} t WHERE deleted_at IS NULL AND financial_status='liquidado'
        AND transaction_date >= $1 AND transaction_date < $2
        AND ($3::int[] IS NULL OR cost_center_id = ANY($3::int[]))
      GROUP BY DATE_TRUNC('month',transaction_date) ORDER BY mes
    `, [`${months[0]}-01`, range.end, scopeIds]),
  ]);

  const trendMap = new Map(trend.rows.map((row) => [row.mes, row]));
  const totals = summary.rows[0];
  const budget = centers.rows.reduce((sum, item) => sum + Number(item.orcamento), 0);
  const committed = centers.rows.reduce((sum, item) => sum + Number(item.comprometido), 0);
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  res.setHeader('Server-Timing', `dashboard;dur=${durationMs.toFixed(2)}`);
  res.json({
    mes:month,
    geradoEm:new Date().toISOString(),
    receitas:Number(totals.receitas),
    despesas:Number(totals.despesas),
    saldo:Number(totals.receitas) - Number(totals.despesas),
    orcamento:budget,
    aReceber:Number(totals.a_receber),
    aPagar:Number(totals.a_pagar),
    vencidos:Number(overdue.rows[0].total),
    qtdVencidos:Number(overdue.rows[0].quantidade),
    comprometido:committed,
    saldoOrcamento:budget - committed,
    qtdLancamentos:Number(totals.qtd_lancamentos),
    qtdRecebidos:Number(totals.qtd_recebidos),
    qtdPagos:Number(totals.qtd_pagos),
    porCentro:centers.rows,
    porCategoria:categories.rows,
    ultimosLancamentos:recent.rows,
    tendencia:months.map((item) => trendMap.get(item) || { mes:item, receitas:0, despesas:0 }),
  });
}));

module.exports = router;
