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
  makePasswordRecord, publicUser, timingSafeEqual, sessionTokenHash,
} from './centralAuth.js';
import { forgetSessionDevice } from './notifications.js';
import {
  PERMISSIONS, SUITE_ROLES, validSuiteRole, legacyRoleFor, normalizeApps, defaultMatrix, loadMatrix,
} from './suiteRoles.js';

const MIN_SERVICE_KEY_LENGTH = 32;
const SERVICE_CREATED_ROLE = 'supervisor';

const ROUTES = new Set([
  '/v1/auth/session',
  '/v1/auth/logout',
  '/v1/users',
  '/v1/users/status',
  '/v1/users/delete',
  '/v1/users/access',
  '/v1/permissions',
  '/v1/permissions/reset',
  '/v1/authorized-emails',
  '/v1/authorized-emails/revoke',
]);

export function isIdentityRoute(pathname) {
  return ROUTES.has(pathname);
}

export function serviceKeyValid(request, env) {
  // Segredo colado com BOM (U+FEFF) ou espacos: normaliza os dois lados (o Orcamentos envia sem).
  const clean = (value) => String(value || '').replace(/^\uFEFF/, '').trim();
  const expected = clean(env.CONSTRUTEC_IDENTITY_KEY);
  if (expected.length < MIN_SERVICE_KEY_LENGTH) return false;
  return timingSafeEqual(clean(request.headers.get('x-construtec-identity-key')), expected);
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

// Admin do Centro com sessao propria, ou qualquer sessao valida chegando pela
// chave de servico (o Orcamentos ja verificou que o usuario e admin dele).
async function requireAccountAdmin(request, env, service) {
  const auth = await requireSession(request, env, service ? [] : ['admin']);
  if (auth.error) return auth;
  // Pela via de servico o poder e sempre o do Orcamentos, mesmo que o Bearer
  // seja de um admin do Centro: nada de criar ou alterar admins por ela.
  return { user: auth.user, centroAdmin: !service && auth.user.role === 'admin' };
}

// A tabela de producao nao tem org_id (organizacao unica, ORG_ID).
async function externalAuthorized(env, email) {
  const row = await env.DB.prepare('SELECT email FROM authorized_external_emails WHERE email=?')
    .bind(email).first();
  return Boolean(row);
}

async function liveUserByEmail(env, orgId, email) {
  return env.DB.prepare('SELECT * FROM cloud_users WHERE org_id=? AND email=? AND deleted_at IS NULL')
    .bind(orgId, email).first();
}

async function handleSession(request, env) {
  const user = await sessionUser(request, env);
  if (!user) return json({ ok: false, code: 'SESSION_INVALID', error: 'Sessao invalida ou expirada.' }, 401);
  return json({ ok: true, user: publicUser(user), expiresAt: Number(user.expires_at) });
}

// Encerra a sessão atual, as sessões web criadas por handoff a partir dela e os códigos pendentes.
// Continua respondendo 200 sem token, como antes, para não quebrar clientes antigos.
async function handleLogout(request, env) {
  const tokenHash = await sessionTokenHash(request, env);
  if (!tokenHash) return json({ ok: true, revoked: 0 });
  await forgetSessionDevice(env, tokenHash).catch(() => undefined);
  const [sessions] = await env.DB.batch([
    env.DB.prepare('DELETE FROM cloud_sessions WHERE token_hash=? OR parent_session_hash=?').bind(tokenHash, tokenHash),
    env.DB.prepare('DELETE FROM session_handoffs WHERE session_hash=?').bind(tokenHash),
  ]);
  return json({ ok: true, revoked: Number(sessions?.meta?.changes || 0) });
}

async function handleListUsers(env, auth) {
  const rows = (await env.DB.prepare(`
    SELECT id,name,email,role,suite_role,apps,active,created_at,updated_at,last_login_at
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
  const wantedSuite = auth.centroAdmin && body.suiteRole !== undefined ? text(body.suiteRole) : null;
  if (wantedSuite !== null && !validSuiteRole(wantedSuite)) return json({ ok: false, error: 'Papel invalido.' }, 400);
  const role = wantedSuite ? legacyRoleFor(wantedSuite) : auth.centroAdmin ? text(body.role) : SERVICE_CREATED_ROLE;
  const suiteRole = wantedSuite || null;
  const apps = auth.centroAdmin ? normalizeApps(body.apps) : null;
  if (!name || !validEmail(email) || password.length < 10 || !validRole(role)) {
    return json({ ok: false, error: 'Preencha nome, e-mail, senha de 10+ caracteres e perfil valido.' }, 400);
  }
  if (!validCorporateEmail(email) && !(await externalAuthorized(env, email))) {
    return json({ ok: false, error: 'E-mail nao autorizado; peca a um administrador para liberar.', code: 'EMAIL_NOT_AUTHORIZED' }, 403);
  }
  if (await liveUserByEmail(env, orgId, email)) return json({ ok: false, error: 'Ja existe um usuario com este e-mail.' }, 409);
  const record = await makePasswordRecord(password);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO cloud_users(id,org_id,name,email,password_salt,password_hash,password_iterations,role,suite_role,apps,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)
  `).bind(id, orgId, name, email, record.salt, record.hash, record.iterations, role, suiteRole, apps ? JSON.stringify(apps) : null, now, now).run();
  const created = await env.DB.prepare('SELECT * FROM cloud_users WHERE id=?').bind(id).first();
  return json({ ok: true, user: publicUser(created) }, 201);
}

// Valida o alvo de desativar/excluir: existe, nao e o proprio usuario e, pela
// via de servico, nao e um admin do Centro.
async function targetFor(request, env, auth, verb) {
  const body = await readJson(request);
  if (!body) return { response: json({ ok: false, error: 'JSON invalido.' }, 400) };
  const email = text(body.email).toLowerCase();
  if (!validEmail(email)) return { response: json({ ok: false, error: 'E-mail invalido.' }, 400) };
  const target = await liveUserByEmail(env, auth.user.org_id, email);
  // Com id informado, uma tela desatualizada nao atinge uma conta recriada.
  const expectedId = text(body.id);
  if (!target || (expectedId && target.id !== expectedId)) return { response: json({ ok: false, error: 'Usuario nao encontrado.' }, 404) };
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

// Papel novo e apps de um usuário. Só admin do Centro; não altera a própria conta
// (evita o último admin se rebaixar) e mantém o papel legado derivado do novo.
async function handleUserAccess(request, env, auth) {
  if (!auth.centroAdmin) return json({ ok: false, error: 'Somente um admin do Centro de Custos pode alterar papéis.' }, 403);
  const { response, body, target } = await targetFor(request, env, auth, 'alterar');
  if (response) return response;
  const suiteRole = text(body.suiteRole);
  if (!validSuiteRole(suiteRole)) return json({ ok: false, error: 'Papel invalido.' }, 400);
  const apps = body.apps === undefined ? undefined : normalizeApps(body.apps);
  if (apps === null) return json({ ok: false, error: 'Escolha ao menos um app.' }, 400);
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE cloud_users SET suite_role=?,role=?,apps=COALESCE(?,apps),updated_at=? WHERE id=?')
    .bind(suiteRole, legacyRoleFor(suiteRole), apps ? JSON.stringify(apps) : null, now, target.id).run();
  const updated = await env.DB.prepare('SELECT * FROM cloud_users WHERE id=?').bind(target.id).first();
  return json({ ok: true, user: publicUser(updated) });
}

async function permissionsPayload(env) {
  return { ok: true, roles: SUITE_ROLES, permissions: PERMISSIONS, matrix: await loadMatrix(env), defaults: defaultMatrix() };
}

// Leitura: qualquer sessão (o Centro e o celular guardam em cache). Escrita: admin.
async function handlePermissions(request, env) {
  if (request.method === 'GET') {
    const auth = await requireSession(request, env);
    if (auth.error) return json({ ok: false, error: auth.error }, auth.status);
    return json(await permissionsPayload(env));
  }
  const auth = await requireSession(request, env, ['admin']);
  if (auth.error) return json({ ok: false, error: auth.error }, auth.status);
  const body = await readJson(request);
  const { role, permission } = body || {};
  if (!SUITE_ROLES.includes(role) || !PERMISSIONS.includes(permission) || typeof body.allowed !== 'boolean') {
    return json({ ok: false, error: 'Papel, permissao e valor sao obrigatorios.' }, 400);
  }
  if (role === 'admin') return json({ ok: false, error: 'O administrador fica sempre com todas as permissoes.' }, 400);
  const standard = defaultMatrix()[role][permission];
  if (body.allowed === standard) {
    await env.DB.prepare('DELETE FROM role_permission_overrides WHERE role=? AND permission=?').bind(role, permission).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO role_permission_overrides(role,permission,allowed,updated_by,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(role,permission) DO UPDATE SET allowed=excluded.allowed,updated_by=excluded.updated_by,updated_at=excluded.updated_at
    `).bind(role, permission, body.allowed ? 1 : 0, auth.user.id, new Date().toISOString()).run();
  }
  return json(await permissionsPayload(env));
}

async function handlePermissionsReset(request, env) {
  const auth = await requireSession(request, env, ['admin']);
  if (auth.error) return json({ ok: false, error: auth.error }, auth.status);
  await env.DB.prepare('DELETE FROM role_permission_overrides').run();
  return json(await permissionsPayload(env));
}

async function handleAuthorizedEmails(request, env, auth, revoke) {
  if (request.method === 'GET') {
    const rows = (await env.DB.prepare(`
      SELECT a.email,a.note,a.authorized_at,u.name AS authorized_by_name
      FROM authorized_external_emails a
      LEFT JOIN cloud_users u ON u.id=a.authorized_by
      ORDER BY a.email
    `).all()).results || [];
    return json({ ok: true, emails: rows.map((row) => ({ email: row.email, note: row.note || null, authorizedAt: row.authorized_at, authorizedByName: row.authorized_by_name || null })) });
  }
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'JSON invalido.' }, 400);
  const email = text(body.email).toLowerCase();
  if (!validEmail(email)) return json({ ok: false, error: 'E-mail invalido.' }, 400);
  if (validCorporateEmail(email)) return json({ ok: false, error: 'E-mails corporativos ja sao permitidos.' }, 400);
  if (revoke) {
    await env.DB.prepare('DELETE FROM authorized_external_emails WHERE email=?').bind(email).run();
    return json({ ok: true });
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO authorized_external_emails(email,authorized_by,authorized_at,note) VALUES(?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET note=excluded.note
  `).bind(email, auth.user.id, now, text(body.note).slice(0, 200) || null).run();
  return json({ ok: true, email }, 201);
}

export async function handleIdentityAdmin(request, env, url, service) {
  const path = url.pathname;
  const method = request.method;
  if (path === '/v1/auth/session' && method === 'GET') return handleSession(request, env);
  if (path === '/v1/auth/logout' && method === 'POST') return handleLogout(request, env);

  if (path === '/v1/permissions' && (method === 'GET' || method === 'POST')) return handlePermissions(request, env);
  if (path === '/v1/permissions/reset' && method === 'POST') return handlePermissionsReset(request, env);

  const auth = await requireAccountAdmin(request, env, service);
  if (auth.error) return json({ ok: false, error: auth.error }, auth.status);
  if (path === '/v1/users' && method === 'GET') return handleListUsers(env, auth);
  if (path === '/v1/users' && method === 'POST') return handleCreateUser(request, env, auth);
  if (path === '/v1/users/status' && method === 'POST') return handleUserStatus(request, env, auth);
  if (path === '/v1/users/delete' && method === 'POST') return handleDeleteUser(request, env, auth);
  if (path === '/v1/users/access' && method === 'POST') return handleUserAccess(request, env, auth);
  if (path === '/v1/authorized-emails' && ['GET', 'POST'].includes(method)) return handleAuthorizedEmails(request, env, auth, false);
  if (path === '/v1/authorized-emails/revoke' && method === 'POST') return handleAuthorizedEmails(request, env, auth, true);
  return json({ ok: false, error: 'Rota nao encontrada.' }, 404);
}
