const { httpError, positiveId } = require('./http');
const { validDate, validMonth, monthRange } = require('./dates');

function buildTransactionFilters(query, alias = 't', includeDeleted = false) {
  const clauses = includeDeleted ? [] : [`${alias}.deleted_at IS NULL`];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    clauses.push(sql.replace('?', `$${values.length}`));
  };

  if (query.centroId) add(`${alias}.cost_center_id = ?`, positiveId(query.centroId, 'Centro de custo'));
  if (query.categoriaId) add(`${alias}.category_id = ?`, positiveId(query.categoriaId, 'Categoria'));
  if (query.tipo) {
    if (!['receita', 'despesa'].includes(query.tipo)) throw httpError(400, 'Tipo de lançamento inválido.');
    add(`${alias}.type = ?`, query.tipo);
  }
  if (query.situacao) {
    if (!['pendente','liquidado','vencido'].includes(query.situacao)) throw httpError(400, 'Situação financeira inválida.');
    if (query.situacao === 'vencido') {
      clauses.push(`${alias}.financial_status = 'pendente' AND ${alias}.due_date < CURRENT_DATE`);
    } else {
      add(`${alias}.financial_status = ?`, query.situacao);
    }
  }

  if (query.mes) {
    if (!validMonth(query.mes)) throw httpError(400, 'Mês inválido. Use AAAA-MM.');
    const range = monthRange(query.mes);
    add(`${alias}.transaction_date >= ?`, range.start);
    add(`${alias}.transaction_date < ?`, range.end);
  } else {
    if (query.dataInicio) {
      if (!validDate(query.dataInicio)) throw httpError(400, 'Data inicial inválida.');
      add(`${alias}.transaction_date >= ?`, query.dataInicio);
    }
    if (query.dataFim) {
      if (!validDate(query.dataFim)) throw httpError(400, 'Data final inválida.');
      add(`${alias}.transaction_date <= ?`, query.dataFim);
    }
  }

  if (query.busca && String(query.busca).trim()) {
    const search = `%${String(query.busca).trim().slice(0, 100)}%`;
    values.push(search);
    clauses.push(`(${alias}.description ILIKE $${values.length} OR COALESCE(${alias}.counterparty, '') ILIKE $${values.length})`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

module.exports = { buildTransactionFilters };
