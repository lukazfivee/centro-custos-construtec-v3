const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');
const cloudAuth = require('../services/cloudAuth');

const router = express.Router();
router.use(autenticar, exigirPapel('admin'));

async function upsertRemoteUser(remote) {
  const email = String(remote.email || '').trim().toLowerCase();
  const existing = await getDb().query('SELECT id FROM users WHERE LOWER(email)=$1 LIMIT 1',[email]);
  if (existing.rows[0]) {
    const result = await getDb().query(`
      UPDATE users SET name=$1,email=$2,role=$3,active=$4,cloud_managed=TRUE,updated_at=NOW()
      WHERE id=$5 RETURNING id,name AS nome,email,role,active AS ativo,created_at
    `,[String(remote.name||email).slice(0,120),email,remote.role,remote.active !== false,existing.rows[0].id]);
    return result.rows[0];
  }
  const placeholder = await bcrypt.hash(crypto.randomBytes(48).toString('hex'),12);
  const result = await getDb().query(`
    INSERT INTO users (name,email,password_hash,role,active,cloud_managed)
    VALUES ($1,$2,$3,$4,$5,TRUE)
    RETURNING id,name AS nome,email,role,active AS ativo,created_at
  `,[String(remote.name||email).slice(0,120),email,placeholder,remote.role,remote.active !== false]);
  return result.rows[0];
}

router.get('/', asyncRoute(async (req, res) => {
  if (req.usuario.cloud_managed && cloudAuth.corporateEmail(req.usuario.email) && req.usuario.cloud_session_token) {
    try {
      const remote = await cloudAuth.listUsers(req.usuario.cloud_session_token);
      const users = [];
      for (const item of remote.users || []) users.push(await upsertRemoteUser(item));
      return res.json(users);
    } catch (error) {
      if (error.status === 401) throw httpError(401,'Sua sessão corporativa expirou. Entre novamente.');
      throw httpError(503,'Não foi possível carregar os usuários corporativos agora.');
    }
  }

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

  if (req.usuario.cloud_managed && cloudAuth.corporateEmail(req.usuario.email)) {
    if (!cloudAuth.corporateEmail(email)) throw httpError(400,'Usuários compartilhados precisam usar e-mail @rcconstrutec.com.br.');
    if (!req.usuario.cloud_session_token) throw httpError(401,'Entre novamente para gerenciar usuários corporativos.');
    let remote;
    try {
      remote = await cloudAuth.createUser(req.usuario.cloud_session_token,{ name,email,password,role });
    } catch (error) {
      if ([400,401,403,409].includes(error.status)) throw httpError(error.status,error.message);
      throw httpError(503,'Não foi possível criar o usuário corporativo agora.');
    }
    const created = await upsertRemoteUser(remote.user);
    await recordAudit({entityType:'usuario',entityId:created.id,action:'criado',summary:`Usuário corporativo ${created.nome} criado com perfil ${role}.`,data:created,user:req.usuario});
    return res.status(201).json(created);
  }

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

  const target = (await getDb().query('SELECT id,name,email,role,active,cloud_managed FROM users WHERE id=$1',[id])).rows[0];
  if (!target) throw httpError(404,'Usuário não encontrado.');

  if (target.cloud_managed && req.usuario.cloud_managed) {
    if (!req.usuario.cloud_session_token) throw httpError(401,'Entre novamente para gerenciar usuários corporativos.');
    try {
      await cloudAuth.setUserStatus(req.usuario.cloud_session_token,target.email,active);
    } catch (error) {
      if ([400,401,403,404].includes(error.status)) throw httpError(error.status,error.message);
      throw httpError(503,'Não foi possível alterar o acesso corporativo agora.');
    }
  }

  const result = await getDb().query(
    'UPDATE users SET active=$1, updated_at=NOW() WHERE id=$2 RETURNING id,name,email,role,active', [active, id]
  );
  await recordAudit({entityType:'usuario',entityId:id,action:active?'ativado':'desativado',summary:`Usuário ${result.rows[0].name} ${active?'ativado':'desativado'}.`,data:result.rows[0],user:req.usuario});
  res.json({ ok: true });
}));

module.exports = router;
