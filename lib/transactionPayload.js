// Validacao do corpo de um lancamento, relacoes (obra e categoria) e ordenacao da lista.
// Separado de routes/transactions.js para a rota caber no limite de 350 linhas.
const { getDb } = require('../db');
const { httpError, positiveId } = require('./http');
const { validDate } = require('./dates');

function transactionOrder(query) {
  const fields = {
    data:'t.transaction_date',
    vencimento:'t.due_date',
    valor:'t.amount',
    criado:'t.created_at',
    atualizado:'t.updated_at',
  };
  const field = fields[String(query.ordenarPor || 'data')] || fields.data;
  const direction = String(query.ordem || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `${field} ${direction},t.id ${direction}`;
}

function validatePayload(body) {
  const type = String(body.tipo || '');
  const description = String(body.descricao || '').trim();
  const counterparty = String(body.favorecido || '').trim() || null;
  const notes = String(body.observacao || '').trim() || null;
  const amount = Number(body.valor);
  const date = String(body.data || '');
  const requestedDueDate = String(body.vencimento || '').trim() || null;
  const requestedSettlement = String(body.data_liquidacao || '').trim() || null;
  const financialStatus = String(body.status_financeiro || 'liquidado');
  const documentNumber = String(body.documento || '').trim() || null;
  const paymentMethod = String(body.forma_pagamento || '').trim() || null;
  if (!['receita','despesa'].includes(type)) throw httpError(400, 'Informe se o lançamento é receita ou despesa.');
  if (!description) throw httpError(400, 'Informe a descrição.');
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99) {
    throw httpError(400, 'O valor precisa ser maior que zero e estar dentro do limite permitido.');
  }
  if (!validDate(date)) throw httpError(400, 'Informe uma data válida.');
  if (requestedDueDate && !validDate(requestedDueDate)) throw httpError(400, 'Informe um vencimento válido.');
  if (requestedSettlement && !validDate(requestedSettlement)) {
    throw httpError(400, 'Informe uma data de pagamento ou recebimento válida.');
  }
  if (!['pendente','liquidado'].includes(financialStatus)) throw httpError(400, 'Situação financeira inválida.');
  const dueDate = requestedDueDate || date;
  const settlementDate = financialStatus === 'liquidado' ? (requestedSettlement || date) : null;
  return {
    type,
    costCenterId:positiveId(body.cost_center_id, 'Centro de custo'),
    categoryId:positiveId(body.category_id, 'Categoria'),
    description:description.slice(0, 240),
    counterparty:counterparty?.slice(0, 160),
    amount,date,notes:notes?.slice(0, 5000),dueDate,settlementDate,financialStatus,
    documentNumber:documentNumber?.slice(0, 80),
    paymentMethod:paymentMethod?.slice(0, 40),
  };
}

async function validateRelations(data, requireActive) {
  const { rows } = await getDb().query(
    `SELECT cc.active AS center_active,c.active AS category_active,c.type AS category_type
     FROM cost_centers cc CROSS JOIN categories c WHERE cc.id=$1 AND c.id=$2`,
    [data.costCenterId,data.categoryId]
  );
  const relation = rows[0];
  if (!relation) throw httpError(400, 'Centro de custo ou categoria não encontrado.');
  if (requireActive && (!relation.center_active || !relation.category_active)) {
    throw httpError(400, 'Use um centro de custo e uma categoria ativos.');
  }
  if (relation.category_type !== 'ambos' && relation.category_type !== data.type) throw httpError(400, 'A categoria não é compatível com o tipo do lançamento.');
}

module.exports = { transactionOrder, validatePayload, validateRelations };
