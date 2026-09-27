'use strict';
// Lançamentos com client_id (gerado no celular): reenviar o mesmo lançamento não duplica.
const { httpError } = require('./http');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readClientId(body) {
  const raw = body && body.client_id;
  if (raw === undefined || raw === null || raw === '') return null;
  const value = String(raw).trim().toLowerCase();
  if (!UUID.test(value)) throw httpError(400, 'Identificador do lançamento (client_id) inválido.');
  return value;
}

function sameDate(value, expected) {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
  return text === expected;
}

// Mesmo lançamento = mesmo tipo, obra, valor, data e descrição. Qualquer diferença é conflito.
function samePayload(row, data) {
  return row.type === data.type
    && Number(row.cost_center_id) === Number(data.costCenterId)
    && Number(row.amount).toFixed(2) === Number(data.amount).toFixed(2)
    && sameDate(row.transaction_date, data.date)
    && row.description === data.description;
}

async function findReplay(db, userId, clientId, data) {
  if (!clientId) return null;
  const { rows } = await db.query(
    `SELECT id,public_id,type,cost_center_id,amount,transaction_date,description,deleted_at
       FROM transactions WHERE created_by=$1 AND client_id=$2`, [userId, clientId]);
  const row = rows[0];
  if (!row) return null;
  if (!samePayload(row, data)) {
    const error = httpError(409, 'Este identificador já foi usado em outro lançamento.');
    error.publicMessage = 'Este identificador já foi usado em outro lançamento.';
    throw error;
  }
  return { id: row.id, public_id: row.public_id, replayed: true, excluido: Boolean(row.deleted_at) };
}

function isClientIdConflict(error) {
  return error && error.code === '23505' && String(error.constraint || error.message || '').includes('transactions_client_id_unique');
}

module.exports = { readClientId, findReplay, isClientIdConflict };
