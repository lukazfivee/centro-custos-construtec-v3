import { json, makePasswordRecord, sha256Text, text, validEmail } from './centralAuth.js';

const ACCEPTED = { ok: true };
const WINDOW = 15 * 60;
const RESET_TTL = 30 * 60;
const RESET_COOLDOWN = 60;

function error(code, message) { return json({ ok: false, code, error: message }, 400); }
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}
async function rateAllowed(db, kind, value, max, now) {
  const bucket = `${kind}:${await sha256Text(value)}`;
  await db.prepare(`INSERT INTO mobile_auth_limits(bucket,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`)
    .bind(bucket, now + WINDOW, now, now).run();
  const row = await db.prepare('SELECT count FROM mobile_auth_limits WHERE bucket=?').bind(bucket).first();
  return Number(row?.count || 0) <= max;
}
function strongPassword(password) {
  const checks = [password.length >= 8, /[A-Z]/.test(password), /\d/.test(password), /[^\p{L}\p{N}\s]/u.test(password)];
  return checks[0] && checks.filter(Boolean).length >= 3;
}
async function sendResetEmail(env, email, token) {
  if (!env.EMAIL_PROVIDER_API_KEY || !env.EMAIL_FROM) {
    console.info('password_reset_email_unconfigured');
    return;
  }
  const base = 'https://centro-custos-api.construtec-reports.workers.dev';
  const link = `${base}/redefinir-senha#t=${token}`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.EMAIL_PROVIDER_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM, to: [email], subject: 'Redefinir sua senha · Construtec',
        text: `Para criar uma senha nova, abra este link em até 30 minutos: ${link}\nSe você não pediu a redefinição, ignore esta mensagem.`,
      }),
    });
    if (!response.ok) console.warn('password_reset_email_delivery_failed', response.status);
  } catch { console.warn('password_reset_email_delivery_failed'); }
}

export async function requestPasswordReset(request, env) {
  const body = await readBody(request);
  const email = text(body?.email).toLowerCase();
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  const ipAllowed = await rateAllowed(env.DB, 'reset-ip', ip, 10, now);
  const emailAllowed = await rateAllowed(env.DB, 'reset-email', email, 3, now);
  if (!ipAllowed || !emailAllowed || !validEmail(email)) return json(ACCEPTED, 202);
  const user = await env.DB.prepare(`SELECT id,email FROM cloud_users
    WHERE org_id='rcconstrutec.com.br' AND email=? AND active=1 AND deleted_at IS NULL`)
    .bind(email).first();
  if (!user) return json(ACCEPTED, 202);
  const recent = await env.DB.prepare('SELECT created_at FROM password_reset_tokens WHERE user_id=? ORDER BY created_at DESC LIMIT 1')
    .bind(user.id).first();
  if (recent && Number(recent.created_at) > now - RESET_COOLDOWN) return json(ACCEPTED, 202);
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM password_reset_tokens WHERE user_id=?').bind(user.id),
    env.DB.prepare('INSERT INTO password_reset_tokens(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
      .bind(await sha256Text(token), user.id, now, now + RESET_TTL),
  ]);
  await sendResetEmail(env, email, token);
  return json(ACCEPTED, 202);
}

export async function confirmPasswordReset(request, env) {
  const body = await readBody(request);
  const token = String(body?.token || '');
  const password = String(body?.password || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return error('TOKEN_INVALID', 'Link inválido ou já utilizado.');
  const hash = await sha256Text(token);
  const row = await env.DB.prepare('SELECT user_id,expires_at,used_at FROM password_reset_tokens WHERE token_hash=?')
    .bind(hash).first();
  if (!row || row.used_at !== null) return error('TOKEN_INVALID', 'Link inválido ou já utilizado.');
  const now = Math.floor(Date.now() / 1000);
  if (Number(row.expires_at) <= now) return error('TOKEN_EXPIRED', 'O link expirou. Peça outro.');
  if (!strongPassword(password)) return error('WEAK_PASSWORD', 'A senha ainda está fraca.');
  const record = await makePasswordRecord(password);
  const claimed = await env.DB.prepare('UPDATE password_reset_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?')
    .bind(Date.now(), hash, now).run();
  if (!claimed.meta?.changes) return error('TOKEN_INVALID', 'Link inválido ou já utilizado.');
  const results = await env.DB.batch([
    env.DB.prepare('UPDATE cloud_users SET password_salt=?,password_hash=?,password_iterations=?,updated_at=? WHERE id=?')
      .bind(record.salt, record.hash, record.iterations, new Date().toISOString(), row.user_id),
    env.DB.prepare('DELETE FROM cloud_sessions WHERE user_id=?').bind(row.user_id),
  ]);
  return json({ ok: true, revokedSessions: Number(results[1]?.meta?.changes || 0) });
}
