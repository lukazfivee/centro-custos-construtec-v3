const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');
const { deliverReport, flushPendingReports, refreshAcceptedReports, platformLabel } = require('../services/reportDelivery');

router.use(autenticar);

const VALID_TYPES = ['bug', 'melhoria', 'sugestao'];
const VALID_SEVERITIES = ['baixa', 'media', 'alta', 'critica'];
const VALID_STATUSES = ['aberto', 'em andamento', 'resolvido', 'fechado'];

function validate(body) {
  const errors = [];
  if (!body.titulo || body.titulo.trim().length < 3) errors.push('Título é obrigatório (mínimo 3 caracteres).');
  if (!body.descricao || body.descricao.trim().length < 5) errors.push('Descrição é obrigatória (mínimo 5 caracteres).');
  if (body.titulo && body.titulo.trim().length > 200) errors.push('Título muito longo.');
  if (body.descricao && body.descricao.trim().length > 10000) errors.push('Descrição muito longa.');
  if (body.tipo && !VALID_TYPES.includes(body.tipo)) errors.push('Tipo inválido.');
  if (body.severidade && !VALID_SEVERITIES.includes(body.severidade)) errors.push('Severidade inválida.');
  if (body.status && !VALID_STATUSES.includes(body.status)) errors.push('Status inválido.');
  if (errors.length) throw httpError(400, errors.join(' '));
}

function reportSelect() {
  return `
    SELECT b.*, u.name AS author_name, u.email AS author_email
    FROM bug_reports b
    JOIN users u ON u.id = b.created_by
  `;
}

router.get('/', asyncRoute(async (req, res) => {
  const db = getDb();
  const isAdminOrGestor = ['admin', 'gestor'].includes(req.usuario.role);
  const result = isAdminOrGestor
    ? await db.query(`${reportSelect()} ORDER BY b.created_at DESC`)
    : await db.query(`${reportSelect()} WHERE b.created_by = $1 ORDER BY b.created_at DESC`, [req.usuario.id]);
  res.json(result.rows);
}));

router.get('/delivery/status', asyncRoute(async (req, res) => {
  const { rows } = await getDb().query(`
    SELECT
      COUNT(*) FILTER (WHERE delivery_status = 'delivered')::int AS delivered,
      COUNT(*) FILTER (WHERE delivery_status = 'accepted')::int AS accepted,
      COUNT(*) FILTER (WHERE delivery_status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE delivery_status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE delivery_status = 'sending')::int AS sending
    FROM bug_reports
    WHERE created_by = $1
  `, [req.usuario.id]);
  res.json({
    ...rows[0],
    configured: Boolean(process.env.REPORT_API_URL),
    endpoint: process.env.REPORT_API_URL ? 'central' : 'not-configured',
  });
}));

router.post('/delivery/retry', asyncRoute(async (req, res) => {
  const pending = await flushPendingReports(30);
  const accepted = await refreshAcceptedReports(30);
  res.json({ ok: true, pending, accepted, delivered: pending.delivered + accepted.delivered });
}));

router.get('/:id', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const db = getDb();
  const result = await db.query(`${reportSelect()} WHERE b.id = $1`, [id]);
  if (!result.rows[0]) throw httpError(404, 'Report não encontrado.');
  const report = result.rows[0];
  const isAdminOrGestor = ['admin', 'gestor'].includes(req.usuario.role);
  if (!isAdminOrGestor && report.created_by !== req.usuario.id) throw httpError(403, 'Sem permissão.');
  res.json(report);
}));

router.post('/', asyncRoute(async (req, res) => {
  validate(req.body);
  const db = getDb();
  const clientReportId = crypto.randomUUID();
  const pkg = require('../package.json');
  const result = await db.query(`
    INSERT INTO bug_reports (
      titulo, descricao, tipo, severidade, created_by,
      client_report_id, delivery_status, app_version, platform
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
    RETURNING *
  `, [
    req.body.titulo.trim(),
    req.body.descricao.trim(),
    req.body.tipo || 'bug',
    req.body.severidade || 'media',
    req.usuario.id,
    clientReportId,
    pkg.version,
    platformLabel(),
  ]);

  const report = result.rows[0];
  await recordAudit({
    entityType: 'bug_report',
    entityId: report.id,
    action: 'create',
    summary: `Report: ${report.titulo}`,
    user: req.usuario,
  });

  const delivery = await deliverReport(report.id);
  const refreshed = (await db.query(`${reportSelect()} WHERE b.id = $1`, [report.id])).rows[0];

  res.status(201).json({
    ...refreshed,
    delivery: {
      ok: delivery.ok,
      status: refreshed.delivery_status,
      centralReportId: refreshed.central_report_id || null,
      queued: refreshed.delivery_status !== 'delivered',
    },
  });
}));

router.post('/:id/retry', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const existing = await getDb().query('SELECT id, created_by FROM bug_reports WHERE id = $1', [id]);
  if (!existing.rows[0]) throw httpError(404, 'Report não encontrado.');
  const isAdminOrGestor = ['admin', 'gestor'].includes(req.usuario.role);
  if (!isAdminOrGestor && existing.rows[0].created_by !== req.usuario.id) throw httpError(403, 'Sem permissão.');
  const delivery = await deliverReport(id);
  res.json(delivery);
}));

router.put('/:id', exigirPapel('admin', 'gestor'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const db = getDb();
  const existing = await db.query('SELECT * FROM bug_reports WHERE id = $1', [id]);
  if (!existing.rows[0]) throw httpError(404, 'Report não encontrado.');
  const allowedFields = {};
  if (req.body.status && VALID_STATUSES.includes(req.body.status)) allowedFields.status = req.body.status;
  if (req.body.severidade && VALID_SEVERITIES.includes(req.body.severidade)) allowedFields.severidade = req.body.severidade;
  if (Object.keys(allowedFields).length === 0) throw httpError(400, 'Nenhum campo para atualizar.');
  allowedFields.updated_at = new Date().toISOString();
  const keys = Object.keys(allowedFields);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => allowedFields[k]);
  values.push(id);
  const result = await db.query(`UPDATE bug_reports SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`, values);
  await recordAudit({ entityType: 'bug_report', entityId: id, action: 'update', summary: `Status → ${result.rows[0].status}`, user: req.usuario });
  res.json(result.rows[0]);
}));

router.delete('/:id', exigirPapel('admin'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const db = getDb();
  const existing = await db.query('SELECT * FROM bug_reports WHERE id = $1', [id]);
  if (!existing.rows[0]) throw httpError(404, 'Report não encontrado.');
  await db.query('DELETE FROM bug_reports WHERE id = $1', [id]);
  await recordAudit({ entityType: 'bug_report', entityId: id, action: 'delete', summary: `Report: ${existing.rows[0].titulo}`, user: req.usuario });
  res.json({ ok: true });
}));

module.exports = router;
