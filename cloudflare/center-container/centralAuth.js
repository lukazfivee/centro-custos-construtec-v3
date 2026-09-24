// Identidade corporativa central (@rcconstrutec.com.br), restaurada a partir de
// cloudflare-sync-worker/src/index.js. Escopo desta rota: login, bootstrap,
// troca de senha, foto de perfil e diretorio de usuarios — nada de Cobrancas
// (clients/client-followups/client-email-draft) ou sincronizacao de dados
// (sync/snapshot), que continuam fora de escopo por decisao explicita do
// usuario (ver docs/superpowers/specs/, achado de 2026-09-18).
//
// Usa o mesmo banco D1 "centro-custos-producao" que ja tinha os 3 usuarios
// corporativos reais antes do Container substituir o Worker antigo com o
// mesmo nome "centro-custos-api" (causa raiz do login corporativo quebrado).

import { handleIdentityAdmin, isIdentityRoute, serviceKeyValid } from './identityAdmin.js';
import { requestPasswordReset, confirmPasswordReset } from './passwordReset.js';
import { listSessions, revokeOtherSessions } from './mobileSessions.js';
import { issueHandoff, consumeHandoff } from './sessionHandoff.js';
import { checkSessionHash } from './sessionHash.js';

const PASSWORD_ITERATIONS = 10000;
export const ORG_ID = 'rcconstrutec.com.br';
const SESSION_SECONDS = 8 * 3600;
const MAX_PROFILE_PHOTO_BYTES = 512 * 1024;

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function text(value) {
  return String(value ?? '').trim();
}

export function validCorporateEmail(value) {
  return /^[^\s@]+@rcconstrutec\.com\.br$/i.test(text(value));
}

export function validEmail(value) {
  const email = text(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validRole(value) {
  return ['admin', 'gestor', 'supervisor'].includes(text(value));
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

function validateProfilePhoto(body) {
  const mime = text(body?.mime).toLowerCase();
  const contentBase64 = String(body?.contentBase64 || '').replace(/\s/g, '');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return { error: 'Use uma foto JPG, PNG ou WEBP.', status: 400 };
  if (!contentBase64) return { error: 'Selecione uma foto de perfil.', status: 400 };
  if (contentBase64.length > Math.ceil(MAX_PROFILE_PHOTO_BYTES * 4 / 3) + 4) return { error: 'A foto de perfil deve ter no máximo 512 KB.', status: 413 };
  let bytes;
  try { bytes = base64ToBytes(contentBase64); } catch { return { error: 'O arquivo da foto de perfil é inválido.', status: 400 }; }
  if (!bytes.length || bytes.length > MAX_PROFILE_PHOTO_BYTES || bytesToBase64(bytes).replace(/=+$/, '') !== contentBase64.replace(/=+$/, '')) return { error: 'O arquivo da foto de perfil é inválido.', status: 400 };
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if ((mime === 'image/jpeg' && !jpeg) || (mime === 'image/png' && !png) || (mime === 'image/webp' && !webp)) return { error: 'O conteúdo do arquivo não corresponde ao formato da foto.', status: 400 };
  return { mime, contentBase64: bytesToBase64(bytes) };
}

export function timingSafeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export async function sha256Text(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sessionTokenHash(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  if (!token.startsWith('hash:')) return sha256Text(token);
  const expected = String(env.SYNC_SHARED_KEY || '');
  const hash = token.slice(5);
  if (expected.length < 32 || !timingSafeEqual(request.headers.get('x-sync-key'), expected)) return null;
  return /^[a-f0-9]{64}$/.test(hash) ? hash : null;
}

async function passwordHash(password, saltBase64, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: base64ToBytes(saltBase64),
    iterations,
  }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

export async function makePasswordRecord(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const salt64 = bytesToBase64(salt);
  return {
    salt: salt64,
    hash: await passwordHash(password, salt64, PASSWORD_ITERATIONS),
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function consumeRate(db, ip, scope = 'api', limit = 5000) {
  const now = Math.floor(Date.now() / 1000);
  const hour = Math.floor(now / 3600);
  const bucket = `${scope}:${ip || 'unknown'}:${hour}`;
  const current = await db.prepare('SELECT count FROM sync_rate_limits WHERE bucket=?').bind(bucket).first();
  if (!current) {
    await db.prepare('INSERT INTO sync_rate_limits(bucket,count,expires_at) VALUES(?,?,?)')
      .bind(bucket, 1, (hour + 2) * 3600).run();
    return true;
  }
  if (Number(current.count) >= limit) return false;
  await db.prepare('UPDATE sync_rate_limits SET count=count+1 WHERE bucket=?').bind(bucket).run();
  if (Math.random() < 0.03) {
    await db.prepare('DELETE FROM sync_rate_limits WHERE expires_at < ?').bind(now).run();
    await db.prepare('DELETE FROM cloud_sessions WHERE expires_at < ?').bind(now).run();
  }
  return true;
}

export function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at || null,
  };
}

async function createSession(env, user, request) {
  const token = bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/=+$/, '');
  const tokenHash = await sha256Text(token);
  const nowIso = new Date().toISOString();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_SECONDS;
  const instanceId = text(request.headers.get('x-instance-id')) || null;
  const instanceName = text(request.headers.get('x-instance-name')) || null;
  await env.DB.prepare(`
    INSERT INTO cloud_sessions(token_hash,user_id,org_id,instance_id,instance_name,created_at,expires_at,last_seen_at)
    VALUES(?,?,?,?,?,?,?,?)
  `).bind(tokenHash, user.id, user.org_id, instanceId, instanceName, nowIso, expiresAt, nowIso).run();
  return { token, expiresAt };
}

export async function sessionUser(request, env) {
  const tokenHash = await sessionTokenHash(request, env);
  if (!tokenHash) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`
    SELECT s.token_hash,s.expires_at,u.*
    FROM cloud_sessions s
    JOIN cloud_users u ON u.id=s.user_id AND u.org_id=s.org_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1 AND u.deleted_at IS NULL
  `).bind(tokenHash, now).first();
  if (!row) return null;
  await env.DB.prepare('UPDATE cloud_sessions SET last_seen_at=? WHERE token_hash=?')
    .bind(new Date().toISOString(), tokenHash).run();
  return row;
}

export async function requireSession(request, env, roles = []) {
  const user = await sessionUser(request, env);
  if (!user) return { error: 'Sessao invalida ou expirada.', status: 401 };
  if (roles.length && !roles.includes(user.role)) return { error: 'Sem permissao para esta acao.', status: 403 };
  return { user };
}

async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'JSON invalido.' }, 400); }
  const email = text(body?.email).toLowerCase();
  const password = String(body?.password || '');
  if (!validEmail(email) || !password) return json({ ok: false, error: 'E-mail ou senha invalidos.' }, 401);
  const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM cloud_users WHERE org_id=?').bind(ORG_ID).first();
  if (Number(count?.total || 0) === 0) return json({ ok: false, error: 'Diretorio corporativo ainda nao inicializado.', code: 'DIRECTORY_EMPTY' }, 409);
  const user = await env.DB.prepare('SELECT * FROM cloud_users WHERE org_id=? AND email=? AND deleted_at IS NULL').bind(ORG_ID, email).first();
  if (!user || !user.active) return json({ ok: false, error: 'E-mail ou senha invalidos.' }, 401);
  const iterations = Number(user.password_iterations || PASSWORD_ITERATIONS);
  if (iterations > PASSWORD_ITERATIONS) return json({ ok: false, error: 'Credencial central precisa ser reinicializada para o Workers Free.', code: 'PASSWORD_PROFILE_LEGACY' }, 409);
  const hash = await passwordHash(password, user.password_salt, iterations);
  if (!timingSafeEqual(hash, user.password_hash)) return json({ ok: false, error: 'E-mail ou senha invalidos.' }, 401);
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE cloud_users SET last_login_at=? WHERE id=?').bind(now, user.id).run();
  user.last_login_at = now;
  const session = await createSession(env, user, request);
  return json({ ok: true, sessionToken: session.token, expiresAt: session.expiresAt, user: publicUser(user) });
}

async function handleBootstrap(request, env) {
  const key = request.headers.get('x-sync-key') || '';
  if (!env.SYNC_SHARED_KEY || key !== env.SYNC_SHARED_KEY) return json({ ok: false, error: 'Nao autorizado.' }, 401);
  const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM cloud_users WHERE org_id=?').bind(ORG_ID).first();
  if (Number(count?.total || 0) > 0) return json({ ok: false, error: 'Diretorio corporativo ja inicializado.' }, 409);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'JSON invalido.' }, 400); }
  const name = text(body?.name).slice(0, 120);
  const email = text(body?.email).toLowerCase();
  const password = String(body?.password || '');
  const role = validRole(body?.role) ? body.role : 'admin';
  if (!name || !validCorporateEmail(email) || password.length < 10) return json({ ok: false, error: 'Dados de bootstrap invalidos.' }, 400);
  const record = await makePasswordRecord(password);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO cloud_users(id,org_id,name,email,password_salt,password_hash,password_iterations,role,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,1,?,?)
  `).bind(id, ORG_ID, name, email, record.salt, record.hash, record.iterations, role, now, now).run();
  return json({ ok: true, user: { id, name, email, role, active: true, createdAt: now, updatedAt: now, lastLoginAt: null } }, 201);
}

async function handleChangePassword(request, env) {
  const auth = await requireSession(request, env);
  if (auth.error) return json({ ok: false, error: auth.error }, auth.status);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'JSON invalido.' }, 400); }
  const currentPassword = String(body?.currentPassword || '');
  const newPassword = String(body?.newPassword || '');
  if (newPassword.length < 10) return json({ ok: false, error: 'A nova senha precisa ter pelo menos 10 caracteres.' }, 400);
  const iterations = Number(auth.user.password_iterations || PASSWORD_ITERATIONS);
  if (iterations > PASSWORD_ITERATIONS) return json({ ok: false, error: 'Credencial central precisa ser reinicializada.', code: 'PASSWORD_PROFILE_LEGACY' }, 409);
  const currentHash = await passwordHash(currentPassword, auth.user.password_salt, iterations);
  if (!timingSafeEqual(currentHash, auth.user.password_hash)) return json({ ok: false, error: 'Senha atual incorreta.' }, 401);
  const record = await makePasswordRecord(newPassword);
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE cloud_users SET password_salt=?,password_hash=?,password_iterations=?,updated_at=? WHERE id=?').bind(record.salt, record.hash, record.iterations, now, auth.user.id).run();
  const currentTokenHash = await sessionTokenHash(request, env);
  if (!currentTokenHash) return json({ ok: false, code: 'SESSION_INVALID', error: 'Sessao invalida.' }, 401);
  await env.DB.prepare('DELETE FROM cloud_sessions WHERE user_id=? AND token_hash<>?').bind(auth.user.id, currentTokenHash).run();
  return json({ ok: true });
}

async function handleProfilePhoto(request, env) {
  const auth = await requireSession(request, env);
  if (auth.error) return json({ ok: false, error: auth.error }, auth.status);
  if (request.method === 'GET') {
    return json({ ok: true, mime: auth.user.profile_photo_mime || null, contentBase64: auth.user.profile_photo_base64 || null });
  }
  if (request.method === 'DELETE') {
    await env.DB.prepare('UPDATE cloud_users SET profile_photo_base64=NULL,profile_photo_mime=NULL,updated_at=? WHERE id=?')
      .bind(new Date().toISOString(), auth.user.id).run();
    return json({ ok: true });
  }
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'JSON inválido.' }, 400); }
  const photo = validateProfilePhoto(body);
  if (photo.error) return json({ ok: false, error: photo.error }, photo.status);
  await env.DB.prepare('UPDATE cloud_users SET profile_photo_base64=?,profile_photo_mime=?,updated_at=? WHERE id=?')
    .bind(photo.contentBase64, photo.mime, new Date().toISOString(), auth.user.id).run();
  return json({ ok: true, mime: photo.mime, contentBase64: photo.contentBase64 });
}

// Retorna uma Response quando a rota é de identidade central (/v1/auth/*,
// /v1/users*), ou null quando o caminho não pertence a este escopo — nesse
// caso o chamador segue para o roteamento normal (Container).
export async function handleCentralAuth(request, env) {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/v1/auth/session-hash') {
    try { return await checkSessionHash(request, env); }
    catch { return json({ ok: false, code: 'SERVER_ERROR', error: 'Não foi possível validar a sessão.' }, 500); }
  }
  const mobileRoutes = {
    'POST /v1/auth/password-reset/request': requestPasswordReset,
    'POST /v1/auth/password-reset/confirm': confirmPasswordReset,
    'GET /v1/auth/sessions': listSessions,
    'POST /v1/auth/sessions/revoke-others': revokeOtherSessions,
    'POST /v1/auth/handoff': issueHandoff,
    'POST /v1/auth/handoff/consume': consumeHandoff,
  };
  const mobile = mobileRoutes[`${request.method} ${url.pathname}`];
  if (mobile) {
    try {
      if (mobile !== requestPasswordReset) {
        const ip = request.headers.get('cf-connecting-ip') || 'unknown';
        if (!(await consumeRate(env.DB, ip, 'mobile-auth', 5000))) {
          return json({ ok: false, code: 'RATE_LIMITED', error: 'Limite temporário de requisições atingido.' }, 400);
        }
      }
      return await mobile(request, env);
    } catch {
      return json({ ok: false, code: 'SERVER_ERROR', error: 'Não foi possível concluir a operação.' }, 500);
    }
  }
  const isAuthRoute = url.pathname === '/v1/auth/login'
    || url.pathname === '/v1/auth/bootstrap'
    || url.pathname === '/v1/auth/change-password'
    || url.pathname === '/v1/auth/profile-photo'
    || isIdentityRoute(url.pathname);
  if (!isAuthRoute) return null;

  // Chamadas do servidor do Orcamentos chegam todas do mesmo IP de saida;
  // com a chave de servico valida, o limite usa o IP real repassado por ele.
  const service = await serviceKeyValid(request, env);
  const forwarded = service ? text(request.headers.get('x-construtec-client-ip')) : '';
  const ip = forwarded || request.headers.get('cf-connecting-ip') || 'unknown';
  const isLogin = request.method === 'POST' && url.pathname === '/v1/auth/login';
  const scope = isLogin ? 'login' : (service ? 'service' : 'api');
  const allowed = await consumeRate(env.DB, service && !isLogin ? 'orcamentos' : ip, scope, isLogin ? 60 : (service ? 50000 : 5000));
  if (!allowed) return json({ ok: false, error: 'Limite temporario de requisicoes atingido.' }, 429);

  if (request.method === 'POST' && url.pathname === '/v1/auth/login') return handleLogin(request, env);
  if (request.method === 'POST' && url.pathname === '/v1/auth/bootstrap') return handleBootstrap(request, env);
  if (request.method === 'POST' && url.pathname === '/v1/auth/change-password') return handleChangePassword(request, env);
  if (['GET', 'POST', 'DELETE'].includes(request.method) && url.pathname === '/v1/auth/profile-photo') return handleProfilePhoto(request, env);
  if (isIdentityRoute(url.pathname)) return handleIdentityAdmin(request, env, url, service);
  return json({ ok: false, error: 'Rota nao encontrada.' }, 404);
}
