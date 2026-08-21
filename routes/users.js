const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');

const router = express.Router();
router.use(autenticar, exigirPapel('admin'));

router.get('/', asyncRoute(async (req, res) => {
  const { rows } = await getDb().query(
    'SELECT id, name AS nome, email, role, active AS ativo, created_at FROM users ORDER BY active DESC, name'
  );
  res.json(rows);
}));

router.post('/', asyncRoute(async (req, res) => {
  const name = String(req.body.nome || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.senha || '');
  const role = String(req.body.role || '');
  if (!name || !email || !password) throw httpError(400, 'Preencha nome, e-mail e senha.');
  if (password.length < 10) throw httpError(400, 'A senha provisória precisa ter pelo menos 10 caracteres.');
  if (!['admin', 'gestor', 'supervisor'].includes(role)) throw httpError(400, 'Perfil inválido.');
  const { rows } = await getDb().query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id,name,email,role,active`,
    [name.slice(0, 120), email.slice(0, 180), await bcrypt.hash(password, 12), role]
  );
  await recordAudit({entityType:'usuario',entityId:rows[0].id,action:'criado',summary:`Usuário ${rows[0].name} criado com perfil ${role}.`,data:rows[0],user:req.usuario});
  res.status(201).json(rows[0]);
}));

router.put('/:id/status', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id, 'Usuário');
  const active = req.body.ativo === true;
  if (id === req.usuario.id && !active) throw httpError(400, 'Você não pode desativar o próprio acesso.');
  const result = await getDb().query(
    'UPDATE users SET active=$1, updated_at=NOW() WHERE id=$2 RETURNING id,name,email,role,active', [active, id]
  );
  if (!result.rowCount) throw httpError(404, 'Usuário não encontrado.');
  await recordAudit({entityType:'usuario',entityId:id,action:active?'ativado':'desativado',summary:`Usuário ${result.rows[0].name} ${active?'ativado':'desativado'}.`,data:result.rows[0],user:req.usuario});
  res.json({ ok: true });
}));

module.exports = router;

