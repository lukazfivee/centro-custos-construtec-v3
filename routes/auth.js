const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { getDb, getInstanceIdentity } = require('../db');
const { autenticar } = require('../middleware/auth');
const { asyncRoute, httpError } = require('../lib/http');

const router = express.Router();

router.post('/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.senha || '');
  if (!email || !password) throw httpError(400, 'Informe e-mail e senha.');
  const { rows } = await getDb().query(
    `SELECT id, name, email, password_hash, role
     FROM users WHERE LOWER(email) = $1 AND active = TRUE`, [email]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw httpError(401, 'E-mail ou senha inválidos.');
  }
  const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(user.id), expiresIn: '8h' });
  res.json({
    token,
    usuario: { id: user.id, nome: user.name, email: user.email, role: user.role },
    instancia: getInstanceIdentity(),
  });
}));

router.get('/me', autenticar, (req, res) => res.json({
  id: req.usuario.id,
  nome: req.usuario.name,
  email: req.usuario.email,
  role: req.usuario.role,
  instancia: getInstanceIdentity(),
}));

router.post('/alterar-senha', autenticar, asyncRoute(async (req, res) => {
  const currentPassword = String(req.body.senhaAtual || '');
  const newPassword = String(req.body.novaSenha || '');
  if (newPassword.length < 10) throw httpError(400, 'A nova senha precisa ter pelo menos 10 caracteres.');
  const { rows } = await getDb().query('SELECT password_hash FROM users WHERE id = $1', [req.usuario.id]);
  if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    throw httpError(401, 'Senha atual incorreta.');
  }
  await getDb().query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [await bcrypt.hash(newPassword, 12), req.usuario.id]
  );
  for (const filePath of [process.env.BOOTSTRAP_CREDENTIAL_PATH, process.env.FIRST_ACCESS_FILE_PATH]) {
    if (!filePath) continue;
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }
  res.json({ ok: true });
}));

module.exports = router;
