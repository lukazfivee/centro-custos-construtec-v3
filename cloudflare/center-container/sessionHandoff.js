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
  const row = await env.DB.prepare(`SELECT h.code_hash,u.id,u.name,u.email,u.role FROM session_handoffs h
    JOIN cloud_sessions s ON s.token_hash=h.session_hash AND s.user_id=h.user_id
    JOIN cloud_users u ON u.id=h.user_id AND u.active=1 AND u.deleted_at IS NULL
    WHERE h.code_hash=? AND h.used_at IS NULL AND h.expires_at>? AND s.expires_at>?`)
    .bind(hash, now, now).first();
  if (!row) return json({ ok: false, code: 'HANDOFF_INVALID', error: 'Código inválido ou expirado.' }, 400);
  if (String(env.SYNC_SHARED_KEY || '').length < 32 || !env.API) {
    return json({ ok: false, code: 'SERVER_ERROR', error: 'Handoff web indisponível.' }, 503);
  }
  const claimed = await env.DB.prepare(`UPDATE session_handoffs SET used_at=?
    WHERE code_hash=? AND used_at IS NULL AND expires_at>?
    AND EXISTS (SELECT 1 FROM cloud_sessions s WHERE s.token_hash=session_handoffs.session_hash AND s.expires_at>?)`)
    .bind(Date.now(), hash, now, now).run();
  if (!claimed.meta?.changes) return json({ ok: false, code: 'HANDOFF_INVALID', error: 'Código inválido ou expirado.' }, 400);
  const webToken = code();
  const sessionHash = await sha256Text(webToken);
  const nowIso = new Date().toISOString();
  const inserted = await env.DB.prepare(`INSERT INTO cloud_sessions(token_hash,user_id,org_id,instance_id,instance_name,created_at,expires_at,last_seen_at)
    SELECT ?,s.user_id,s.org_id,?,'Centro de Custos web',?,?,? FROM session_handoffs h
    JOIN cloud_sessions s ON s.token_hash=h.session_hash AND s.user_id=h.user_id
    WHERE h.code_hash=? AND s.expires_at>?`)
    .bind(sessionHash, crypto.randomUUID(), nowIso, now + 8 * 3600, nowIso, hash, now).run();
  if (!inserted.meta?.changes) return json({ ok: false, code: 'HANDOFF_INVALID', error: 'Código inválido ou expirado.' }, 400);
  try {
    const bridge = await env.API.getByName('production').fetch(new Request('https://container.internal/api/auth/handoff-bridge', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-key': env.SYNC_SHARED_KEY },
      body: JSON.stringify({ user: { id: row.id, name: row.name, email: row.email, role: row.role, active: true }, sessionHash }),
    }));
    const data = await bridge.json().catch(() => null);
    if (bridge.ok && data?.token && data?.usuario && data?.instancia) return json(data);
  } catch { /* A resposta pública não expõe detalhes da ponte. */ }
  await env.DB.prepare('DELETE FROM cloud_sessions WHERE token_hash=?').bind(sessionHash).run();
  return json({ ok: false, code: 'SERVER_ERROR', error: 'Handoff web indisponível.' }, 503);
}
