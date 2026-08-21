const crypto = require('crypto');
const express = require('express');
const { getDb, getInstanceIdentity } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { buildTransactionFilters } = require('../lib/transactionFilters');
const { parsePagination, wantsPagination, paginationMeta } = require('../lib/pagination');
const { validDate } = require('../lib/dates');
const { csvLine, decimalBr } = require('../lib/csv');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

async function isMonthClosed(dateStr) {
  if (!dateStr) return false;
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00`);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const { rows } = await getDb().query('SELECT id FROM monthly_closings WHERE year=$1 AND month=$2', [year, month]);
  return Boolean(rows[0]);
}

const selectSql = `
  SELECT t.id,t.public_id,t.type AS tipo,t.cost_center_id,t.category_id,
    t.description AS descricao,t.counterparty AS favorecido,t.amount AS valor,
    t.accounting_sign AS sinal_contabil,t.reversal_of AS estorno_de,
    t.reversal_reason AS motivo_estorno,t.reversed_at,
    EXISTS(SELECT 1 FROM transactions tr WHERE tr.reversal_of=t.public_id AND tr.deleted_at IS NULL) AS estornado,
    t.transaction_date::text AS data,t.due_date::text AS vencimento,
    t.settlement_date::text AS data_liquidacao,t.financial_status AS status_financeiro,
    CASE WHEN t.financial_status='pendente' AND t.due_date<CURRENT_DATE THEN 'vencido'
      ELSE t.financial_status END AS situacao,
    t.document_number AS documento,t.payment_method AS forma_pagamento,
    t.notes AS observacao,t.revision,t.updated_at,
    t.origin_instance_name AS origem_nome,t.last_modified_instance_name AS alterado_em_instalacao,
    t.origin_user_name AS criado_por_nome,cc.code AS centro_codigo,cc.name AS centro_nome,
    c.name AS categoria
  FROM transactions t
  JOIN cost_centers cc ON cc.id=t.cost_center_id
  JOIN categories c ON c.id=t.category_id`;

router.get('/', asyncRoute(async (req, res) => {
  const { where, values } = buildTransactionFilters(req.query);
  const orderBy = transactionOrder(req.query);
  if (!wantsPagination(req.query)) {
    const { rows } = await getDb().query(
      `${selectSql} ${where} ORDER BY ${orderBy} LIMIT 1000`, values
    );
    res.setHeader('X-Result-Limit', '1000');
    return res.json(rows);
  }

  const { page, limit, offset } = parsePagination(req.query, { defaultLimit:50, maxLimit:200 });
  const limitPosition = values.length + 1;
  const offsetPosition = values.length + 2;
  const [dataResult, countResult] = await Promise.all([
    getDb().query(
      `${selectSql} ${where} ORDER BY ${orderBy} LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
      [...values, limit, offset],
    ),
    getDb().query(`SELECT COUNT(*)::int AS total FROM transactions t ${where}`, values),
  ]);
  const total = Number(countResult.rows[0]?.total || 0);
  res.setHeader('X-Total-Count', String(total));
  return res.json({ itens:dataResult.rows, paginacao:paginationMeta(total, page, limit) });
}));

router.get('/exportar.csv', asyncRoute(async (req, res) => {
  const { where, values } = buildTransactionFilters(req.query);
  const { rows } = await getDb().query(
    `${selectSql} ${where} ORDER BY t.transaction_date DESC,t.id DESC LIMIT 10000`, values
  );
  const lines = [csvLine(['Competência','Vencimento','Situação','Tipo','Natureza','Centro','Obra / centro','Categoria','Descrição','Cliente / fornecedor','Documento','Forma de pagamento','Valor','Observação'])];
  rows.forEach((row) => lines.push(csvLine([
    row.data,row.vencimento,row.situacao,row.tipo,row.estorno_de ? 'Estorno' : 'Lançamento',
    row.centro_codigo,row.centro_nome,row.categoria,row.descricao,row.favorecido,row.documento,
    row.forma_pagamento,decimalBr(Number(row.valor) * Number(row.sinal_contabil || 1)),row.observacao,
  ])));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-lancamentos.csv"');
  res.send(`\uFEFF${lines.join('\r\n')}`);
}));

router.post('/', asyncRoute(async (req, res) => {
  const data = validatePayload(req.body);
  if (await isMonthClosed(data.date)) {
    throw httpError(403, 'Esta competência está fechada. Não é possível criar lançamentos nela.');
  }
  await validateRelations(data, true);
  const instance = getInstanceIdentity();
  const { rows } = await getDb().query(
    `INSERT INTO transactions
      (public_id,type,cost_center_id,category_id,description,counterparty,amount,transaction_date,notes,
       due_date,settlement_date,financial_status,document_number,payment_method,
       origin_instance_id,origin_instance_name,last_modified_instance_id,last_modified_instance_name,
       origin_user_name,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$15,$16,$17,$18)
     RETURNING id,public_id`,
    [crypto.randomUUID(),data.type,data.costCenterId,data.categoryId,data.description,data.counterparty,
      data.amount,data.date,data.notes,data.dueDate,data.settlementDate,data.financialStatus,
      data.documentNumber,data.paymentMethod,instance.id,instance.name,req.usuario.name,req.usuario.id]
  );
  await recordAudit({
    entityType:'lancamento',entityId:rows[0].public_id,action:'criado',
    summary:`Lançamento criado: ${data.description}`,data,user:req.usuario,
  });
  res.status(201).json(rows[0]);
}));

router.post('/:id/estornar', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const reason = String(req.body.motivo || '').trim();
  const reversalDate = String(req.body.data_estorno || new Date().toISOString().slice(0,10));
  if (reason.length < 5) throw httpError(400, 'Informe o motivo do estorno com pelo menos 5 caracteres.');
  if (!validDate(reversalDate)) throw httpError(400, 'Informe uma data de estorno válida.');
  if (await isMonthClosed(reversalDate)) throw httpError(403, 'A competência escolhida para o estorno está fechada. Escolha uma competência aberta.');

  const db = getDb();
  const instance = getInstanceIdentity();
  let created;
  await db.transaction(async (tx) => {
    const originalResult = await tx.query(
      `SELECT * FROM transactions WHERE id=$1 AND deleted_at IS NULL`, [id]
    );
    const original = originalResult.rows[0];
    if (!original) throw httpError(404, 'Lançamento não encontrado.');
    if (original.reversal_of) throw httpError(409, 'Um estorno não pode ser estornado novamente. Crie um novo lançamento corretivo, se necessário.');
    if (Number(original.accounting_sign || 1) !== 1) throw httpError(409, 'Este registro já é um movimento de estorno.');
    if (original.financial_status !== 'liquidado') {
      throw httpError(400, 'Somente lançamentos pagos ou recebidos podem ser estornados. Para pendências em competência aberta, edite ou exclua o lançamento.');
    }
    const prior = await tx.query(
      'SELECT id FROM transactions WHERE reversal_of=$1 AND deleted_at IS NULL', [original.public_id]
    );
    if (prior.rows[0]) throw httpError(409, 'Este lançamento já possui estorno.');

    const publicId = crypto.randomUUID();
    const description = `ESTORNO — ${original.description}`.slice(0,240);
    const notes = [`Motivo do estorno: ${reason}`, `Lançamento original: ${original.public_id}`, original.notes || '']
      .filter(Boolean).join('\n').slice(0,5000);
    const insert = await tx.query(
      `INSERT INTO transactions
        (public_id,type,cost_center_id,category_id,description,counterparty,amount,accounting_sign,reversal_of,reversal_reason,
         transaction_date,notes,due_date,settlement_date,financial_status,document_number,payment_method,
         origin_instance_id,origin_instance_name,last_modified_instance_id,last_modified_instance_name,
         origin_user_name,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,-1,$8,$9,$10,$11,$10,$10,'liquidado',$12,$13,$14,$15,$14,$15,$16,$17,$17)
       RETURNING id,public_id,revision`,
      [publicId,original.type,original.cost_center_id,original.category_id,description,original.counterparty,
        original.amount,original.public_id,reason.slice(0,500),reversalDate,notes,original.document_number,
        original.payment_method,instance.id,instance.name,req.usuario.name,req.usuario.id]
    );
    await tx.query(
      `UPDATE transactions SET reversed_at=NOW(),reversed_by=$1,updated_at=NOW(),revision=revision+1,
        last_modified_instance_id=$2,last_modified_instance_name=$3,updated_by=$1
       WHERE id=$4`,
      [req.usuario.id,instance.id,instance.name,id]
    );
    created = insert.rows[0];
    await recordAudit({
      entityType:'lancamento',entityId:original.public_id,action:'estornado',
      summary:`Lançamento estornado: ${original.description}`,
      data:{ motivo:reason,dataEstorno:reversalDate,estornoPublicId:publicId,valor:Number(original.amount) },
      user:req.usuario,client:tx,
    });
  });
  res.status(201).json({
    ok:true,
    mensagem:'Estorno registrado. O histórico original foi preservado e o efeito financeiro foi compensado.',
    estorno:created,
  });
}));

router.put('/:id', asyncRoute(async (req, res) => {
  const data = validatePayload(req.body);
  const id = positiveId(req.params.id);
  const expectedRevision = Number(req.body.revisao);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw httpError(400, 'Revisão do lançamento inválida. Atualize a lista e tente novamente.');
  }
  const existingResult = await getDb().query(
    `SELECT public_id,description,transaction_date::text AS data,revision,deleted_at,reversal_of,reversed_at,accounting_sign
     FROM transactions WHERE id=$1`, [id]
  );
  const existing = existingResult.rows[0];
  if (!existing) throw httpError(404, 'Lançamento não encontrado.');
  if (existing.deleted_at) {
    throw httpError(409, 'Este lançamento foi excluído. Atualize a lista antes de tentar editá-lo.');
  }
  if (existing.reversal_of || Number(existing.accounting_sign || 1) === -1) {
    throw httpError(409, 'Movimentos de estorno não podem ser editados.');
  }
  if (existing.reversed_at) {
    throw httpError(409, 'Este lançamento já foi estornado e não pode mais ser editado.');
  }
  if (Number(existing.revision) !== expectedRevision) {
    throw httpError(409, 'Este lançamento foi alterado. Atualize a lista antes de editar novamente.');
  }
  if (await isMonthClosed(existing.data) || await isMonthClosed(data.date)) {
    throw httpError(403, 'A competência de origem ou destino está fechada. Não é possível editar este lançamento.');
  }
  await validateRelations(data, false);
  const instance = getInstanceIdentity();
  const result = await getDb().query(
    `UPDATE transactions SET type=$1,cost_center_id=$2,category_id=$3,description=$4,counterparty=$5,
       amount=$6,transaction_date=$7,notes=$8,due_date=$9,settlement_date=$10,
       financial_status=$11,document_number=$12,payment_method=$13,last_modified_instance_id=$14,
       last_modified_instance_name=$15,revision=revision+1,updated_by=$16,updated_at=NOW()
     WHERE id=$17 AND revision=$18 AND deleted_at IS NULL AND reversal_of IS NULL AND reversed_at IS NULL
     RETURNING revision`,
    [data.type,data.costCenterId,data.categoryId,data.description,data.counterparty,data.amount,
      data.date,data.notes,data.dueDate,data.settlementDate,data.financialStatus,data.documentNumber,
      data.paymentMethod,instance.id,instance.name,req.usuario.id,id,expectedRevision]
  );
  if (!result.rowCount) {
    throw httpError(409, 'Este lançamento foi alterado, excluído ou estornado. Atualize a lista antes de editar novamente.');
  }
  await recordAudit({
    entityType:'lancamento',entityId:existing.public_id,action:'atualizado',
    summary:`Lançamento atualizado: ${data.description}`,data,user:req.usuario,
  });
  res.json({ ok:true, revisao:result.rows[0].revision });
}));

router.delete('/:id', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const instance = getInstanceIdentity();
  const id = positiveId(req.params.id);
  const existingResult = await getDb().query(
    `SELECT public_id,description,transaction_date::text AS data,reversal_of,reversed_at,accounting_sign
     FROM transactions WHERE id=$1 AND deleted_at IS NULL`, [id]
  );
  const existing = existingResult.rows[0];
  if (!existing) throw httpError(404, 'Lançamento não encontrado.');
  if (existing.reversal_of || Number(existing.accounting_sign || 1) === -1) {
    throw httpError(409, 'Movimentos de estorno não podem ser excluídos.');
  }
  if (existing.reversed_at) throw httpError(409, 'Este lançamento já foi estornado e deve permanecer no histórico.');
  if (await isMonthClosed(existing.data)) {
    throw httpError(403, 'Esta competência está fechada. Faça um estorno em período aberto em vez de excluir.');
  }
  const result = await getDb().query(
    `UPDATE transactions SET deleted_at=NOW(),updated_at=NOW(),revision=revision+1,
       last_modified_instance_id=$1,last_modified_instance_name=$2,updated_by=$3
     WHERE id=$4 AND deleted_at IS NULL AND reversal_of IS NULL AND reversed_at IS NULL`,
    [instance.id,instance.name,req.usuario.id,id]
  );
  if (!result.rowCount) throw httpError(404, 'Lançamento não encontrado.');
  await recordAudit({
    entityType:'lancamento',entityId:existing.public_id,action:'excluido',
    summary:`Lançamento enviado para a lixeira: ${existing.description}`,user:req.usuario,
  });
  res.json({ ok:true });
}));

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
  if (relation.category_type !== 'ambos' && relation.category_type !== data.type) {
    throw httpError(400, 'A categoria não é compatível com o tipo do lançamento.');
  }
}

module.exports = router;
