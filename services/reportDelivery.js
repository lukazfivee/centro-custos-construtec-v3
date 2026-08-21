const os = require('os');
const { getDb, getInstanceIdentity } = require('../db');
const logger = require('../lib/logger');

let retryTimer = null;
let flushing = false;

function reportApiUrl() {
  return String(process.env.REPORT_API_URL || '').trim().replace(/\/$/, '');
}

function reportIngestKey() {
  return String(process.env.REPORT_INGEST_KEY || '').trim();
}

function platformLabel() {
  return `${os.platform()} ${os.release()} ${os.arch()}`;
}

async function loadReport(id) {
  const { rows } = await getDb().query(`
    SELECT b.*, u.name AS author_name, u.email AS author_email
    FROM bug_reports b
    JOIN users u ON u.id = b.created_by
    WHERE b.id = $1
  `, [id]);
  return rows[0] || null;
}

function payloadFromReport(report) {
  const instance = getInstanceIdentity();
  return {
    clientReportId: report.client_report_id,
    title: report.titulo,
    description: report.descricao,
    type: report.tipo,
    severity: report.severidade,
    createdAt: report.created_at,
    user: {
      name: report.author_name,
      email: report.author_email,
    },
    installation: {
      id: instance.id,
      name: instance.name,
    },
    app: {
      version: report.app_version || require('../package.json').version,
      platform: report.platform || platformLabel(),
    },
  };
}

async function markAttempt(id) {
  await getDb().query(`
    UPDATE bug_reports
    SET delivery_attempts = COALESCE(delivery_attempts, 0) + 1,
        last_delivery_attempt_at = NOW(),
        delivery_status = 'sending'
    WHERE id = $1
  `, [id]);
}

async function markDelivered(id, centralReportId) {
  await getDb().query(`
    UPDATE bug_reports
    SET delivery_status = 'delivered',
        central_report_id = $2,
        delivered_at = NOW(),
        last_delivery_error = NULL,
        updated_at = NOW()
    WHERE id = $1
  `, [id, centralReportId || null]);
}

async function markPending(id, error) {
  await getDb().query(`
    UPDATE bug_reports
    SET delivery_status = 'pending',
        last_delivery_error = $2,
        updated_at = NOW()
    WHERE id = $1
  `, [id, String(error?.message || error || 'Falha desconhecida').slice(0, 1000)]);
}

async function deliverReport(id) {
  const report = await loadReport(id);
  if (!report) return { ok: false, status: 'missing' };
  if (report.delivery_status === 'delivered') {
    return { ok: true, status: 'delivered', reportId: report.central_report_id };
  }

  const baseUrl = reportApiUrl();
  if (!baseUrl) {
    await markPending(id, new Error('REPORT_API_URL não configurado.'));
    return { ok: false, status: 'pending', reason: 'not_configured' };
  }

  await markAttempt(id);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.REPORT_HTTP_TIMEOUT_MS || 12000));
    let response;
    try {
      response = await fetch(`${baseUrl}/v1/reports`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json',
          ...(reportIngestKey() ? { 'x-report-key': reportIngestKey() } : {}),
        },
        body: JSON.stringify(payloadFromReport(report)),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      throw new Error(body.error || `Servidor central respondeu HTTP ${response.status}.`);
    }

    await markDelivered(id, body.reportId || body.id || null);
    logger.info('report_delivered', { localReportId: id, centralReportId: body.reportId || body.id || null });
    return { ok: true, status: 'delivered', reportId: body.reportId || body.id || null };
  } catch (error) {
    await markPending(id, error);
    logger.warn('report_delivery_pending', { localReportId: id, error });
    return { ok: false, status: 'pending', reason: error.name === 'AbortError' ? 'timeout' : 'network' };
  }
}

async function flushPendingReports(limit = 20) {
  if (flushing) return { skipped: true };
  flushing = true;
  try {
    const { rows } = await getDb().query(`
      SELECT id
      FROM bug_reports
      WHERE delivery_status IN ('pending', 'sending')
      ORDER BY created_at ASC
      LIMIT $1
    `, [limit]);
    let delivered = 0;
    for (const item of rows) {
      const result = await deliverReport(item.id);
      if (result.ok) delivered += 1;
    }
    return { total: rows.length, delivered };
  } finally {
    flushing = false;
  }
}

function startReportDelivery() {
  if (retryTimer) return;
  const intervalMs = Math.max(60_000, Number(process.env.REPORT_RETRY_INTERVAL_MS || 5 * 60_000));
  retryTimer = setInterval(() => flushPendingReports().catch((error) => logger.warn('report_retry_failed', { error })), intervalMs);
  retryTimer.unref?.();
  setTimeout(() => flushPendingReports().catch(() => {}), 20_000).unref?.();
}

function stopReportDelivery() {
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = null;
}

module.exports = {
  deliverReport,
  flushPendingReports,
  startReportDelivery,
  stopReportDelivery,
  platformLabel,
};
