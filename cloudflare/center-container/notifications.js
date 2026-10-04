import { json, requireSession, timingSafeEqual, cleanSyncKey, ORG_ID } from './centralAuth.js';
import { sendPush } from './fcm.js';

// Fase 4 da Suíte mobile: central de notificações, preferências e push (FCM).
// Rotas do app (Bearer da sessão central) e internas (x-sync-key, do Container).
export const TYPES = ['proposta_aprovada', 'acima_orcado', 'conta_vencer', 'novo_acesso', 'pedido_acesso', 'cliente_aprovou', 'cliente_ajuste'];
const APPS = new Set(['centro-custos', 'orcamentos', 'conta']);
// Mesmo formato do seletor Suíte: app e, se houver, o destino validado.
const LINK = /^(centro-custos|orcamentos)(\?(obra=[0-9]{1,12}|proposta=[A-Za-z0-9-]{1,64}|pedidos=1))?$/;
const clip = (value, max) => String(value ?? '').trim().slice(0, max);

export function isNotificationRoute(pathname) {
  return pathname.startsWith('/v1/push/') || pathname.startsWith('/v1/notifications') || pathname.startsWith('/v1/internal/');
}

function syncKeyValid(request, env) {
  const expected = cleanSyncKey(env);
  return expected.length >= 32 && timingSafeEqual(request.headers.get('x-sync-key') || '', expected);
}

// Chave de serviço do Orçamentos (a mesma da identidade compartilhada), normalizada como em identityAdmin.js.
function identityKeyValid(request, env) {
  const clean = (value) => String(value || '').replace(/^\uFEFF/, '').trim();
  const expected = clean(env.CONSTRUTEC_IDENTITY_KEY);
  return expected.length >= 32 && timingSafeEqual(clean(request.headers.get('x-construtec-identity-key')), expected);
}

// O cliente respondeu ao link da proposta: avisa o responsável e os admins. O texto é montado aqui,
// o Orçamentos só informa o fato (nada do que o cliente escreveu vai para o aviso).
async function clientReply(env, body) {
  const proposalId = String(body.proposalId || '');
  const number = clip(body.proposalNumber, 40).replace(/[^A-Za-z0-9._-]/g, '');
  const approved = body.event === 'approved';
  if (!/^[A-Za-z0-9-]{1,64}$/.test(proposalId) || !number || (!approved && body.event !== 'adjust')) return json({ ok: false, code: 'EVENT_INVALID', error: 'Evento inválido.' }, 400);
  const event = {
    type: approved ? 'cliente_aprovou' : 'cliente_ajuste', app: 'orcamentos', link: `orcamentos?proposta=${proposalId}`,
    title: approved ? `Cliente aprovou a proposta ${number}` : `Cliente pediu ajuste na proposta ${number}`,
    body: approved ? 'Abra a proposta e confirme a aprovação para ela virar Aprovada.' : 'A proposta voltou para edição como nova revisão. Veja o pedido do cliente.',
    // Mesmo evento da mesma proposta dentro de 1 minuto conta como um so (reenvio do Orcamentos).
    dedupeKey: `${body.event}:${proposalId}:${Math.floor(Date.now() / 60000).toString(36)}`,
  };
  const admins = await deliver(env, { ...event, audience: 'admins' });
  const owner = String(body.responsibleCentroUserId || '');
  // Quem já recebeu como admin não recebe de novo (mesmo dedupeKey por usuário).
  const own = owner ? await deliver(env, { ...event, userId: owner }) : { created: 0 };
  return json({ ok: true, created: admins.created + own.created });
}

const placeholders = (list) => list.map(() => '?').join(',');

// Grava o aviso para cada destinatário (sem repetir o dedupe_key), respeitando
// as preferências, e manda o push para os aparelhos de quem recebeu.
export async function deliver(env, input) {
  const type = clip(input.type, 40);
  if (!TYPES.includes(type) && type !== 'teste') return { created: 0, pushed: 0, error: 'TYPE_INVALID' };
  const app = APPS.has(input.app) ? input.app : 'centro-custos';
  const title = clip(input.title, 120), body = clip(input.body, 400);
  const link = LINK.test(String(input.link || '')) ? input.link : null;
  const dedupeKey = input.dedupeKey ? clip(input.dedupeKey, 200) : null;
  if (!title || !body) return { created: 0, pushed: 0, error: 'TEXT_REQUIRED' };
  const everyone = input.audience === 'all' || input.audience === 'admins';
  const adminsOnly = input.audience === 'admins' ? " AND role='admin'" : '';
  let ids = everyone
    ? ((await env.DB.prepare(`SELECT id FROM cloud_users WHERE org_id=? AND active=1 AND deleted_at IS NULL${adminsOnly}`).bind(ORG_ID).all()).results || []).map((r) => r.id)
    : [String(input.userId || '')].filter(Boolean);
  if (type !== 'teste' && ids.length) {
    const off = (await env.DB.prepare(`SELECT user_id FROM notification_prefs WHERE type=? AND enabled=0 AND user_id IN (${placeholders(ids)})`)
      .bind(type, ...ids).all()).results || [];
    const muted = new Set(off.map((r) => r.user_id));
    ids = ids.filter((id) => !muted.has(id));
  }
  const created = [];
  const now = new Date().toISOString();
  for (const userId of ids) {
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO notifications(id,user_id,type,app,title,body,link,dedupe_key,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), userId, type, app, title, body, link, dedupeKey, now).run();
    if (result.meta?.changes) created.push(userId);
  }
  if (!created.length) return { created: 0, pushed: 0 };
  const tokens = ((await env.DB.prepare(`SELECT fcm_token FROM push_devices WHERE user_id IN (${placeholders(created)})`)
    .bind(...created).all()).results || []).map((r) => r.fcm_token);
  let pushed = 0;
  try {
    const { sent, invalid } = await sendPush(env, tokens, { title, body, link, type });
    pushed = sent;
    for (const token of invalid) await env.DB.prepare('DELETE FROM push_devices WHERE fcm_token=?').bind(token).run();
  } catch { /* o aviso fica na central mesmo sem push */ }
  return { created: created.length, pushed };
}

async function list(env, userId, body) {
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100);
  const rows = (await env.DB.prepare(`SELECT id,type,app,title,body,link,created_at,read_at FROM notifications
    WHERE user_id=? ORDER BY created_at DESC LIMIT ?`).bind(userId, limit).all()).results || [];
  const unread = await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL').bind(userId).first();
  return json({ ok: true, unread: Number(unread?.n || 0), items: rows.map((r) => ({
    id: r.id, type: r.type, app: r.app, title: r.title, body: r.body, link: r.link, createdAt: r.created_at, read: Boolean(r.read_at),
  })) });
}

async function markRead(env, userId, body) {
  const now = new Date().toISOString();
  if (body.all === true) {
    await env.DB.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(now, userId).run();
  } else {
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((id) => /^[0-9a-f-]{36}$/.test(id)).slice(0, 100);
    if (ids.length) {
      await env.DB.prepare(`UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL AND id IN (${placeholders(ids)})`)
        .bind(now, userId, ...ids).run();
    }
  }
  return list(env, userId, {});
}

async function prefs(env, userId) {
  const rows = (await env.DB.prepare('SELECT type,enabled FROM notification_prefs WHERE user_id=?').bind(userId).all()).results || [];
  const off = new Set(rows.filter((r) => !Number(r.enabled)).map((r) => r.type));
  return json({ ok: true, prefs: Object.fromEntries(TYPES.map((type) => [type, !off.has(type)])) });
}

async function setPref(env, userId, body) {
  if (!TYPES.includes(body.type) || typeof body.enabled !== 'boolean') return json({ ok: false, code: 'PREF_INVALID', error: 'Preferência inválida.' }, 400);
  await env.DB.prepare(`INSERT INTO notification_prefs(user_id,type,enabled) VALUES(?,?,?)
    ON CONFLICT(user_id,type) DO UPDATE SET enabled=excluded.enabled`).bind(userId, body.type, body.enabled ? 1 : 0).run();
  return prefs(env, userId);
}

async function test(env, userId) {
  const result = await deliver(env, { userId, type: 'teste', app: 'conta', title: 'Notificação de teste', body: 'Se você recebeu isto no celular, as notificações da Suíte Construtec estão funcionando.' });
  const devices = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_devices WHERE user_id=?').bind(userId).first();
  return json({ ok: true, pushed: result.pushed, devices: Number(devices?.n || 0) });
}

const ACTIONS = { list, read: markRead, prefs, setPref, test };

async function register(env, user, request, body) {
  const token = String(body.fcmToken || '');
  const instanceId = clip(request.headers.get('x-instance-id'), 200);
  if (!/^[A-Za-z0-9:_-]{20,4096}$/.test(token) || !instanceId) return json({ ok: false, code: 'DEVICE_INVALID', error: 'Aparelho inválido.' }, 400);
  const now = new Date().toISOString();
  await env.DB.batch([
    // O token é do aparelho: se outra conta entrar nele, o aparelho passa para ela.
    env.DB.prepare('DELETE FROM push_devices WHERE fcm_token=? AND NOT (user_id=? AND instance_id=?)').bind(token, user.id, instanceId),
    env.DB.prepare(`INSERT INTO push_devices(user_id,instance_id,fcm_token,instance_name,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(user_id,instance_id) DO UPDATE SET fcm_token=excluded.fcm_token,instance_name=excluded.instance_name,updated_at=excluded.updated_at`)
      .bind(user.id, instanceId, token, clip(request.headers.get('x-instance-name'), 120) || null, now),
  ]);
  return json({ ok: true });
}

// Primeira entrada de um aparelho numa conta que já tinha outro: avisa o dono.
export async function noteLogin(env, user, request) {
  const instanceId = clip(request.headers.get('x-instance-id'), 200);
  if (!instanceId) return;
  try {
    const seen = await env.DB.prepare('SELECT 1 FROM known_devices WHERE user_id=? AND instance_id=?').bind(user.id, instanceId).first();
    if (seen) return;
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM known_devices WHERE user_id=?').bind(user.id).first();
    await env.DB.prepare('INSERT OR IGNORE INTO known_devices(user_id,instance_id,first_seen_at) VALUES(?,?,?)').bind(user.id, instanceId, new Date().toISOString()).run();
    if (!Number(before?.n || 0)) return;
    const name = clip(request.headers.get('x-instance-name'), 120) || 'um aparelho novo';
    await deliver(env, { userId: user.id, type: 'novo_acesso', app: 'conta', title: 'Novo acesso à sua conta',
      body: `Entrada em ${name}. Se não foi você, troque a senha em Segurança.`, dedupeKey: `acesso:${instanceId}` });
  } catch { /* o login não depende do aviso */ }
}

// "Sair" no app: o aparelho deixa de receber push desta conta.
export async function forgetSessionDevice(env, tokenHash) {
  const session = await env.DB.prepare('SELECT user_id,instance_id FROM cloud_sessions WHERE token_hash=?').bind(tokenHash).first();
  if (session?.instance_id) await env.DB.prepare('DELETE FROM push_devices WHERE user_id=? AND instance_id=?').bind(session.user_id, session.instance_id).run();
}

export async function handleNotifications(request, env, url) {
  let body = {};
  if (request.method !== 'GET') { try { body = (await request.json()) || {}; } catch { body = {}; } }
  try {
    if (request.method === 'POST' && url.pathname === '/v1/internal/orcamentos-notify') {
      if (!identityKeyValid(request, env)) return json({ ok: false, code: 'FORBIDDEN', error: 'Sem permissão.' }, 403);
      return await clientReply(env, body);
    }
    if (url.pathname.startsWith('/v1/internal/')) {
      if (!syncKeyValid(request, env)) return json({ ok: false, code: 'FORBIDDEN', error: 'Sem permissão.' }, 403);
      if (request.method === 'POST' && url.pathname === '/v1/internal/notify') return json({ ok: true, ...(await deliver(env, body)) });
      if (request.method === 'POST' && url.pathname === '/v1/internal/notifications') {
        const action = ACTIONS[body.action];
        const user = await env.DB.prepare('SELECT id FROM cloud_users WHERE id=? AND org_id=? AND active=1 AND deleted_at IS NULL').bind(String(body.userId || ''), ORG_ID).first();
        if (!action || !user) return json({ ok: false, code: 'NOT_FOUND', error: 'Conta não encontrada.' }, 404);
        return action(env, user.id, body);
      }
      return json({ ok: false, error: 'Rota não encontrada.' }, 404);
    }
    const auth = await requireSession(request, env);
    if (auth.error) return json({ ok: false, code: 'SESSION_INVALID', error: auth.error }, auth.status);
    const route = `${request.method} ${url.pathname}`;
    if (route === 'POST /v1/push/register') return register(env, auth.user, request, body);
    if (route === 'GET /v1/notifications') return list(env, auth.user.id, Object.fromEntries(url.searchParams));
    if (route === 'POST /v1/notifications/read') return markRead(env, auth.user.id, body);
    if (route === 'GET /v1/notifications/prefs') return prefs(env, auth.user.id);
    if (route === 'PUT /v1/notifications/prefs') return setPref(env, auth.user.id, body);
    if (route === 'POST /v1/notifications/test') return test(env, auth.user.id);
    return json({ ok: false, error: 'Rota não encontrada.' }, 404);
  } catch {
    return json({ ok: false, code: 'SERVER_ERROR', error: 'Não foi possível concluir a operação.' }, 500);
  }
}

// Cron diário: o Container calcula as contas a vencer e os itens acima do orçado.
export async function runDailyNotices(env) {
  if (!env.API || cleanSyncKey(env).length < 32) return { events: 0 };
  const response = await env.API.getByName('production').fetch(new Request('https://container.internal/api/interno/avisos-diarios', {
    method: 'POST', headers: { 'x-sync-key': cleanSyncKey(env), 'content-type': 'application/json' }, body: '{}',
  }));
  const data = await response.json().catch(() => ({}));
  const events = Array.isArray(data.events) ? data.events.slice(0, 50) : [];
  for (const event of events) await deliver(env, { ...event, audience: 'all' });
  return { events: events.length };
}
