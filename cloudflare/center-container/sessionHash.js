import { json, timingSafeEqual } from './centralAuth.js';

// Consulta usada apenas pelo Container para validar uma sessão web criada no D1.
export async function checkSessionHash(request, env) {
  const expected = String(env.SYNC_SHARED_KEY || '');
  if (expected.length < 32 || !timingSafeEqual(request.headers.get('x-sync-key'), expected)) {
    return json({ ok: false, code: 'SESSION_INVALID', error: 'Sessão inválida.' }, 401);
  }
  let body;
  try { body = await request.json(); } catch { body = null; }
  const hash = String(body?.sessionHash || '');
  const userId = String(body?.userId || '');
  if (!/^[a-f0-9]{64}$/.test(hash) || !userId) {
    return json({ ok: false, code: 'SESSION_INVALID', error: 'Sessão inválida.' }, 401);
  }
  const row = await env.DB.prepare(`SELECT 1 FROM cloud_sessions s
    JOIN cloud_users u ON u.id=s.user_id AND u.org_id=s.org_id
    WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>? AND u.active=1 AND u.deleted_at IS NULL`)
    .bind(hash, userId, Math.floor(Date.now() / 1000)).first();
  if (!row) return json({ ok: false, code: 'SESSION_INVALID', error: 'Sessão inválida.' }, 401);
  return json({ ok: true });
}
