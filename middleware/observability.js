const crypto = require('crypto');
const logger = require('../lib/logger');
const { beginRequest, finishRequest } = require('../lib/metrics');

function normalizeRequestId(value) {
  const candidate = String(value || '').trim();
  return /^[A-Za-z0-9._-]{8,80}$/.test(candidate) ? candidate : crypto.randomUUID();
}

function observability(req, res, next) {
  const started = process.hrtime.bigint();
  const requestId = normalizeRequestId(req.headers['x-request-id']);
  const slowMs = positiveEnv('SLOW_REQUEST_MS', 1000);
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');

  beginRequest(req.method);
  let completed = false;
  const complete = () => {
    if (completed) return;
    completed = true;
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const path = req.originalUrl ? req.originalUrl.split('?')[0] : req.path;
    finishRequest({
      method: req.method, path, statusCode: res.statusCode,
      durationMs, requestId, slowMs,
    });
    const details = {
      requestId, method: req.method, path,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      userId: req.usuario?.id,
    };
    if (res.statusCode >= 500) logger.error('http_request', details);
    else if (durationMs >= slowMs || res.statusCode >= 400) logger.warn('http_request', details);
    else if (!path.startsWith('/api/health')) logger.debug('http_request', details);
  };
  res.once('finish', complete);
  res.once('close', complete);
  next();
}

function positiveEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

module.exports = { observability, normalizeRequestId };
