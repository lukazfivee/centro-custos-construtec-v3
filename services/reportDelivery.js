const os = require('os');
const { getDb, getInstanceIdentity } = require('../db');
const logger = require('../lib/logger');

let retryTimer = null;
let flushing = false;

function reportApiUrl() { return String(process.env.REPORT_API_URL || '').trim().replace(/\/$/, ''); }
function reportIngestKey() { return String(process.env.REPORT_INGEST_KEY || '').trim(); }
function requestHeaders(json = false) {
  return { accept: 'application/json', ...(json ? { 'content-type': 'application/json' } : {}), ...(reportIngestKey() ? { 'x-report-key': reportIngestKey() } : {}) };
}
function platformLabel() { return `${os.platform()} ${os.release()} ${os.arch()}`; }

async function loadReport(id) {
  const { rows } = await getDb().query(`SELECT b.*,u.name AS author_name,u.email AS author_email FROM bug_reports b JOIN users u ON u.id=b.created_by WHERE b.id=$1`, [id]);
  return rows[0] || null;
}

function payloadFromReport(report) {
  const instance = getInstanceIdentity();
  return {
    clientReportId: report.client_report_id, title: report.titulo, description: report.descricao,
    type: report.tipo, severity: report.severidade, createdAt: report.created_at,
    user: { name: report.author_name, email: report.author_email },
    installation: { id: instance.id, name: instance.name },
    app: { version: report.app_version || require('../package.json').version, platform: report.platform || platformLabel() },
  };
}

async function markAttempt(id) {
  await getDb().query(`UPDATE bug_reports SET delivery_attempts=COALESCE(delivery_attempts,0)+1,last_delivery_attempt_at=NOW(),delivery_status='sending' WHERE id=$1`, [id]);
}

async function markStatus(id, status, centralReportId, error = null) {
  await getDb().query(`UPDATE bug_reports SET delivery_status=$2::varchar,central_report_id=COALESCE($3,central_report_id),delivered_at=CASE WHEN $2::varchar='delivered' THEN NOW() ELSE delivered_at END,last_delivery_error=$4,updated_at=NOW() WHERE id=$1`, [id, status, centralReportId || null, error ? String(error).slice(0, 1000) : null]);
}

async function markPending(id, error) { await markStatus(id, 'pending', null, error?.message || error || 'Falha desconhecida'); }
function localStatus(emailStatus) { return emailStatus === 'delivered' ? 'delivered' : emailStatus === 'failed' ? 'failed' : 'accepted'; }

async function refreshReportStatus(id) {
  const report = await loadReport(id);
  if (!report) return { ok: false, status: 'missing' };
  if (report.delivery_status === 'delivered') return { ok: true, status: 'delivered', reportId: report.central_report_id };
  if (!report.client_report_id || !reportApiUrl()) return { ok: false, status: report.delivery_status };
  try {
    const response = await fetch(`${reportApiUrl()}/v1/reports/${encodeURIComponent(report.client_report_id)}/status`, { headers: requestHeaders() });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || `Servidor central respondeu HTTP ${response.status}.`);
    const status = localStatus(body.emailStatus);
    await markStatus(id, status, body.reportId || report.central_report_id, body.emailError || null);
    return { ok: status !== 'failed', status, reportId: body.reportId || report.central_report_id };
  } catch (error) {
    logger.warn('report_status_refresh_failed', { localReportId: id, error });
    return { ok: false, status: report.delivery_status, reason: 'network' };
  }
}

async function deliverReport(id) {
  const report = await loadReport(id);
  if (!report) return { ok: false, status: 'missing' };
  if (report.delivery_status === 'delivered') return { ok: true, status: 'delivered', reportId: report.central_report_id };
  if (report.delivery_status === 'accepted') return refreshReportStatus(id);
  const baseUrl = reportApiUrl();
  if (!baseUrl) { await markPending(id, new Error('REPORT_API_URL não configurado.')); return { ok: false, status: 'pending', reason: 'not_configured' }; }

  await markAttempt(id);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.REPORT_HTTP_TIMEOUT_MS || 12000));
    let response;
    try {
      response = await fetch(`${baseUrl}/v1/reports`, { method: 'POST', headers: requestHeaders(true), body: JSON.stringify(payloadFromReport(report)), signal: controller.signal });
    } finally { clearTimeout(timeout); }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || `Servidor central respondeu HTTP ${response.status}.`);
    const status = localStatus(body.emailStatus);
    await markStatus(id, status, body.reportId || body.id || null, body.emailError || null);
    logger.info('report_central_accepted', { localReportId: id, centralReportId: body.reportId || body.id || null, status });
    return { ok: status !== 'failed', status, reportId: body.reportId || body.id || null };
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
    const { rows } = await getDb().query(`SELECT id FROM bug_reports WHERE delivery_status IN ('pending','sending') ORDER BY created_at ASC LIMIT $1`, [limit]);
    let processed = 0;
    for (const item of rows) if ((await deliverReport(item.id)).ok) processed += 1;
    return { total: rows.length, processed, delivered: processed };
  } finally { flushing = false; }
}

async function refreshAcceptedReports(limit = 20) {
  const { rows } = await getDb().query(`SELECT id FROM bug_reports WHERE delivery_status='accepted' ORDER BY created_at ASC LIMIT $1`, [limit]);
  let delivered = 0; let failed = 0;
  for (const item of rows) {
    const result = await refreshReportStatus(item.id);
    if (result.status === 'delivered') delivered += 1;
    if (result.status === 'failed') failed += 1;
  }
  return { total: rows.length, delivered, failed };
}

async function runDeliveryCycle() { await flushPendingReports(); return refreshAcceptedReports(); }
function startReportDelivery() {
  if (retryTimer) return;
  const intervalMs = Math.max(60_000, Number(process.env.REPORT_RETRY_INTERVAL_MS || 5 * 60_000));
  retryTimer = setInterval(() => runDeliveryCycle().catch((error) => logger.warn('report_retry_failed', { error })), intervalMs);
  retryTimer.unref?.();
  setTimeout(() => runDeliveryCycle().catch(() => {}), 20_000).unref?.();
}
function stopReportDelivery() { if (retryTimer) clearInterval(retryTimer); retryTimer = null; }

module.exports = { deliverReport, flushPendingReports, refreshReportStatus, refreshAcceptedReports, startReportDelivery, stopReportDelivery, platformLabel };
