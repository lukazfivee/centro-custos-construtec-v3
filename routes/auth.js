const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const crypto = require('crypto');
const { getDb, getInstanceIdentity } = require('../db');
const { autenticar } = require('../middleware/auth');
const { asyncRoute, httpError } = require('../lib/http');
const cloudAuth = require('../services/cloudAuth');

const router = express.Router();

async function localCorporateCandidate(email) {
  const { rows } = await getDb().query(
    `SELECT id,name,email,password_hash,role,active
     FROM users WHERE LOWER(email)=$1 LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

async function upsertCloudUser(remoteUser, sessionToken) {
  const email = String(remoteUser.email || '').trim().toLowerCase();
  const existing = await getDb().query('SELECT id FROM users WHERE LOWER(email)=$1 LIMIT 1', [email]);
  if (existing.rows[0]) {
    const updated = await getDb().query(`
      UPDATE users SET name=$1,email=$2,role=$3,active=TRUE,cloud_managed=TRUE,
        cloud_session_token=$4,updated_at=NOW()
      WHERE id=$5
      RETURNING id,name,email,role,active,cloud_managed,cloud_session_token
    `,[String(remoteUser.name||email).slice(0,120),email,remoteUser.role,sessionToken,existing.rows[0].id]);
    return updated.rows[0];
  }

  const unusablePassword = crypto.randomBytes(48).toString('hex');
  const inserted = await getDb().query(`
    INSERT INTO users (name,email,password_hash,role,active,cloud_managed,cloud_session_token)
    VALUES ($1,$2,$3,$4,TRUE,TRUE,$5)
    RETURNING id,name,email,role,active,cloud_managed,cloud_session_token
  `,[String(remoteUser.name||email).slice(0,120),email,await bcrypt.hash(unusablePassword,12),remoteUser.role,sessionToken]);
  return inserted.rows[0];
}

async function corporateLogin(email, password) {
  let remote;
  try {
    remote = await cloudAuth.login(email,password);
  } catch (error) {
    if (error.code !== 'DIRECTORY_EMPTY') throw error;

    const local = await localCorporateCandidate(email);
    if (!local || !local.active || !(await bcrypt.compare(password,local.password_hash))) {
      const authError = new Error('E-mail ou senha inválidos.');
      authError.status = 401;
      throw authError;
    }

    await cloudAuth.bootstrap({
      name:local.name,
      email:local.email,
      password,
      role:local.role,
    });
    remote = await cloudAuth.login(email,password);
  }

  if (!remote?.user || !remote?.sessionToken) {
    const authError = new Error('A autenticação corporativa não retornou uma sessão válida.');
    authError.status = 502;
    throw authError;
  }
  return upsertCloudUser(remote.user,remote.sessionToken);
}

router.post('/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.senha || '');
  if (!email || !password) throw httpError(400, 'Informe e-mail e senha.');

  let user;
  if (cloudAuth.corporateEmail(email)) {
    try {
      user = await corporateLogin(email,password);
    } catch (error) {
      if (error.status === 401 || error.status === 400) throw httpError(error.status,error.message);
      if (error.code === 'BOOTSTRAP_KEY_MISSING') throw httpError(503,error.message);
      if (error.status === 409) throw httpError(409,error.message);
      throw httpError(503,'Não foi possível validar o acesso corporativo agora. Verifique a internet e tente novamente.');
    }
  } else {
    const { rows } = await getDb().query(
      `SELECT id, name, email, password_hash, role
       FROM users WHERE LOWER(email) = $1 AND active = TRUE`, [email]
    );
    user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw httpError(401, 'E-mail ou senha inválidos.');
    }
  }

  const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(user.id), expiresIn: '8h' });
  res.json({
    token,
    usuario: { id:user.id, nome:user.name, email:user.email, role:user.role },
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

  if (req.usuario.cloud_managed && cloudAuth.corporateEmail(req.usuario.email)) {
    if (!req.usuario.cloud_session_token) throw httpError(401,'Entre novamente para alterar a senha corporativa.');
    try {
      await cloudAuth.changePassword(req.usuario.cloud_session_token,currentPassword,newPassword);
    } catch (error) {
      if (error.status === 401 || error.status === 400) throw httpError(error.status,error.message);
      throw httpError(503,'Não foi possível alterar a senha corporativa agora.');
    }
    await getDb().query(
      'UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2',
      [await bcrypt.hash(crypto.randomBytes(48).toString('hex'),12),req.usuario.id]
    );
  } else {
    const { rows } = await getDb().query('SELECT password_hash FROM users WHERE id = $1', [req.usuario.id]);
    if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      throw httpError(401, 'Senha atual incorreta.');
    }
    await getDb().query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [await bcrypt.hash(newPassword, 12), req.usuario.id]
    );
  }

  for (const filePath of [process.env.BOOTSTRAP_CREDENTIAL_PATH, process.env.FIRST_ACCESS_FILE_PATH]) {
    if (!filePath) continue;
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }
  res.json({ ok: true });
}));

module.exports = router;
