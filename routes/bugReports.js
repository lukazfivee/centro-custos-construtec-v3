const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');
const { deliverReport, flushPendingReports, refreshAcceptedReports, platformLabel } = require('../services/reportDelivery');
const logger = require('../lib/logger');
const { sanitizarDiagnostico, lerAnexo, colunas } = require('../lib/bugReportDados');

router.use(autenticar);

const VALID_TYPES = ['bug', 'melhoria', 'sugestao', 'duvida'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_SEVERITIES = ['baixa', 'media', 'alta', 'critica'];
const VALID_STATUSES = ['aberto', 'em andamento', 'resolvido', 'fechado'];

function validate(body) {
  const errors = [];
  if (!body.titulo || body.titulo.trim().length < 3) errors.push('Título é obrigatório (mínimo 3 caracteres).');
  if (!body.descricao || body.descricao.trim().length < 5) errors.push('Descrição é obrigatória (mínimo 5 caracteres).');
  if (body.titulo && body.titulo.trim().length > 200) errors.push('Título muito longo.');
  if (body.descricao && body.descricao.trim().length > 10000) errors.push('Descrição muito longa.');
  if (body.tela != null && String(body.tela).length > 120) errors.push('O campo "onde aconteceu" é muito longo.');
  if (body.client_id != null && !UUID.test(String(body.client_id))) errors.push('Identificador do envio inválido.');
  if (body.resposta != null && String(body.resposta).length > 5000) errors.push('Resposta muito longa.');
  if (body.tipo && !VALID_TYPES.includes(body.tipo)) errors.push('Tipo inválido.');
  if (body.severidade && !VALID_SEVERITIES.includes(body.severidade)) errors.push('Severidade inválida.');
  if (body.status && !VALID_STATUSES.includes(body.status)) errors.push('Status inválido.');
  if (errors.length) throw httpError(400, errors.join(' '));
}

const TEM_ANEXO = '(SELECT COUNT(*) > 0 FROM bug_report_anexos a WHERE a.report_id = b.id) AS tem_anexo';

// Lista: sem o diagnostico (so diz se tem). Detalhe: com o diagnostico.
function reportSelect(detalhe) {
  const extras = detalhe ? 'b.diagnostico IS NOT NULL AS tem_diagnostico, b.diagnostico' : 'b.diagnostico IS NOT NULL AS tem_diagnostico';
  return `
    SELECT ${colunas('b')}, ${extras}, ${TEM_ANEXO}, u.name AS author_name, u.email AS author_email
    FROM bug_reports b
    JOIN users u ON u.id = b.created_by
  `;
}

router.get('/', asyncRoute(async (req, res) => {
  const db = getDb();
  const limite = Math.min(Math.max(Number.parseInt(req.query.limite, 10) || 200, 1), 500);
  const isAdminOrGestor = ['admin', 'gestor'].includes(req.usuario.role);
  const result = isAdminOrGestor
    ? await db.query(`${reportSelect()} ORDER BY b.created_at DESC LIMIT $1`, [limite])
    : await db.query(`${reportSelect()} WHERE b.created_by = $1 ORDER BY b.created_at DESC LIMIT $2`, [req.usuario.id, limite]);
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
  const result = await db.query(`${reportSelect(true)} WHERE b.id = $1`, [id]);
  if (!result.rows[0]) throw httpError(404, 'Report não encontrado.');
  const report = result.rows[0];
  const isAdminOrGestor = ['admin', 'gestor'].includes(req.usuario.role);
  if (!isAdminOrGestor && report.created_by !== req.usuario.id) throw httpError(403, 'Sem permissão.');
  res.json(report);
}));

router.get('/:id/anexo', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const { rows } = await getDb().query(`
    SELECT b.created_by, a.nome, a.tipo, a.dados
    FROM bug_reports b JOIN bug_report_anexos a ON a.report_id = b.id
    WHERE b.id = $1
  `, [id]);
  if (!rows[0]) throw httpError(404, 'Este report não tem print.');
  const isAdminOrGestor = ['admin', 'gestor'].includes(req.usuario.role);
  if (!isAdminOrGestor && rows[0].created_by !== req.usuario.id) throw httpError(403, 'Sem permissão.');
  res.set({ 'Content-Type': rows[0].tipo, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="${rows[0].nome}"` });
  res.send(Buffer.from(rows[0].dados));
}));

router.post('/', asyncRoute(async (req, res) => {
  validate(req.body);
  const db = getDb();
  const diagnostico = sanitizarDiagnostico(req.body.diagnostico);
  if (diagnostico && !diagnostico.versao) diagnostico.versao = require('../package.json').version;
  const anexo = lerAnexo(req.body.anexo);
  // O navegador manda client_id: se a fila reenviar o mesmo report, ele nao duplica.
  const clientReportId = req.body.client_id ? String(req.body.client_id).toLowerCase() : crypto.randomUUID();
  if (req.body.client_id) {
    const dup = await db.query('SELECT id, created_by FROM bug_reports WHERE client_report_id = $1', [clientReportId]);
    if (dup.rows[0]) {
      if (dup.rows[0].created_by !== req.usuario.id) throw httpError(409, 'Este identificador de envio já foi usado.');
      const existente = await db.query(`${reportSelect()} WHERE b.id = $1`, [dup.rows[0].id]);
      return res.status(200).json({ ...existente.rows[0], delivery: { ok: null, status: existente.rows[0].delivery_status, queued: true, repetido: true } });
    }
  }
  const pkg = require('../package.json');
  const result = await db.query(`
    INSERT INTO bug_reports (
      titulo, descricao, tipo, severidade, created_by,
      client_report_id, delivery_status, app_version, platform, tela, diagnostico
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10::jsonb)
    RETURNING ${colunas()}
  `, [
    req.body.titulo.trim(),
    req.body.descricao.trim(),
    req.body.tipo || 'bug',
    req.body.severidade || 'media',
    req.usuario.id,
    clientReportId,
    pkg.version,
    platformLabel(),
    req.body.tela ? String(req.body.tela).trim() : null,
    diagnostico ? JSON.stringify(diagnostico) : null,
  ]);

  const report = result.rows[0];
  if (anexo) {
    await db.query('INSERT INTO bug_report_anexos (report_id, nome, tipo, tamanho, dados) VALUES ($1, $2, $3, $4, $5)', [report.id, anexo.nome, anexo.tipo, anexo.tamanho, anexo.buffer]);
    report.tem_anexo = true;
  }
  report.tem_anexo = Boolean(anexo);
  report.tem_diagnostico = Boolean(diagnostico);
  await recordAudit({
    entityType: 'bug_report',
    entityId: report.id,
    action: 'create',
    summary: `Report: ${report.titulo}`,
    user: req.usuario,
  });

  // Não bloqueia a resposta esperando a entrega central: o report já nasce
  // rastreável (delivery_status='pending') e o próprio services/reportDelivery.js
  // tem um ciclo de retry em segundo plano (ver startReportDelivery) que
  // processa a fila; GET /delivery/status e POST /:id/retry permitem
  // consultar/forçar o andamento depois.
  deliverReport(report.id).catch((error) => logger.warn('bug_report_delivery_dispatch_failed', { reportId: report.id, error }));

  res.status(201).json({
    ...report,
    delivery: {
      ok: null,
      status: report.delivery_status,
      centralReportId: report.central_report_id || null,
      queued: true,
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
  const existing = await db.query('SELECT id FROM bug_reports WHERE id = $1', [id]);
  if (!existing.rows[0]) throw httpError(404, 'Report não encontrado.');
  const allowedFields = {};
  if (req.body.status && VALID_STATUSES.includes(req.body.status)) allowedFields.status = req.body.status;
  if (req.body.severidade && VALID_SEVERITIES.includes(req.body.severidade)) allowedFields.severidade = req.body.severidade;
  if (typeof req.body.resposta === 'string' && req.body.resposta.trim()) {
    allowedFields.resposta_equipe = req.body.resposta.trim();
    allowedFields.respondido_em = new Date().toISOString();
  }
  if (Object.keys(allowedFields).length === 0) throw httpError(400, 'Nenhum campo para atualizar.');
  allowedFields.updated_at = new Date().toISOString();
  const keys = Object.keys(allowedFields);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => allowedFields[k]);
  values.push(id);
  const result = await db.query(`UPDATE bug_reports SET ${setClause} WHERE id = $${keys.length + 1} RETURNING ${colunas()}`, values);
  await recordAudit({ entityType: 'bug_report', entityId: id, action: 'update', summary: `Status → ${result.rows[0].status}`, user: req.usuario });
  res.json(result.rows[0]);
}));

router.delete('/:id', exigirPapel('admin'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const db = getDb();
  const existing = await db.query('SELECT id, titulo FROM bug_reports WHERE id = $1', [id]);
  if (!existing.rows[0]) throw httpError(404, 'Report não encontrado.');
  await db.query('DELETE FROM bug_reports WHERE id = $1', [id]);
  await recordAudit({ entityType: 'bug_report', entityId: id, action: 'delete', summary: `Report: ${existing.rows[0].titulo}`, user: req.usuario });
  res.json({ ok: true });
}));

module.exports = router;
