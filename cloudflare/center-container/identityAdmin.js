// Diretorio de contas compartilhado entre Centro de Custos e Orcamentos
// (docs/superpowers/specs/2026-09-19-identidade-compartilhada-design.md).
//
// Quem administra contas:
// - admin do Centro, com a propria sessao Bearer;
// - admin do Orcamentos, pelo servidor do Orcamentos: chave de servico
//   CONSTRUTEC_IDENTITY_KEY + sessao Bearer do usuario que agiu (para
//   auditoria). O Orcamentos decide quem e admin dele; aqui so se limita o
//   que essa via pode fazer: cria contas como supervisor e nunca altera ou
//   exclui um admin do Centro.
//
// Excluir login marca deleted_at e libera o e-mail; a linha fica para o
// historico continuar mostrando o nome da pessoa.

import {
  json, text, validCorporateEmail, validEmail, validRole, requireSession, sessionUser,
  makePasswordRecord, publicUser, timingSafeEqual, sha256Text,
} from './centralAuth.js';

const MIN_SERVICE_KEY_LENGTH = 32;
const SERVICE_CREATED_ROLE = 'supervisor';

const ROUTES = new Set([
  '/v1/auth/session',
  '/v1/auth/logout',
  '/v1/users',
  '/v1/users/status',
  '/v1/users/delete',
  '/v1/authorized-emails',
  '/v1/authorized-emails/revoke',
]);

export function isIdentityRoute(pathname) {
  return ROUTES.has(pathname);
}

export function serviceKeyValid(request, env) {
  const expected = String(env.CONSTRUTEC_IDENTITY_KEY || '');
  if (expected.length < MIN_SERVICE_KEY_LENGTH) return false;
  return timingSafeEqual(request.headers.get('x-construtec-identity-key') || '', expected);
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

// Admin do Centro com sessao propria, ou qualquer sessao valida chegando pela
// chave de servico (o Orcamentos ja verificou que o usuario e admin dele).
async function requireAccountAdmin(request, env, service) {
  const auth = await requireSession(request, env, service ? [] : ['admin']);
  if (auth.error) return auth;
  return { user: auth.user, centroAdmin: auth.user.role === 'admin' };
}

async function externalAuthorized(env, orgId, email) {
  const row = await env.DB.prepare('SELECT email FROM authorized_external_emails WHERE org_id=? AND email=?')
    .bind(orgId, email).first();
  return Boolean(row);
}

async function liveUserByEmail(env, orgId, email) {
  return env.DB.prepare('SELECT * FROM cloud_users WHERE org_id=? AND email=? AND deleted_at IS NULL')
    .bind(orgId, email).first();
}

async function handleSession(request, env) {
  const user = await sessionUser(request, env);
  if (!user) return json({ ok: false, error: 'Sessao invalida ou expirada.' }, 401);
  return json({ ok: true, user: publicUser(user), expiresAt: Number(user.expires_at) });
}

async function handleLogout(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) await env.DB.prepare('DELETE FROM cloud_sessions WHERE token_hash=?').bind(await sha256Text(token)).run();
  return json({ ok: true });
}

async function handleListUsers(env, auth) {
  const rows = (await env.DB.prepare(`
    SELECT id,name,email,role,active,created_at,updated_at,last_login_at
    FROM cloud_users WHERE org_id=? AND deleted_at IS NULL ORDER BY active DESC,name,email
  `).bind(auth.user.org_id).all()).results || [];
  return json({ ok: true, users: rows.map(publicUser) });
}

async function handleCreateUser(request, env, auth) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'JSON invalido.' }, 400);
  const orgId = auth.user.org_id;
  const name = text(body.name).slice(0, 120);
  const email = text(body.email).toLowerCase();
  const password = String(body.password || '');
  const role = auth.centroAdmin ? text(body.role) : SERVICE_CREATED_ROLE;
  if (!name || !validEmail(email) || password.length < 10 || !validRole(role)) {
    return json({ ok: false, error: 'Preencha nome, e-mail, senha de 10+ caracteres e perfil valido.' }, 400);
  }
  if (!validCorporateEmail(email) && !(await externalAuthorized(env, orgId, email))) {
    return json({ ok: false, error: 'E-mail nao autorizado; peca a um administrador para liberar.', code: 'EMAIL_NOT_AUTHORIZED' }, 403);
  }
  if (await liveUserByEmail(env, orgId, email)) return json({ ok: false, error: 'Ja existe um usuario com este e-mail.' }, 409);
  const record = await makePasswordRecord(password);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO cloud_users(id,org_id,name,email,password_salt,password_hash,password_iterations,role,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,1,?,?)
  `).bind(id, orgId, name, email, record.salt, record.hash, record.iterations, role, now, now).run();
  return json({ ok: true, user: { id, name, email, role, active: true, createdAt: now, updatedAt: now, lastLoginAt: null } }, 201);
}

// Valida o alvo de desativar/excluir: existe, nao e o proprio usuario e, pela
// via de servico, nao e um admin do Centro.
async function targetFor(request, env, auth, verb) {
  const body = await readJson(request);
  if (!body) return { response: json({ ok: false, error: 'JSON invalido.' }, 400) };
  const email = text(body.email).toLowerCase();
  if (!validEmail(email)) return { response: json({ ok: false, error: 'E-mail invalido.' }, 400) };
  const target = await liveUserByEmail(env, auth.user.org_id, email);
  if (!target) return { response: json({ ok: false, error: 'Usuario nao encontrado.' }, 404) };
  if (target.id === auth.user.id) return { response: json({ ok: false, error: `Voce nao pode ${verb} o proprio acesso.` }, 400) };
  if (target.role === 'admin' && !auth.centroAdmin) {
    return { response: json({ ok: false, error: 'Somente um admin do Centro de Custos pode alterar outro admin.' }, 403) };
  }
  return { body, target };
}

async function handleUserStatus(request, env, auth) {
  const { response, body, target } = await targetFor(request, env, auth, 'desativar');
  if (response) return response;
  const active = body.active === true ? 1 : 0;
  await env.DB.prepare('UPDATE cloud_users SET active=?,updated_at=? WHERE id=?').bind(active, new Date().toISOString(), target.id).run();
  if (!active) await env.DB.prepare('DELETE FROM cloud_sessions WHERE user_id=?').bind(target.id).run();
  return json({ ok: true });
}

async function handleDeleteUser(request, env, auth) {
  const { response, target } = await targetFor(request, env, auth, 'excluir');
  if (response) return response;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE cloud_users SET deleted_at=?,active=0,updated_at=? WHERE id=? AND deleted_at IS NULL').bind(now, now, target.id),
    env.DB.prepare('DELETE FROM cloud_sessions WHERE user_id=?').bind(target.id),
  ]);
  return json({ ok: true, deletedId: target.id, deletedAt: now });
}

async function handleAuthorizedEmails(request, env, auth, revoke) {
  const orgId = auth.user.org_id;
  if (request.method === 'GET') {
    const rows = (await env.DB.prepare(`
      SELECT a.email,a.note,a.authorized_at,u.name AS authorized_by_name
      FROM authorized_external_emails a
      LEFT JOIN cloud_users u ON u.id=a.authorized_by
      WHERE a.org_id=? ORDER BY a.email
    `).bind(orgId).all()).results || [];
    return json({ ok: true, emails: rows.map((row) => ({ email: row.email, note: row.note || null, authorizedAt: row.authorized_at, authorizedByName: row.authorized_by_name || null })) });
  }
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'JSON invalido.' }, 400);
  const email = text(body.email).toLowerCase();
  if (!validEmail(email)) return json({ ok: false, error: 'E-mail invalido.' }, 400);
  if (validCorporateEmail(email)) return json({ ok: false, error: 'E-mails corporativos ja sao permitidos.' }, 400);
  if (revoke) {
    await env.DB.prepare('DELETE FROM authorized_external_emails WHERE org_id=? AND email=?').bind(orgId, email).run();
    return json({ ok: true });
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO authorized_external_emails(org_id,email,authorized_by,authorized_at,note) VALUES(?,?,?,?,?)
    ON CONFLICT(org_id,email) DO UPDATE SET note=excluded.note
  `).bind(orgId, email, auth.user.id, now, text(body.note).slice(0, 200) || null).run();
  return json({ ok: true, email }, 201);
}

export async function handleIdentityAdmin(request, env, url, service) {
  const path = url.pathname;
  const method = request.method;
  if (path === '/v1/auth/session' && method === 'GET') return handleSession(request, env);
  if (path === '/v1/auth/logout' && method === 'POST') return handleLogout(request, env);

  const auth = await requireAccountAdmin(request, env, service);
  if (auth.error) return json({ ok: false, error: auth.error }, auth.status);
  if (path === '/v1/users' && method === 'GET') return handleListUsers(env, auth);
  if (path === '/v1/users' && method === 'POST') return handleCreateUser(request, env, auth);
  if (path === '/v1/users/status' && method === 'POST') return handleUserStatus(request, env, auth);
  if (path === '/v1/users/delete' && method === 'POST') return handleDeleteUser(request, env, auth);
  if (path === '/v1/authorized-emails' && ['GET', 'POST'].includes(method)) return handleAuthorizedEmails(request, env, auth, false);
  if (path === '/v1/authorized-emails/revoke' && method === 'POST') return handleAuthorizedEmails(request, env, auth, true);
  return json({ ok: false, error: 'Rota nao encontrada.' }, 404);
}
