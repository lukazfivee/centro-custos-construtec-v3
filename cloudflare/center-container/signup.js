import { json, makePasswordRecord, requireSession, sha256Text, text, timingSafeEqual, cleanSyncKey, validEmail, validRole, ORG_ID } from './centralAuth.js';
import { rateAllowed, strongPassword } from './passwordReset.js';
import { deliver } from './notifications.js';
import { validSuiteRole, legacyRoleFor, suiteFromLegacy, normalizeApps } from './suiteRoles.js';

// Fase 5 da Suíte mobile: cadastro pelo app com o código da empresa e aprovação
// do admin, convite por e-mail (a conta sai aprovada) e o código da empresa.
const BASE = 'https://centro-custos-api.construtec-reports.workers.dev';
const INVITE_DAYS = 7;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function isSignupRoute(pathname) {
  return pathname.startsWith('/v1/signup') || pathname === '/v1/internal/signup';
}

const fail = (code, error, status = 400) => json({ ok: false, code, error }, status);
const normalizeCode = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `CONST-${Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')}`;
}

export async function companyCode(env, rotate = false) {
  if (!rotate) {
    const row = await env.DB.prepare("SELECT value FROM org_settings WHERE org_id=? AND key='company_code'").bind(ORG_ID).first();
    if (row) return row.value;
  }
  const code = newCode();
  await env.DB.prepare(`INSERT INTO org_settings(org_id,key,value,updated_at) VALUES(?,'company_code',?,?)
    ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(ORG_ID, code, new Date().toISOString()).run();
  return code;
}

async function sendMail(env, to, subject, body) {
  if (!env.EMAIL_PROVIDER_API_KEY || !env.EMAIL_FROM) { console.info('signup_email_unconfigured'); return; }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.EMAIL_PROVIDER_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text: body }),
    });
    if (!response.ok) console.warn('signup_email_delivery_failed', response.status);
  } catch { console.warn('signup_email_delivery_failed'); }
}

async function emailInUse(env, email) {
  return env.DB.prepare('SELECT 1 FROM cloud_users WHERE org_id=? AND email=? AND deleted_at IS NULL').bind(ORG_ID, email).first();
}

// Papel pedido: o novo (suiteRole) define o antigo; sem ele vale o antigo e o novo sai dele.
function pickRole(body) {
  const suiteRole = validSuiteRole(body.suiteRole) ? body.suiteRole : null;
  const role = suiteRole ? legacyRoleFor(suiteRole) : (validRole(body.role) ? body.role : 'supervisor');
  const apps = normalizeApps(body.apps);
  return { role, suiteRole: suiteRole || suiteFromLegacy(role), apps: apps ? JSON.stringify(apps) : null };
}

async function createUser(env, { name, email, phone, salt, hash, iterations, role, suiteRole, apps }) {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO cloud_users(id,org_id,name,email,password_salt,password_hash,password_iterations,role,suite_role,apps,active,created_at,updated_at,phone,tour_pending)
    VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,1)`).bind(id, ORG_ID, name, email, salt, hash, iterations, role, suiteRole || suiteFromLegacy(role), apps || null, now, now, phone || null).run();
  return id;
}

// POST /v1/signup/request, sem sessão: pedido com o código da empresa (fica pendente)
// ou com o convite (a conta é criada na hora).
async function requestSignup(request, env) {
  let body;
  try { body = await request.json(); } catch { body = null; }
  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!(await rateAllowed(env.DB, 'signup-ip', ip, 10, now))) return fail('RATE_LIMITED', 'Muitas tentativas. Tente de novo em alguns minutos.');
  const name = text(body?.name).slice(0, 120), email = text(body?.email).toLowerCase(), phone = String(body?.phone || '').replace(/\D/g, '').slice(0, 13);
  const password = String(body?.password || '');
  if (name.length < 2) return fail('NAME_INVALID', 'Informe seu nome completo.');
  if (!validEmail(email)) return fail('EMAIL_INVALID', 'Informe um e-mail válido.');
  if (phone.length < 10) return fail('PHONE_INVALID', 'Informe o celular com DDD.');
  if (!strongPassword(password)) return fail('PASSWORD_WEAK', 'A senha precisa ter 8 caracteres e 3 dos 4 itens: maiúscula, número, símbolo, minúscula.');
  if (body?.acceptTerms !== true) return fail('TERMS_REQUIRED', 'Aceite os termos para criar a conta.');
  if (await emailInUse(env, email)) return fail('EMAIL_IN_USE', 'Este e-mail já tem conta. Use Entrar ou Esqueci a senha.', 409);
  const record = await makePasswordRecord(password);
  const nowIso = new Date().toISOString();

  if (body?.inviteToken) {
    const hash = await sha256Text(String(body.inviteToken));
    const invite = await env.DB.prepare('SELECT * FROM signup_invites WHERE token_hash=? AND org_id=? AND used_at IS NULL AND expires_at>?').bind(hash, ORG_ID, now).first();
    if (!invite || invite.email !== email) return fail('INVITE_INVALID', 'Convite inválido ou vencido. Peça um novo ao administrador.');
    const claimed = await env.DB.prepare('UPDATE signup_invites SET used_at=? WHERE token_hash=? AND used_at IS NULL').bind(nowIso, hash).run();
    if (!claimed.meta?.changes) return fail('INVITE_INVALID', 'Convite inválido ou vencido. Peça um novo ao administrador.');
    const userId = await createUser(env, { name, email, phone, ...record, iterations: record.iterations, role: invite.role, suiteRole: invite.suite_role || null, apps: invite.apps || null });
    await env.DB.prepare(`INSERT INTO signup_requests(id,org_id,name,email,phone,password_salt,password_hash,password_iterations,status,role,created_at,decided_at,decided_by,user_id)
      VALUES(?,?,?,?,?,'-','-',0,'approved',?,?,?,?,?)`).bind(crypto.randomUUID(), ORG_ID, name, email, phone, invite.role, nowIso, nowIso, invite.created_by, userId).run();
    return json({ ok: true, status: 'approved' });
  }

  if (normalizeCode(body?.companyCode) !== normalizeCode(await companyCode(env))) return fail('CODE_INVALID', 'Código da empresa incorreto. Confira com o administrador.');
  const id = crypto.randomUUID();
  await env.DB.prepare("DELETE FROM signup_requests WHERE org_id=? AND email=? AND status='pending'").bind(ORG_ID, email).run();
  await env.DB.prepare(`INSERT INTO signup_requests(id,org_id,name,email,phone,password_salt,password_hash,password_iterations,status,created_at)
    VALUES(?,?,?,?,?,?,?,?,'pending',?)`).bind(id, ORG_ID, name, email, phone, record.salt, record.hash, record.iterations, nowIso).run();
  // O pedido já está gravado: falha no aviso não pode virar erro para quem se cadastrou.
  try {
    await deliver(env, { audience: 'admins', type: 'pedido_acesso', app: 'conta', title: 'Novo pedido de acesso',
      body: `${name} (${email}) pediu acesso à Suíte Construtec.`, link: 'centro-custos?pedidos=1', dedupeKey: `pedido:${id}` });
  } catch { console.warn('signup_notice_failed'); }
  return json({ ok: true, status: 'pending' });
}

// Ações do admin: pela sessão central (app) ou pela rota interna (Container, com o id do admin).
async function list(env) {
  const rows = (await env.DB.prepare(`SELECT id,name,email,phone,created_at FROM signup_requests WHERE org_id=? AND status='pending' ORDER BY created_at`).bind(ORG_ID).all()).results || [];
  const invites = (await env.DB.prepare('SELECT email,role,suite_role,created_at,expires_at FROM signup_invites WHERE org_id=? AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 20')
    .bind(ORG_ID, Math.floor(Date.now() / 1000)).all()).results || [];
  return json({ ok: true, code: await companyCode(env), requests: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, createdAt: r.created_at })),
    invites: invites.map((i) => ({ email: i.email, role: i.role, suiteRole: i.suite_role || suiteFromLegacy(i.role), createdAt: i.created_at, expiresAt: i.expires_at })) });
}

async function approve(env, admin, body) {
  const { role, suiteRole, apps } = pickRole(body);
  const row = await env.DB.prepare("SELECT * FROM signup_requests WHERE id=? AND org_id=? AND status='pending'").bind(String(body.id || ''), ORG_ID).first();
  if (!row) return fail('NOT_FOUND', 'Pedido não encontrado ou já decidido.', 404);
  if (await emailInUse(env, row.email)) return fail('EMAIL_IN_USE', 'Este e-mail já tem conta.', 409);
  // Reserva o pedido antes de criar a conta: dois admins aprovando juntos não criam duas.
  const claimed = await env.DB.prepare("UPDATE signup_requests SET status='approved',role=?,decided_at=?,decided_by=? WHERE id=? AND status='pending'")
    .bind(role, new Date().toISOString(), admin.id, row.id).run();
  if (!claimed.meta?.changes) return fail('NOT_FOUND', 'Pedido não encontrado ou já decidido.', 404);
  const userId = await createUser(env, { name: row.name, email: row.email, phone: row.phone, salt: row.password_salt, hash: row.password_hash, iterations: row.password_iterations, role, suiteRole, apps });
  await env.DB.prepare('UPDATE signup_requests SET user_id=? WHERE id=?').bind(userId, row.id).run();
  await sendMail(env, row.email, 'Seu acesso à Suíte Construtec foi aprovado',
    `Olá, ${row.name}.\n\nSeu acesso à Suíte Construtec foi aprovado. Abra o app e entre com o e-mail ${row.email} e a senha que você criou no cadastro.`);
  return list(env);
}

async function reject(env, admin, body) {
  const row = await env.DB.prepare("SELECT * FROM signup_requests WHERE id=? AND org_id=? AND status='pending'").bind(String(body.id || ''), ORG_ID).first();
  if (!row) return fail('NOT_FOUND', 'Pedido não encontrado ou já decidido.', 404);
  const done = await env.DB.prepare("UPDATE signup_requests SET status='rejected',password_hash='-',password_salt='-',decided_at=?,decided_by=? WHERE id=? AND status='pending'").bind(new Date().toISOString(), admin.id, row.id).run();
  if (!done.meta?.changes) return fail('NOT_FOUND', 'Pedido não encontrado ou já decidido.', 404);
  await sendMail(env, row.email, 'Pedido de acesso à Suíte Construtec',
    `Olá, ${row.name}.\n\nSeu pedido de acesso à Suíte Construtec não foi aprovado. Se achar que foi um engano, fale com o administrador da Construtec.`);
  return list(env);
}

async function invite(env, admin, body) {
  const email = text(body.email).toLowerCase();
  const { role, suiteRole, apps } = pickRole(body);
  if (!validEmail(email)) return fail('EMAIL_INVALID', 'Informe um e-mail válido.');
  if (await emailInUse(env, email)) return fail('EMAIL_IN_USE', 'Este e-mail já tem conta.', 409);
  const token = randomToken();
  await env.DB.prepare('INSERT INTO signup_invites(token_hash,org_id,email,role,suite_role,apps,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(await sha256Text(token), ORG_ID, email, role, suiteRole, apps, admin.id, new Date().toISOString(), Math.floor(Date.now() / 1000) + INVITE_DAYS * 86400).run();
  const code = await companyCode(env);
  const link = `${BASE}/cadastro#convite=${token}&codigo=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`;
  await sendMail(env, email, 'Convite para a Suíte Construtec',
    `${admin.name} convidou você para a Suíte Construtec.\n\nNo celular com o app Suíte Construtec instalado, abra este link em até ${INVITE_DAYS} dias para criar sua conta: ${link}\n\nSe não conhece a Construtec, ignore esta mensagem.`);
  return list(env);
}

async function rotate(env) { await companyCode(env, true); return list(env); }

const ACTIONS = { list: (env) => list(env), approve, reject, invite, rotate };

export async function handleSignup(request, env, url) {
  try {
    if (request.method === 'POST' && url.pathname === '/v1/signup/request') return await requestSignup(request, env);
    let body = {};
    if (request.method !== 'GET') { try { body = (await request.json()) || {}; } catch { body = {}; } }
    let admin;
    if (url.pathname === '/v1/internal/signup') {
      const expected = cleanSyncKey(env);
      if (expected.length < 32 || !timingSafeEqual(request.headers.get('x-sync-key') || '', expected)) return fail('FORBIDDEN', 'Sem permissão.', 403);
      admin = await env.DB.prepare("SELECT id,name FROM cloud_users WHERE id=? AND org_id=? AND role='admin' AND active=1 AND deleted_at IS NULL").bind(String(body.actorId || ''), ORG_ID).first();
      if (!admin) return fail('FORBIDDEN', 'Apenas administradores gerenciam pedidos de acesso.', 403);
    } else {
      const auth = await requireSession(request, env, ['admin']);
      if (auth.error) return fail(auth.status === 401 ? 'SESSION_INVALID' : 'FORBIDDEN', auth.error, auth.status);
      admin = auth.user;
      body.action = { 'GET /v1/signup/requests': 'list', 'POST /v1/signup/approve': 'approve', 'POST /v1/signup/reject': 'reject',
        'POST /v1/signup/invite': 'invite', 'POST /v1/signup/code/rotate': 'rotate' }[`${request.method} ${url.pathname}`];
    }
    const action = ACTIONS[body.action];
    if (!action) return fail('NOT_FOUND', 'Rota não encontrada.', 404);
    return await action(env, admin, body);
  } catch {
    return fail('SERVER_ERROR', 'Não foi possível concluir a operação.', 500);
  }
}

// Página aberta quando o link do convite não abre o app (app não instalado).
export function invitePage() {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Convite · Suíte Construtec</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#021820;color:#fefefe;font:16px/1.5 system-ui,sans-serif}main{max-width:360px;padding:24px}h1{font-size:22px}p{color:#b9d4dd}</style></head>
<body><main><h1>Convite para a Suíte Construtec</h1><p>Abra este link no celular com o app Suíte Construtec instalado. O cadastro abre com o convite já preenchido.</p>
<p>Ainda não tem o app? Peça o instalador ao administrador da Construtec.</p></main></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
