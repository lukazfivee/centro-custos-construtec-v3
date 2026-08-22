const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const crypto = require('crypto');
const { getDb, getInstanceIdentity } = require('../db');
const { autenticar } = require('../middleware/auth');
const { asyncRoute, httpError } = require('../lib/http');
const cloudAuth = require('../services/cloudAuth');
const logger = require('../lib/logger');

const router = express.Router();
const LOGIN_MAX_FAILURES = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MAX_PROFILE_PHOTO_BYTES = 512 * 1024;
const loginFailures = new Map();

function decodeProfilePhoto(body) {
  const mime = String(body?.mime || '').trim().toLowerCase();
  const contentBase64 = String(body?.contentBase64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!['image/jpeg','image/png','image/webp'].includes(mime)) throw httpError(400,'Use uma foto JPG, PNG ou WEBP.');
  if (!contentBase64) throw httpError(400,'Selecione uma foto de perfil.');
  if (contentBase64.length > Math.ceil(MAX_PROFILE_PHOTO_BYTES * 4 / 3) + 4) throw httpError(413,'A foto de perfil deve ter no máximo 512 KB.');
  const content = Buffer.from(contentBase64, 'base64');
  if (!content.length || content.length > MAX_PROFILE_PHOTO_BYTES || content.toString('base64').replace(/=+$/, '') !== contentBase64.replace(/=+$/, '')) throw httpError(400,'O arquivo da foto de perfil é inválido.');
  const jpeg = content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  const png = content.length >= 8 && content.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  const webp = content.length >= 12 && content.subarray(0,4).toString('ascii') === 'RIFF' && content.subarray(8,12).toString('ascii') === 'WEBP';
  if ((mime === 'image/jpeg' && !jpeg) || (mime === 'image/png' && !png) || (mime === 'image/webp' && !webp)) throw httpError(400,'O conteúdo do arquivo não corresponde ao formato da foto.');
  return { mime, content, contentBase64:content.toString('base64') };
}

function profilePhotoPayload(row, synchronized = true) {
  return {
    mime:row?.profile_photo_mime || null,
    contentBase64:row?.profile_photo ? Buffer.from(row.profile_photo).toString('base64') : null,
    sincronizada:synchronized,
  };
}

function cloudProfileError(error) {
  if ([400,413].includes(error.status)) return httpError(error.status,error.message);
  if (error.status === 401) return httpError(401,'Sua sessão corporativa expirou. Entre novamente.');
  return httpError(503,'Não foi possível sincronizar a foto de perfil agora. Verifique a internet e tente novamente.');
}

function loginFailureState(email) {
  const key = String(email || '').trim().toLowerCase();
  const state = loginFailures.get(key);
  if (!state) return null;
  if (state.blockedUntil && state.blockedUntil <= Date.now()) {
    loginFailures.delete(key);
    return null;
  }
  return state;
}

function assertLoginAllowed(email) {
  const state = loginFailureState(email);
  if (!state?.blockedUntil) return;
  const minutes = Math.max(1, Math.ceil((state.blockedUntil - Date.now()) / 60000));
  throw httpError(429, `Muitas tentativas de login para este e-mail. Tente novamente em ${minutes} minuto(s).`);
}

function registerLoginFailure(email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return;
  const current = loginFailureState(key) || { count:0, blockedUntil:null };
  const count = current.count + 1;
  loginFailures.set(key, {
    count,
    blockedUntil: count >= LOGIN_MAX_FAILURES ? Date.now() + LOGIN_BLOCK_MS : null,
  });
}

function clearLoginFailures(email) {
  loginFailures.delete(String(email || '').trim().toLowerCase());
}

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

  try {
    assertLoginAllowed(email);
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

    clearLoginFailures(email);
    const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(user.id), expiresIn: '8h' });
    res.json({
      token,
      usuario: { id:user.id, nome:user.name, email:user.email, role:user.role },
      instancia: getInstanceIdentity(),
    });
  } catch (error) {
    const status = Number(error.statusCode || error.status || 500);
    if (status === 401) registerLoginFailure(email);
    logger.warn('login_failed', {
      email: email || null,
      requestId:req.requestId,
      status,
      motivo:error.message,
    });
    throw error;
  }
}));

router.get('/me', autenticar, (req, res) => res.json({
  id: req.usuario.id,
  nome: req.usuario.name,
  email: req.usuario.email,
  role: req.usuario.role,
  instancia: getInstanceIdentity(),
}));

router.get('/foto-perfil', autenticar, asyncRoute(async (req, res) => {
  let synchronized = true;
  if (req.usuario.cloud_managed && cloudAuth.corporateEmail(req.usuario.email) && req.usuario.cloud_session_token) {
    try {
      const remote = await cloudAuth.getProfilePhoto(req.usuario.cloud_session_token);
      if (remote.contentBase64 && remote.mime) {
        const photo = decodeProfilePhoto(remote);
        await getDb().query('UPDATE users SET profile_photo=$1,profile_photo_mime=$2,updated_at=NOW() WHERE id=$3',[photo.content,photo.mime,req.usuario.id]);
      } else {
        await getDb().query('UPDATE users SET profile_photo=NULL,profile_photo_mime=NULL,updated_at=NOW() WHERE id=$1',[req.usuario.id]);
      }
    } catch { synchronized = false; }
  }
  const row = (await getDb().query('SELECT profile_photo,profile_photo_mime FROM users WHERE id=$1',[req.usuario.id])).rows[0];
  res.json(profilePhotoPayload(row,synchronized));
}));

router.post('/foto-perfil', autenticar, asyncRoute(async (req, res) => {
  const photo = decodeProfilePhoto(req.body);
  if (req.usuario.cloud_managed && cloudAuth.corporateEmail(req.usuario.email)) {
    if (!req.usuario.cloud_session_token) throw httpError(401,'Entre novamente para sincronizar a foto de perfil.');
    try { await cloudAuth.setProfilePhoto(req.usuario.cloud_session_token,{ mime:photo.mime, contentBase64:photo.contentBase64 }); }
    catch (error) { throw cloudProfileError(error); }
  }
  await getDb().query('UPDATE users SET profile_photo=$1,profile_photo_mime=$2,updated_at=NOW() WHERE id=$3',[photo.content,photo.mime,req.usuario.id]);
  res.json(profilePhotoPayload({ profile_photo:photo.content, profile_photo_mime:photo.mime }));
}));

router.delete('/foto-perfil', autenticar, asyncRoute(async (req, res) => {
  if (req.usuario.cloud_managed && cloudAuth.corporateEmail(req.usuario.email)) {
    if (!req.usuario.cloud_session_token) throw httpError(401,'Entre novamente para sincronizar a foto de perfil.');
    try { await cloudAuth.removeProfilePhoto(req.usuario.cloud_session_token); }
    catch (error) { throw cloudProfileError(error); }
  }
  await getDb().query('UPDATE users SET profile_photo=NULL,profile_photo_mime=NULL,updated_at=NOW() WHERE id=$1',[req.usuario.id]);
  res.json({ ok:true });
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

router.decodeProfilePhoto = decodeProfilePhoto;
module.exports = router;
