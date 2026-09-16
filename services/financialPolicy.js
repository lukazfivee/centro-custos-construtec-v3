const { getDb } = require('../db');
const { httpError } = require('../lib/http');

async function isMonthClosed(date, client = getDb()) {
  if (!date) return false;
  const value = date instanceof Date ? date.toISOString() : String(date);
  const [year, month] = value.slice(0, 7).split('-').map(Number);
  const { rows } = await client.query(
    'SELECT id FROM monthly_closings WHERE year=$1 AND month=$2', [year, month]);
  return Boolean(rows[0]);
}

async function assertMutableTransaction(row, client) {
  if (!row || row.deleted_at) throw httpError(404, 'Lançamento não encontrado.');
  if (row.reversal_of || row.reversed_at || Number(row.accounting_sign) === -1) {
    throw httpError(409, 'O lançamento faz parte de um estorno e deve permanecer no histórico.');
  }
  if (await isMonthClosed(row.transaction_date, client)) {
    throw httpError(403, 'Esta competência está fechada. Reabra o período antes de alterar o lançamento.');
  }
}

// Allocation inputs must already denote cents. Do not silently round a split or
// tolerate a one-cent difference that would make center totals disagree.
function moneyCents(value) {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw httpError(400, 'Informe um valor positivo com até duas casas decimais.');
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw httpError(400, 'Valor de rateio inválido.');
  return cents;
}

module.exports = { isMonthClosed, assertMutableTransaction, moneyCents };
