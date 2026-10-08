// Lancamento rapido de gasto no servico: cria uma despesa normal (transactions) com expense_kind,
// na categoria correspondente ao tipo, e o recibo opcional em transaction_attachments.
const crypto = require('crypto');
const { getDb, getInstanceIdentity } = require('../../db');
const { httpError } = require('../../lib/http');
const { validDate, todayIso } = require('../../lib/dates');
const { isMonthClosed } = require('../financialPolicy');
const { readClientId, findReplay, isClientIdConflict, ensureCreatedAudit } = require('../../lib/transactionIdempotency');
const { recordAudit } = require('../audit');
const { EXPENSE_KINDS, KIND_LABELS, KIND_CATEGORY, loadService } = require('./core');
const { decodeReceipt } = require('./files');

async function categoryFor(db, kind, requested) {
  if (requested != null && requested !== '') {
    const { rows } = await db.query("SELECT id FROM categories WHERE id=$1 AND active=TRUE AND type IN ('despesa','ambos')", [Number(requested)]);
    if (!rows[0]) throw httpError(400, 'Categoria inválida para despesa.');
    return rows[0].id;
  }
  const byName = await db.query("SELECT id FROM categories WHERE LOWER(name)=LOWER($1) AND active=TRUE AND type IN ('despesa','ambos')", [KIND_CATEGORY[kind]]);
  if (byName.rows[0]) return byName.rows[0].id;
  const any = await db.query("SELECT id FROM categories WHERE active=TRUE AND type IN ('despesa','ambos') ORDER BY (type='despesa') DESC,id LIMIT 1");
  if (!any.rows[0]) throw httpError(409, 'Cadastre uma categoria de despesa antes de lançar gastos.');
  return any.rows[0].id;
}

function readBody(body) {
  const kind = String(body?.tipo || '').trim().toLowerCase();
  if (!EXPENSE_KINDS.includes(kind)) throw httpError(400, `Tipo de gasto inválido. Use ${EXPENSE_KINDS.join(', ')}.`);
  const amount = Number(body?.valor);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99) throw httpError(400, 'O valor precisa ser maior que zero.');
  if (Math.round(amount * 100) / 100 !== amount) throw httpError(400, 'Informe o valor com no máximo 2 casas decimais.');
  const date = String(body?.data || todayIso());
  if (!validDate(date)) throw httpError(400, 'Informe uma data válida.');
  const status = String(body?.statusFinanceiro || 'liquidado');
  if (!['liquidado', 'pendente'].includes(status)) throw httpError(400, 'Situação financeira inválida.');
  const description = (String(body?.descricao || '').trim() || KIND_LABELS[kind]).slice(0, 240);
  return {
    kind, amount, date, status, description,
    counterparty: String(body?.favorecido || '').trim().slice(0, 160) || null,
    paymentMethod: String(body?.formaPagamento || '').trim().slice(0, 40) || null,
    notes: String(body?.observacao || '').trim().slice(0, 5000) || null,
  };
}

async function quickExpense(id, body, user) {
  const db = getDb();
  const { center } = await loadService(db, id);
  if (!center.active) throw httpError(400, 'Este serviço está inativo. Reative-o para lançar gastos.');
  const input = readBody(body);
  const receipt = body?.recibo ? decodeReceipt(body.recibo) : null;
  const clientId = readClientId(body);
  const data = { type: 'despesa', costCenterId: id, amount: input.amount, date: input.date, description: input.description,
    expenseKind: input.kind, financialStatus: input.status };
  const replay = await findReplay(db, user.id, clientId, data);
  if (replay) return { status: 200, body: { ...replay, tipo: input.kind } };
  if (await isMonthClosed(input.date)) throw httpError(403, 'Esta competência está fechada. Não é possível criar lançamentos nela.');
  const categoryId = await categoryFor(db, input.kind, body?.categoriaId);
  const instance = getInstanceIdentity();
  let created;
  try {
    created = await db.transaction(async (tx) => {
      const row = (await tx.query(`INSERT INTO transactions
          (public_id,type,cost_center_id,category_id,description,counterparty,amount,transaction_date,notes,due_date,settlement_date,
           financial_status,payment_method,origin_instance_id,origin_instance_name,last_modified_instance_id,last_modified_instance_name,
           origin_user_name,created_by,client_id,expense_kind)
        VALUES ($1,'despesa',$2,$3,$4,$5,$6,$7,$8,$7,$9,$10,$11,$12,$13,$12,$13,$14,$15,$16,$17) RETURNING id,public_id`,
      [crypto.randomUUID(), id, categoryId, input.description, input.counterparty, input.amount, input.date, input.notes,
        input.status === 'liquidado' ? input.date : null, input.status, input.paymentMethod, instance.id, instance.name,
        user.name, user.id, clientId, input.kind])).rows[0];
      let anexo = null;
      if (receipt) {
        anexo = (await tx.query(`INSERT INTO transaction_attachments
            (public_id,transaction_id,original_name,mime_type,size_bytes,sha256,content,category,created_by,created_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'recibo',$8,$9) RETURNING id`,
        [crypto.randomUUID(), row.id, receipt.name, receipt.mime, receipt.content.length, receipt.sha256, receipt.content, user.id, user.name])).rows[0];
      }
      return { ...row, anexoId: anexo?.id || null };
    });
  } catch (error) {
    if (!isClientIdConflict(error)) throw error;
    return { status: 200, body: { ...(await findReplay(db, user.id, clientId, data)), tipo: input.kind } };
  }
  await ensureCreatedAudit(created.public_id, data, user);
  await recordAudit({ entityType: 'servico', entityId: center.public_id, action: 'gasto_lancado',
    summary: `Gasto (${KIND_LABELS[input.kind]}) lançado no serviço ${center.code}`,
    data: { lancamento: created.public_id, tipo: input.kind, valor: input.amount, recibo: Boolean(receipt) }, user });
  return { status: 201, body: { id: created.id, public_id: created.public_id, tipo: input.kind, categoriaId: categoryId, anexoId: created.anexoId } };
}

module.exports = { quickExpense };
