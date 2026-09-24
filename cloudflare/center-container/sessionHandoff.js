import { json, requireSession, sha256Text } from './centralAuth.js';

function code() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function issueHandoff(request, env) {
  const auth = await requireSession(request, env);
  if (auth.error) return json({ ok: false, code: 'SESSION_INVALID', error: auth.error }, auth.status);
  let body;
  try { body = await request.json(); } catch { body = null; }
  if (body?.target !== 'centro-custos') return json({ ok: false, code: 'TARGET_INVALID', error: 'Destino inválido.' }, 400);
  const value = code();
  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  await env.DB.prepare('INSERT INTO session_handoffs(code_hash,session_hash,user_id,expires_at) VALUES(?,?,?,?)')
    .bind(await sha256Text(value), auth.user.token_hash, auth.user.id, expiresAt).run();
  return json({ ok: true, code: value, expiresAt });
}

export async function consumeHandoff(request, env) {
  let body;
  try { body = await request.json(); } catch { body = null; }
  const value = String(body?.code || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return json({ ok: false, code: 'HANDOFF_INVALID', error: 'Código inválido.' }, 400);
  const hash = await sha256Text(value);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`SELECT h.code_hash FROM session_handoffs h
    JOIN cloud_sessions s ON s.token_hash=h.session_hash AND s.user_id=h.user_id
    JOIN cloud_users u ON u.id=h.user_id AND u.active=1 AND u.deleted_at IS NULL
    WHERE h.code_hash=? AND h.used_at IS NULL AND h.expires_at>? AND s.expires_at>?`)
    .bind(hash, now, now).first();
  if (!row) return json({ ok: false, code: 'HANDOFF_INVALID', error: 'Código inválido ou expirado.' }, 400);
  // O Worker não tem o ID do espelho PostgreSQL nem pode criar o JWT do Express.
  // Não consumir o código até existir uma ponte segura no Container.
  return json({ ok: false, code: 'SERVER_ERROR', error: 'Handoff web ainda indisponível.' }, 503);
}
