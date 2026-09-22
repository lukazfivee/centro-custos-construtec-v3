const express = require('express');
const crypto = require('crypto');
const { getDb, getInstanceIdentity } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { parsePagination, wantsPagination, paginationMeta } = require('../lib/pagination');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

const RECURRING_SELECT = `
  SELECT rt.id,rt.name AS nome,rt.type AS tipo,rt.cost_center_id,rt.category_id,
    rt.counterparty AS favorecido,rt.amount AS valor,rt.payment_method AS forma_pagamento,
    rt.day_of_month AS dia_mes,rt.frequency AS frequencia,rt.total_installments AS total_parcelas,
    rt.current_installment AS parcela_atual,rt.active AS ativo,
    cc.code AS centro_codigo,cc.name AS centro_nome,c.name AS categoria
  FROM recurring_templates rt
  JOIN cost_centers cc ON cc.id=rt.cost_center_id
  JOIN categories c ON c.id=rt.category_id`;

router.get('/', asyncRoute(async (req, res) => {
  const orderBy = 'rt.active DESC,rt.name';
  const { where, values } = buildSearchFilter(req.query);
  if (!wantsPagination(req.query)) {
    const { rows } = await getDb().query(`${RECURRING_SELECT} ${where} ORDER BY ${orderBy} LIMIT 500`, values);
    res.setHeader('X-Result-Limit', '500');
    return res.json(rows);
  }
  const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
  const [dataResult, countResult] = await Promise.all([
    getDb().query(`${RECURRING_SELECT} ${where} ORDER BY ${orderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]),
    getDb().query(`SELECT COUNT(*)::int AS total FROM recurring_templates rt ${where}`, values),
  ]);
  const total = Number(countResult.rows[0]?.total || 0);
  res.setHeader('X-Total-Count', String(total));
  return res.json({ itens: dataResult.rows, paginacao: paginationMeta(total, page, limit) });
}));

function buildSearchFilter(query) {
  if (!query.busca || !String(query.busca).trim()) return { where: '', values: [] };
  const search = `%${String(query.busca).trim().slice(0, 100)}%`;
  return { where: 'WHERE rt.name ILIKE $1', values: [search] };
}

router.post('/', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const data = validate(req.body);
  const { rows } = await getDb().query(
    `INSERT INTO recurring_templates (name,type,cost_center_id,category_id,counterparty,amount,
       payment_method,day_of_month,frequency,total_installments,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [data.name,data.type,data.costCenterId,data.categoryId,data.counterparty,data.amount,
     data.paymentMethod,data.dayOfMonth,data.frequency,data.totalInstallments,req.usuario.id]
  );
  await recordAudit({entityType:'recorrente',entityId:rows[0].id,action:'criada',summary:`Modelo recorrente criado: ${data.name}`,data,user:req.usuario});
  res.status(201).json(rows[0]);
}));

router.put('/:id', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const data = validate(req.body);
  const id = positiveId(req.params.id);
  const result = await getDb().query(
    `UPDATE recurring_templates SET name=$1,type=$2,cost_center_id=$3,category_id=$4,
       counterparty=$5,amount=$6,payment_method=$7,day_of_month=$8,frequency=$9,
       total_installments=$10,active=$11,updated_at=NOW() WHERE id=$12`,
    [data.name,data.type,data.costCenterId,data.categoryId,data.counterparty,data.amount,
     data.paymentMethod,data.dayOfMonth,data.frequency,data.totalInstallments,
     req.body.ativo !== false,id]
  );
  if (!result.rowCount) throw httpError(404, 'Modelo não encontrado.');
  await recordAudit({entityType:'recorrente',entityId:id,action:'atualizada',summary:`Modelo recorrente atualizado: ${data.name}`,data,user:req.usuario});
  res.json({ ok: true });
}));

router.delete('/:id', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const result = await getDb().query('DELETE FROM recurring_templates WHERE id=$1', [id]);
  if (!result.rowCount) throw httpError(404, 'Modelo não encontrado.');
  await recordAudit({entityType:'recorrente',entityId:id,action:'excluido',summary:'Modelo recorrente excluído.',user:req.usuario});
  res.json({ ok: true });
}));

router.post('/gerar', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const db = getDb();
  const instance = getInstanceIdentity();
  const user = req.usuario;

  // 1) Seleção mínima de colunas — sem SELECT *
  const { rows: templates } = await db.query(
    `SELECT id,name,type,cost_center_id,category_id,counterparty,amount,payment_method,
            day_of_month,frequency,total_installments,current_installment
     FROM recurring_templates WHERE active = TRUE ORDER BY id`
  );

  if (!templates.length) {
    return res.json({ ok: true, gerados: 0, mensagem: '0 lançamento(s) gerado(s) a partir de modelos recorrentes.' });
  }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const intervalByFreq = { mensal:1, bimestral:2, trimestral:3, semestral:6, anual:12 };

  // 2) Calcular chaves de idempotência para cada template gerável
  const candidates = [];      // templates que gerariam um lançamento
  for (const tpl of templates) {
    if (tpl.total_installments && tpl.current_installment > tpl.total_installments) continue;
    const interval = intervalByFreq[tpl.frequency] || 1;
    const targetMonth = ((tpl.current_installment - 1) * interval) % 12 + 1;
    const targetYear = currentYear + Math.floor(((tpl.current_installment - 1) * interval) / 12);
    if (targetMonth > currentMonth || targetYear > currentYear) continue;
    const day = Math.min(tpl.day_of_month || 1, new Date(targetYear, targetMonth, 0).getDate());
    const dateStr = `${targetYear}-${String(targetMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const label = `${tpl.name} (${tpl.current_installment}${tpl.total_installments ? '/' + tpl.total_installments : ''})`;
    candidates.push({ tpl, dateStr, label });
  }

  // 3) Uma única consulta em lote para localizar transações existentes (chave composta)
  const existingKeys = new Set();
  if (candidates.length) {
    const descriptions = candidates.map(c => c.label);
    const centers = candidates.map(c => c.tpl.cost_center_id);
    const dates = candidates.map(c => c.dateStr);
    const { rows: existing } = await db.query(
      `SELECT id, description, cost_center_id, transaction_date
       FROM transactions
       WHERE deleted_at IS NULL
         AND (description, cost_center_id, transaction_date) IN (
              SELECT unnest($1::text[]), unnest($2::int[]), unnest($3::date[])
            )`,
      [descriptions, centers, dates]
    );
    for (const row of existing) {
      existingKeys.add(`${row.description}|${row.cost_center_id}|${row.transaction_date}`);
    }
  }

  // 4) Separar em existentes (idempotência) e novos
  const toInsert = [];
  const toSkip = [];
  for (const c of candidates) {
    const key = `${c.label}|${c.tpl.cost_center_id}|${c.dateStr}`;
    if (existingKeys.has(key)) toSkip.push(c);
    else toInsert.push(c);
  }

  // 5) Batch insert em uma única query (multi-row VALUES), preservando ordem
  let gerados = 0;
  if (toInsert.length) {
    const values = [];
    const params = [];
    let p = 0;
    for (const c of toInsert) {
      const tpl = c.tpl;
      const installmentLabel = tpl.total_installments ? ` (${tpl.current_installment}/${tpl.total_installments})` : '';
      const row = [
        crypto.randomUUID(), tpl.type, tpl.cost_center_id, tpl.category_id,
        `${tpl.name}${installmentLabel}`, tpl.counterparty, tpl.amount, c.dateStr, c.dateStr, 'pendente',
        instance.id, instance.name, instance.id, instance.name,
        user.name, user.id
      ];
      for (const v of row) { params.push(v); p++; }
      const placeholders = Array.from({ length: row.length }, (_, i) => `$${p - row.length + i + 1}`).join(',');
      values.push(`(${placeholders})`);
    }
    await db.query(
      `INSERT INTO transactions (public_id,type,cost_center_id,category_id,description,counterparty,
         amount,transaction_date,due_date,financial_status,
         origin_instance_id,origin_instance_name,last_modified_instance_id,last_modified_instance_name,
         origin_user_name,created_by)
       VALUES ${values.join(',')}`,
      params
    );
    gerados = toInsert.length;
  }

  // 6) Atualização em lote do parcela atual para todos os templates geradores
  const advanceIds = [...toSkip.map(c => c.tpl.id), ...toInsert.map(c => c.tpl.id)];
  if (advanceIds.length) {
    await db.query(
      `UPDATE recurring_templates SET current_installment = current_installment + 1
       WHERE id = ANY($1::int[])`,
      [advanceIds]
    );
  }

  res.json({ ok: true, gerados, mensagem: `${gerados} lançamento(s) gerado(s) a partir de modelos recorrentes.` });
}));

function validate(body) {
  const name = String(body.nome || '').trim();
  const type = String(body.tipo || '');
  const costCenterId = Number(body.cost_center_id);
  const categoryId = Number(body.category_id);
  const counterparty = String(body.favorecido || '').trim() || null;
  const amount = Number(body.valor);
  const paymentMethod = String(body.forma_pagamento || '').trim() || null;
  const dayOfMonth = Number(body.dia_mes) || null;
  const frequency = String(body.frequencia || 'mensal');
  const totalInstallments = Number(body.total_parcelas) || null;
  if (!name) throw httpError(400, 'Informe o nome do modelo.');
  if (!['receita','despesa'].includes(type)) throw httpError(400, 'Tipo inválido.');
  if (!costCenterId || costCenterId <= 0) throw httpError(400, 'Centro de custo inválido.');
  if (!categoryId || categoryId <= 0) throw httpError(400, 'Categoria inválida.');
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'Valor inválido.');
  if (dayOfMonth && (dayOfMonth < 1 || dayOfMonth > 31)) throw httpError(400, 'Dia do mês inválido.');
  if (!['mensal','bimestral','trimestral','semestral','anual'].includes(frequency)) throw httpError(400, 'Frequência inválida.');
  return { name:name.slice(0,140), type, costCenterId, categoryId, counterparty:counterparty?.slice(0,160),
    amount, paymentMethod:paymentMethod?.slice(0,40), dayOfMonth, frequency, totalInstallments };
}

module.exports = router;
