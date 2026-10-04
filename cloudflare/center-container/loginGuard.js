// Limites e acesso por app do login central (revisao de seguranca de 04/10/2026, A4 e M1).
// Contagem em D1 (tabela sync_rate_limits), por hora.

import { parseApps } from './suiteRoles.js';

export const LOGIN_IP_LIMIT = 60;
export const LOGIN_EMAIL_FAIL_LIMIT = 10;

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

// IP repassado pelo servidor (Orcamentos ou Container do Centro). So vale com a chave de servico
// valida (`service`); um cliente comum que envie o cabecalho e ignorado.
export function forwardedClientIp(request, service) {
  if (!service) return '';
  const value = String(request.headers.get('x-construtec-client-ip') || '').trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(value) ? value : '';
}

export function loginClientIp(request, service) {
  return forwardedClientIp(request, service) || request.headers.get('cf-connecting-ip') || 'unknown';
}

const emailBucket = (email) => {
  const hour = Math.floor(Date.now() / 1000 / 3600);
  return { bucket: `login-email:${String(email).slice(0, 254)}:${hour}`, expires: (hour + 2) * 3600 };
};

// Falhas de login por e-mail na hora corrente (so falhas contam: login correto nao gasta o limite).
export async function loginEmailBlocked(db, email) {
  const row = await db.prepare('SELECT count FROM sync_rate_limits WHERE bucket=?').bind(emailBucket(email).bucket).first();
  return Number(row?.count || 0) >= LOGIN_EMAIL_FAIL_LIMIT;
}

export async function noteLoginFailure(db, email) {
  const { bucket, expires } = emailBucket(email);
  await db.prepare(`INSERT INTO sync_rate_limits(bucket,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET count=count+1`).bind(bucket, expires).run();
}

// App que esta pedindo o login: o Centro (app e Container) ou o Orcamentos. O Orcamentos chega com a chave
// de servico e sem cabecalho de app; o Container do Centro usa a chave so para repassar o IP e se identifica.
export function loginApp(request, service) {
  return service && request.headers.get('x-construtec-app') !== 'centro' ? 'orcamentos' : 'centro';
}

// Ausencia de `apps` (conta antiga) vale como todos os apps (parseApps).
export function appAllowed(row, app) {
  return parseApps(row?.apps).includes(app);
}

export const APP_NAMES = { centro: 'Centro de Custos', orcamentos: 'Orçamentos' };
export function appDenied(app) {
  return { ok: false, code: 'APP_NOT_ALLOWED', error: `Sua conta não tem acesso ao ${APP_NAMES[app]}. Peça a um administrador para liberar.` };
}
