// Notificações da Suíte (Fase 4): o Worker central guarda a central e manda o
// push. O Container fala com ele pelas rotas internas, com SYNC_SHARED_KEY.
const logger = require('../lib/logger');

function configured() {
  return Boolean(process.env.SYNC_API_URL) && String(process.env.SYNC_SHARED_KEY || '').length >= 32;
}

async function workerCall(path, body) {
  if (!configured()) {
    const error = new Error('Notificações indisponíveis neste servidor.');
    error.status = 503;
    throw error;
  }
  const response = await fetch(`${String(process.env.SYNC_API_URL).replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sync-key': process.env.SYNC_SHARED_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Central de notificações respondeu HTTP ${response.status}.`);
    error.status = response.status === 404 ? 404 : 502;
    error.upstream = response.status;
    throw error;
  }
  return data;
}

// Aviso para todos com acesso ao Centro. Nunca derruba a operação que o gerou.
async function notifyAll(event) {
  if (!configured()) return;
  try { await workerCall('/v1/internal/notify', { ...event, audience: 'all' }); }
  catch (error) { logger.warn('notification_failed', { type: event.type, error }); }
}

// Ações da central (listar, marcar lidas, preferências, teste) da conta central do usuário.
function userAction(cloudUserId, action, extra = {}) {
  return workerCall('/v1/internal/notifications', { ...extra, action, userId: cloudUserId });
}

module.exports = { notifyAll, userAction, workerCall, notificationsConfigured: configured };
