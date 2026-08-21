const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar);

router.get('/', asyncRoute(async (req, res) => {
  const { rows } = await getDb().query(`
    SELECT c.id,c.name AS nome,c.type AS tipo,c.active AS ativo,c.revision,COUNT(t.id) AS total_lancamentos
    FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.deleted_at IS NULL
    GROUP BY c.id ORDER BY c.active DESC,c.type,c.name
  `);
  res.json(rows);
}));

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
