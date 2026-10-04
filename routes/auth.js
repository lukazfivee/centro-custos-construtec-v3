const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const crypto = require('crypto');
const { getDb, getInstanceIdentity } = require('../db');
const { autenticar } = require('../middleware/auth');
const { accessInfo } = require('../services/permissions');
const { asyncRoute, httpError } = require('../lib/http');
const cloudAuth = require('../services/cloudAuth');
const { mirrorCloudUser } = require('../services/cloudUserMirror');
const logger = require('../lib/logger');
const { decodeProfilePhoto } = require('../lib/profilePhoto');
const { recordAudit } = require('../services/audit');
const { createLoginThrottle } = require('../lib/loginThrottle');
const { clientIp } = require('../lib/clientIp');
const { appAllowed, APP_DENIED_MESSAGE } = require('../services/appAccess');

const router = express.Router();
const LOGIN_MAX_FAILURES = 5;
const LOGIN_EMAIL_MAX_FAILURES = 30;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const LOGIN_SWEEP_MS = 5 * 60 * 1000;

function profilePhotoPayload(row, synchronized = true) {
  return {
    mime:row?.profile_photo_mime || null,
    contentBase64:row?.profile_photo ? Buffer.from(row.profile_photo).toString('base64') : null,
    sincronizada:synchronized,
  };
}

function cloudProfileError(error) {
  if ([400,413].includes(error.status)) return httpError(error.status,error.message);
  if (error.status === 401) return httpError(428,'Sua sessão corporativa expirou. Entre novamente para sincronizar a foto de perfil.');
  return httpError(503,'Não foi possível sincronizar a foto de perfil agora. Verifique a internet e tente novamente.');
}

// Bloqueio por e-mail + IP (5 falhas = 15 min) e um limite global por e-mail (30 falhas = 15 min) para
// barrar forca bruta distribuida. Um unico IP so consegue gastar 5 falhas do limite global por vez,
// entao nao basta para trancar a conta de outra pessoa.
const loginKey = (email) => String(email || '').trim().toLowerCase();
const pairThrottle = createLoginThrottle({ maxFailures:LOGIN_MAX_FAILURES, windowMs:LOGIN_BLOCK_MS, blockMs:LOGIN_BLOCK_MS });
const emailThrottle = createLoginThrottle({ maxFailures:LOGIN_EMAIL_MAX_FAILURES, windowMs:LOGIN_BLOCK_MS, blockMs:LOGIN_BLOCK_MS });
setInterval(() => { pairThrottle.sweep(); emailThrottle.sweep(); }, LOGIN_SWEEP_MS).unref();

function assertLoginAllowed(email, ip) {
  const minutes = Math.max(pairThrottle.blockedMinutes(`${loginKey(email)}|${ip}`), emailThrottle.blockedMinutes(loginKey(email)));
  if (minutes) throw httpError(429, `Muitas tentativas de login para este e-mail. Tente novamente em ${minutes} minuto(s).`);
}

function registerLoginFailure(email, ip) {
  const key = loginKey(email);
  if (!key) return;
  pairThrottle.fail(`${key}|${ip}`);
  emailThrottle.fail(key);
}

function clearLoginFailures(email, ip) {
  pairThrottle.clear(`${loginKey(email)}|${ip}`);
}

async function localCorporateCandidate(email) {
  const { rows } = await getDb().query(
    `SELECT id,name,email,password_hash,role,active
     FROM users WHERE LOWER(email)=$1 AND deleted_at IS NULL LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

async function upsertCloudUser(remoteUser, sessionToken) {
  return mirrorCloudUser(getDb(), remoteUser, { sessionToken });
}

async function corporateLogin(email, password, ip) {
  let remote;
  try {
    remote = await cloudAuth.login(email,password,{ ip });
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
    remote = await cloudAuth.login(email,password,{ ip });
  }

  if (!remote?.user || !remote?.sessionToken) {
    const authError = new Error('A autenticação corporativa não retornou uma sessão válida.');
    authError.status = 502;
    throw authError;
  }
  return upsertCloudUser(remote.user,remote.sessionToken);
}

// E-mail fora do dominio na nuvem: so conta central autorizada por um admin.
// O diretorio e a unica fonte de login ali; recusa ou indisponibilidade nao
// caem para uma senha local antiga. No desktop continua o login local.
async function externalCloudLogin(email, password, ip) {
  try {
    const remote = await cloudAuth.login(email,password,{ ip });
    if (remote?.user && remote?.sessionToken) return upsertCloudUser(remote.user,remote.sessionToken);
  } catch (error) {
    if (error.status === 429) throw httpError(429,error.message);
    if (error.status === 403 && error.code === 'APP_NOT_ALLOWED') throw httpError(403,error.message);
    if ([400,401,409].includes(error.status)) throw httpError(401,'E-mail ou senha inválidos.');
    logger.warn('external_cloud_login_unavailable', { status:error.status || null });
    throw httpError(503,'Não foi possível validar o acesso agora. Verifique a internet e tente novamente.');
  }
  throw httpError(401,'E-mail ou senha inválidos.');
}

// Chamada interna do Worker, bloqueada no roteamento público do Worker.
// O JWT carrega apenas o hash da sessão D1; a revalidação ocorre no Worker.
router.post('/handoff-bridge', asyncRoute(async (req, res) => {
  const expected = String(process.env.SYNC_SHARED_KEY || '');
  const supplied = String(req.get('x-sync-key') || '');
  const authorized = expected.length >= 32 && supplied.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!process.env.DATABASE_URL || !authorized) return res.status(404).json({ ok:false, code:'HANDOFF_INVALID' });
  const remote = req.body?.user;
  const sessionHash = String(req.body?.sessionHash || '');
  if (!/^[a-f0-9]{64}$/.test(sessionHash)
    || !/^[a-f0-9-]{36}$/i.test(String(remote?.id || ''))
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(remote?.email || ''))
    || !['admin','gestor','supervisor'].includes(remote?.role)
    || remote?.active !== true) return res.status(400).json({ ok:false, code:'HANDOFF_INVALID' });
  if (!appAllowed({ apps:remote.apps },'centro')) return res.status(403).json({ ok:false, code:'APP_NOT_ALLOWED' });
  const user = await mirrorCloudUser(getDb(),remote);
  const token = jwt.sign({ centralSessionHash:sessionHash },process.env.JWT_SECRET,
    { subject:String(user.id),expiresIn:'8h' });
  return res.json({
    token,
    usuario:{ id:user.id,nome:user.name,email:user.email,role:user.role },
    instancia:getInstanceIdentity(),
  });
}));

router.post('/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.senha || '');
  const ip = clientIp(req);

  try {
    assertLoginAllowed(email, ip);
    if (!email || !password) throw httpError(400, 'Informe e-mail e senha.');

    let user;
    if (cloudAuth.corporateEmail(email)) {
      try {
        user = await corporateLogin(email,password,ip);
      } catch (error) {
        if (error.status === 401 || error.status === 400 || error.status === 429) throw httpError(error.status,error.message);
        if (error.status === 403 && error.code === 'APP_NOT_ALLOWED') throw httpError(403,error.message);
        if (error.code === 'BOOTSTRAP_KEY_MISSING') throw httpError(503,error.message);
        if (error.status === 409) throw httpError(409,error.message);
        throw httpError(503,'Não foi possível validar o acesso corporativo agora. Verifique a internet e tente novamente.');
      }
    } else if (process.env.DATABASE_URL) {
      user = await externalCloudLogin(email,password,ip);
    }
    if (!user) {
      const { rows } = await getDb().query(
        `SELECT id, name, email, password_hash, role, apps
         FROM users WHERE LOWER(email) = $1 AND active = TRUE AND deleted_at IS NULL AND cloud_managed = FALSE`, [email]
      );
      user = rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        throw httpError(401, 'E-mail ou senha inválidos.');
      }
    }

    if (!appAllowed(user, 'centro')) throw httpError(403, APP_DENIED_MESSAGE);
    clearLoginFailures(email, ip);
    const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(user.id), expiresIn: '8h' });
    res.json({
      token,
      usuario: { id:user.id, nome:user.name, email:user.email, role:user.role },
      instancia: getInstanceIdentity(),
    });
  } catch (error) {
    const status = Number(error.statusCode || error.status || 500);
    if (status === 401) registerLoginFailure(email, ip);
    logger.warn('login_failed', {
      email: email || null,
      requestId:req.requestId,
      status,
      motivo:error.message,
    });
    throw error;
  }
}));

router.get('/me', autenticar, asyncRoute(async (req, res) => res.json({
  id: req.usuario.id,
  nome: req.usuario.name,
  email: req.usuario.email,
  role: req.usuario.role,
  ...(await accessInfo(req.usuario)),
  todasObras: req.usuario.all_cost_centers !== false,
  instancia: getInstanceIdentity(),
})));

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
    if (!req.usuario.cloud_session_token) throw httpError(428,'Entre novamente para sincronizar a foto de perfil.');
    try { await cloudAuth.setProfilePhoto(req.usuario.cloud_session_token,{ mime:photo.mime, contentBase64:photo.contentBase64 }); }
    catch (error) { throw cloudProfileError(error); }
  }
  await getDb().query('UPDATE users SET profile_photo=$1,profile_photo_mime=$2,updated_at=NOW() WHERE id=$3',[photo.content,photo.mime,req.usuario.id]);
  res.json(profilePhotoPayload({ profile_photo:photo.content, profile_photo_mime:photo.mime }));
}));

router.delete('/foto-perfil', autenticar, asyncRoute(async (req, res) => {
  if (req.usuario.cloud_managed && cloudAuth.corporateEmail(req.usuario.email)) {
    if (!req.usuario.cloud_session_token) throw httpError(428,'Entre novamente para sincronizar a foto de perfil.');
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
  let newToken = null;

  if (req.usuario.cloud_managed) {
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
    // Modo local: as sessões emitidas antes da troca deixam de valer; esta recebe um token novo.
    const validFrom = (Math.floor(Date.now() / 1000) + 1) * 1000;
    await getDb().query(
      'UPDATE users SET password_hash = $1, sessions_valid_from = $2, updated_at = NOW() WHERE id = $3',
      [await bcrypt.hash(newPassword, 12), new Date(validFrom).toISOString(), req.usuario.id]
    );
    newToken = jwt.sign({ iat: validFrom / 1000 }, process.env.JWT_SECRET, { subject: String(req.usuario.id), expiresIn: '8h' });
  }
  await recordAudit({ entityType:'usuario', entityId:req.usuario.id, action:'senha_alterada',
    summary:`${req.usuario.name} alterou a própria senha.`, user:req.usuario });

  for (const filePath of [process.env.BOOTSTRAP_CREDENTIAL_PATH, process.env.FIRST_ACCESS_FILE_PATH]) {
    if (!filePath) continue;
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }
  res.json(newToken ? { ok: true, token: newToken } : { ok: true });
}));

router.decodeProfilePhoto = decodeProfilePhoto;
module.exports = router;
