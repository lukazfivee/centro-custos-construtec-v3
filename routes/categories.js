const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { parsePagination, wantsPagination, paginationMeta } = require('../lib/pagination');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

const CATEGORIES_SELECT = `
  SELECT c.id,c.name AS nome,c.type AS tipo,c.active AS ativo,c.revision,COUNT(t.id) AS total_lancamentos
  FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.deleted_at IS NULL`;

router.get('/', asyncRoute(async (req, res) => {
  const orderBy = 'c.active DESC,c.type,c.name';
  const { where, values } = buildSearchFilter(req.query);
  if (!wantsPagination(req.query)) {
    const { rows } = await getDb().query(`${CATEGORIES_SELECT} ${where} GROUP BY c.id ORDER BY ${orderBy} LIMIT 500`, values);
    res.setHeader('X-Result-Limit', '500');
    return res.json(rows);
  }
  const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
  const [dataResult, countResult] = await Promise.all([
    getDb().query(`${CATEGORIES_SELECT} ${where} GROUP BY c.id ORDER BY ${orderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]),
    getDb().query(`SELECT COUNT(*)::int AS total FROM categories c ${where}`, values),
  ]);
  const total = Number(countResult.rows[0]?.total || 0);
  res.setHeader('X-Total-Count', String(total));
  return res.json({ itens: dataResult.rows, paginacao: paginationMeta(total, page, limit) });
}));

function buildSearchFilter(query) {
  if (!query.busca || !String(query.busca).trim()) return { where: '', values: [] };
  const search = `%${String(query.busca).trim().slice(0, 100)}%`;
  return { where: 'WHERE c.name ILIKE $1', values: [search] };
}

router.post('/', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const data = validate(req.body);
  const publicId = crypto.randomUUID();
  const { rows } = await getDb().query(
    'INSERT INTO categories (public_id,name,type) VALUES ($1,$2,$3) RETURNING id,name,type,active,revision', [publicId, data.name, data.type]
  );
  await recordAudit({entityType:'categoria',entityId:rows[0].id,action:'criado',summary:`Categoria ${data.name} criada.`,data:rows[0],user:req.usuario});
  res.status(201).json(rows[0]);
}));

router.put('/:id', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const data = validate(req.body);
  const result = await getDb().query(
    'UPDATE categories SET name=$1,type=$2,active=$3,revision=revision+1,updated_at=NOW() WHERE id=$4 RETURNING id,name,type,active,revision',
    [data.name, data.type, req.body.ativo !== false, positiveId(req.params.id)]
  );
  if (!result.rowCount) throw httpError(404, 'Categoria não encontrada.');
  await recordAudit({entityType:'categoria',entityId:result.rows[0].id,action:'atualizado',summary:`Categoria ${data.name} atualizada.`,data:result.rows[0],user:req.usuario});
  res.json({ ok: true, revisao:result.rows[0].revision });
}));

function validate(body) {
  const name = String(body.nome || '').trim();
  const type = String(body.tipo || 'ambos');
  if (!name) throw httpError(400, 'Informe o nome da categoria.');
  if (!['receita','despesa','ambos'].includes(type)) throw httpError(400, 'Tipo de categoria inválido.');
  return { name: name.slice(0,100), type };
}

module.exports = router;
