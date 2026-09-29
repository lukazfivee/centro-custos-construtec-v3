const express = require('express');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { parsePagination, wantsPagination, paginationMeta } = require('../lib/pagination');
const { currentMonth, validMonth } = require('../lib/dates');
const { recordAudit } = require('../services/audit');
const schedule = require('../services/recurringSchedule');

const router = express.Router();
router.use(autenticar);

// inicio = mes da primeira parcela (AAAA-MM); modelos antigos sem o campo usam o mes em que foram criados.
const RECURRING_SELECT = `
  SELECT rt.id,rt.name AS nome,rt.type AS tipo,rt.cost_center_id,rt.category_id,
    rt.counterparty AS favorecido,rt.amount AS valor,rt.payment_method AS forma_pagamento,
    rt.day_of_month AS dia_mes,rt.frequency AS frequencia,rt.total_installments AS total_parcelas,
    rt.current_installment AS parcela_atual,rt.active AS ativo,
    to_char(COALESCE(rt.starts_on, date_trunc('month', rt.created_at AT TIME ZONE 'America/Sao_Paulo')::date),'YYYY-MM') AS inicio,
    cc.code AS centro_codigo,cc.name AS centro_nome,c.name AS categoria
  FROM recurring_templates rt
  JOIN cost_centers cc ON cc.id=rt.cost_center_id
  JOIN categories c ON c.id=rt.category_id`;

// geradas = parcelas ja geradas; proxima_geracao = proxima data em que o modelo ativo gera lancamento.
function withSchedule(row) {
  const proxima = row.ativo ? schedule.proximaGeracao({ frequency: row.frequencia, day_of_month: row.dia_mes, total_installments: row.total_parcelas, inicio: row.inicio }) : null;
  return { ...row, geradas: Math.max(0, Number(row.parcela_atual) - 1), proxima_geracao: proxima };
}

router.get('/', asyncRoute(async (req, res) => {
  const orderBy = 'rt.active DESC,rt.name';
  const { where, values } = buildSearchFilter(req.query);
  if (!wantsPagination(req.query)) {
    const { rows } = await getDb().query(`${RECURRING_SELECT} ${where} ORDER BY ${orderBy} LIMIT 500`, values);
    res.setHeader('X-Result-Limit', '500');
    return res.json(rows.map(withSchedule));
  }
  const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
  const [dataResult, countResult] = await Promise.all([
    getDb().query(`${RECURRING_SELECT} ${where} ORDER BY ${orderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]),
    getDb().query(`SELECT COUNT(*)::int AS total FROM recurring_templates rt ${where}`, values),
  ]);
  const total = Number(countResult.rows[0]?.total || 0);
  res.setHeader('X-Total-Count', String(total));
  return res.json({ itens: dataResult.rows.map(withSchedule), paginacao: paginationMeta(total, page, limit) });
}));

// Mes escolhido (AAAA-MM, padrao o atual). Ver de 12 meses atras ate 12 a frente; gerar so ate o mes atual.
function mesEscolhido(valor, { gerar = false } = {}) {
  const atual = currentMonth();
  const mes = String(valor || atual);
  if (!validMonth(mes)) throw httpError(400, 'Mês inválido. Use o formato AAAA-MM.');
  if (gerar && mes > atual) throw httpError(400, 'Só é possível gerar lançamentos até o mês atual.');
  if (mes < schedule.somarMeses(atual, -12) || mes > schedule.somarMeses(atual, 12)) throw httpError(400, 'Mês fora do período permitido.');
  return mes;
}

// Prévia sem gravar: o que sera criado no mes (itens) e o que ja foi criado (gerados).
router.get('/previa', asyncRoute(async (req, res) => {
  res.json(await schedule.previaDoMes(mesEscolhido(req.query.mes)));
}));

// Proxima geracao de um modelo ainda nao salvo (previa do formulario).
router.get('/proxima', asyncRoute(async (req, res) => {
  const modelo = { frequency: String(req.query.frequencia || 'mensal'), day_of_month: Number(req.query.dia_mes) || null,
    total_installments: Number(req.query.total_parcelas) || null };
  if (!schedule.INTERVALO[modelo.frequency]) throw httpError(400, 'Frequência inválida.');
  modelo.inicio = req.query.inicio ? String(req.query.inicio) : schedule.inicioPadrao(modelo.day_of_month);
  if (!validMonth(modelo.inicio)) throw httpError(400, 'Mês de início inválido. Use o formato AAAA-MM.');
  res.json({ inicio: modelo.inicio, data: schedule.proximaGeracao(modelo) });
}));

function buildSearchFilter(query) {
  if (!query.busca || !String(query.busca).trim()) return { where: '', values: [] };
  const search = `%${String(query.busca).trim().slice(0, 100)}%`;
  return { where: 'WHERE rt.name ILIKE $1', values: [search] };
}

router.post('/', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const data = validate(req.body);
  const inicio = data.inicio || schedule.inicioPadrao(data.dayOfMonth);
  const { rows } = await getDb().query(
    `INSERT INTO recurring_templates (name,type,cost_center_id,category_id,counterparty,amount,
       payment_method,day_of_month,frequency,total_installments,starts_on,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [data.name,data.type,data.costCenterId,data.categoryId,data.counterparty,data.amount,
     data.paymentMethod,data.dayOfMonth,data.frequency,data.totalInstallments,`${inicio}-01`,req.usuario.id]
  );
  await recordAudit({entityType:'recorrente',entityId:rows[0].id,action:'criada',summary:`Modelo recorrente criado: ${data.name}`,data:{...data,inicio},user:req.usuario});
  res.status(201).json(rows[0]);
}));

router.put('/:id', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const data = validate(req.body);
  const id = positiveId(req.params.id);
  const result = await getDb().query(
    `UPDATE recurring_templates SET name=$1,type=$2,cost_center_id=$3,category_id=$4,
       counterparty=$5,amount=$6,payment_method=$7,day_of_month=$8,frequency=$9,
       total_installments=$10,active=$11,starts_on=COALESCE($12::date,starts_on),updated_at=NOW() WHERE id=$13`,
    [data.name,data.type,data.costCenterId,data.categoryId,data.counterparty,data.amount,
     data.paymentMethod,data.dayOfMonth,data.frequency,data.totalInstallments,
     req.body.ativo !== false,data.inicio ? `${data.inicio}-01` : null,id]
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

// Gera os lancamentos do mes escolhido (padrao: o atual) como "A pagar". Repetir nao duplica.
router.post('/gerar', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const mes = mesEscolhido(req.body && req.body.mes, { gerar: true });
  const resultado = await schedule.gerarMes(mes, req.usuario);
  if (resultado.gerados) {
    await recordAudit({entityType:'recorrente',entityId:0,action:'gerados',summary:`${resultado.gerados} lançamento(s) gerado(s) de modelos recorrentes para ${mes}.`,data:{mes,gerados:resultado.gerados},user:req.usuario});
  }
  res.json({ ok: true, mes, gerados: resultado.gerados, itens: resultado.itens, mensagem: `${resultado.gerados} lançamento(s) gerado(s) a partir de modelos recorrentes.` });
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
  const inicio = body.inicio ? String(body.inicio) : null;
  if (inicio && !validMonth(inicio)) throw httpError(400, 'Mês de início inválido. Use o formato AAAA-MM.');
  return { name:name.slice(0,140), type, costCenterId, categoryId, counterparty:counterparty?.slice(0,160),
    amount, paymentMethod:paymentMethod?.slice(0,40), dayOfMonth, frequency, totalInstallments, inicio };
}

module.exports = router;
