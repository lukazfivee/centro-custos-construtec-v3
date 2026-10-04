const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db');
const { autenticar } = require('../middleware/auth');
const { exigirPermissao } = require('../services/permissions');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { parsePagination, wantsPagination, paginationMeta } = require('../lib/pagination');
const { currentMonth, monthRange, validMonth } = require('../lib/dates');
const { chave } = require('../lib/texto');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

// Paleta fixa do painel (desktop novo). O servidor recusa qualquer outra cor.
const CORES = ['#12a9d1', '#0b4a5c', '#e0a33a', '#8a5cd0', '#c2692a', '#1d7a4f', '#5d7480'];

// $1 e $2 = inicio e fim do mes (lancamentos do mes por categoria; estorno tem sinal -1 e nao conta como lancamento).
const CATEGORIES_SELECT = `
  SELECT c.id,c.name AS nome,c.type AS tipo,c.active AS ativo,c.revision,c.color AS cor,c.description AS descricao,
    COUNT(t.id) AS total_lancamentos,
    COUNT(t.id) FILTER (WHERE t.accounting_sign=1 AND t.transaction_date >= $1 AND t.transaction_date < $2) AS lancamentos_mes,
    COALESCE(SUM(t.amount * t.accounting_sign) FILTER (WHERE t.transaction_date >= $1 AND t.transaction_date < $2),0) AS total_mes
  FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.deleted_at IS NULL`;

router.get('/', asyncRoute(async (req, res) => {
  const mes = String(req.query.mes || currentMonth());
  if (!validMonth(mes)) throw httpError(400, 'Mês inválido. Use o formato AAAA-MM.');
  const { start, end } = monthRange(mes);
  const orderBy = 'c.active DESC,c.type,c.name';
  const { where, values } = buildSearchFilter(req.query, [start, end]);
  if (!wantsPagination(req.query)) {
    const { rows } = await getDb().query(`${CATEGORIES_SELECT} ${where} GROUP BY c.id ORDER BY ${orderBy} LIMIT 500`, values);
    res.setHeader('X-Result-Limit', '500');
    return res.json(rows);
  }
  const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
  const [dataResult, countResult] = await Promise.all([
    getDb().query(`${CATEGORIES_SELECT} ${where} GROUP BY c.id ORDER BY ${orderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]),
    getDb().query(`SELECT COUNT(*)::int AS total FROM categories c ${where.replace('$3', '$1')}`, values.slice(2)),
  ]);
  const total = Number(countResult.rows[0]?.total || 0);
  res.setHeader('X-Total-Count', String(total));
  return res.json({ itens: dataResult.rows, paginacao: paginationMeta(total, page, limit) });
}));

function buildSearchFilter(query, base) {
  if (!query.busca || !String(query.busca).trim()) return { where: '', values: base };
  const search = `%${String(query.busca).trim().slice(0, 100)}%`;
  return { where: 'WHERE c.name ILIKE $3', values: [...base, search] };
}

router.post('/', exigirPermissao('p5'), asyncRoute(async (req, res) => {
  const data = validate(req.body);
  await assertNomeLivre(data.name);
  const publicId = crypto.randomUUID();
  const { rows } = await getDb().query(
    'INSERT INTO categories (public_id,name,type,color,description) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,type,active,revision,color,description',
    [publicId, data.name, data.type, data.color, data.description]
  );
  await recordAudit({entityType:'categoria',entityId:rows[0].id,action:'criado',summary:`Categoria ${data.name} criada.`,data:rows[0],user:req.usuario});
  res.status(201).json(rows[0]);
}));

router.put('/:id', exigirPermissao('p5'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const data = validate(req.body);
  await assertNomeLivre(data.name, id);
  const before = (await getDb().query('SELECT id,name,type,active FROM categories WHERE id=$1', [id])).rows[0];
  const result = await getDb().query(
    'UPDATE categories SET name=$1,type=$2,active=$3,color=$4,description=$5,revision=revision+1,updated_at=NOW() WHERE id=$6 RETURNING id,name,type,active,revision',
    [data.name, data.type, req.body.ativo !== false, data.color, data.description, id]
  );
  if (!result.rowCount) throw httpError(404, 'Categoria não encontrada.');
  await recordAudit({entityType:'categoria',entityId:result.rows[0].id,action:'atualizado',summary:`Categoria ${data.name} atualizada.`,data:result.rows[0],before,user:req.usuario});
  res.json({ ok: true, revisao:result.rows[0].revision });
}));

// O banco ja recusa o mesmo nome (sem diferenca de maiusculas); aqui tambem sem acento, com o nome de quem ja usa.
async function assertNomeLivre(name, ignoreId = 0) {
  const { rows } = await getDb().query('SELECT id,name FROM categories WHERE id <> $1', [ignoreId]);
  const igual = rows.find((row) => chave(row.name) === chave(name));
  if (igual) throw httpError(409, `Já existe uma categoria com esse nome: ${igual.name}.`);
}

function validate(body) {
  const name = String(body.nome || '').trim();
  const type = String(body.tipo || 'ambos');
  const description = String(body.descricao || '').trim().slice(0, 200) || null;
  const color = body.cor ? String(body.cor).toLowerCase() : null;
  if (!name) throw httpError(400, 'Informe o nome da categoria.');
  if (!['receita','despesa','ambos'].includes(type)) throw httpError(400, 'Tipo de categoria inválido.');
  if (color && !CORES.includes(color)) throw httpError(400, 'Cor inválida. Escolha uma das cores do painel.');
  return { name: name.slice(0,100), type, description, color };
}

module.exports = router;
module.exports.CORES = CORES;
