import { json, requireSession } from './centralAuth.js';

function unauthorized(auth) {
  return json({ ok: false, code: 'SESSION_INVALID', error: auth.error }, auth.status);
}

export async function listSessions(request, env) {
  const auth = await requireSession(request, env);
  if (auth.error) return unauthorized(auth);
  const rows = await env.DB.prepare(`SELECT token_hash,instance_name,created_at,last_seen_at
    FROM cloud_sessions WHERE user_id=? AND org_id=? AND expires_at>? ORDER BY created_at DESC`)
    .bind(auth.user.id, auth.user.org_id, Math.floor(Date.now() / 1000)).all();
  return json({ ok: true, sessions: (rows.results || []).map((row) => ({
    instanceName: row.instance_name || null,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    current: row.token_hash === auth.user.token_hash,
  })) });
}

export async function revokeOtherSessions(request, env) {
  const auth = await requireSession(request, env);
  if (auth.error) return unauthorized(auth);
  const result = await env.DB.prepare('DELETE FROM cloud_sessions WHERE user_id=? AND org_id=? AND token_hash<>?')
    .bind(auth.user.id, auth.user.org_id, auth.user.token_hash).run();
  return json({ ok: true, revoked: Number(result.meta?.changes || 0) });
}
