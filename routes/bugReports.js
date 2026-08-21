const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');
const { sendBugReport } = require('../services/email');

router.use(autenticar);

const VALID_TYPES = ['bug', 'melhoria', 'sugestao'];
const VALID_SEVERITIES = ['baixa', 'media', 'alta', 'critica'];
const VALID_STATUSES = ['aberto', 'em andamento', 'resolvido', 'fechado'];

function validate(body) {
  const errors = [];
  if (!body.titulo || body.titulo.trim().length < 3) errors.push('Título é obrigatório (mínimo 3 caracteres).');
  if (!body.descricao || body.descricao.trim().length < 5) errors.push('Descrição é obrigatória (mínimo 5 caracteres).');
  if (body.tipo && !VALID_TYPES.includes(body.tipo)) errors.push('Tipo inválido.');
  if (body.severidade && !VALID_SEVERITIES.includes(body.severidade)) errors.push('Severidade inválida.');
  if (body.status && !VALID_STATUSES.includes(body.status)) errors.push('Status inválida.');
  if (errors.length) httpError(400, errors.join(' '));
}

router.get('/', asyncRoute(async (req, res) => {
  const db = getDb();
  const isAdminOrGestor = ['admin', 'gestor'].includes(req.usuario.role);
  let rows;
  if (isAdminOrGestor) {
    const result = await db.query(`
      SELECT b.*, u.name AS author_name
      FROM bug_reports b
      JOIN users u ON u.id = b.created_by
      ORDER BY b.created_at DESC
    `);
    rows = result.rows;
  } else {
    const result = await db.query(`
      SELECT b.*, u.name AS author_name
      FROM bug_reports b
      JOIN users u ON u.id = b.created_by
      WHERE b.created_by = $1
      ORDER BY b.created_at DESC
    `, [req.usuario.id]);
    rows = result.rows;
  }
  res.json(rows);
}));

router.get('/:id', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const db = getDb();
  const result = await db.query(`
    SELECT b.*, u.name AS author_name
    FROM bug_reports b
    JOIN users u ON u.id = b.created_by
    WHERE b.id = $1
  `, [id]);
  if (!result.rows[0]) httpError(404, 'Report não encontrado.');
  const report = result.rows[0];
  const isAdminOrGestor = ['admin', 'gestor'].includes(req.usuario.role);
  if (!isAdminOrGestor && report.created_by !== req.usuario.id) httpError(403, 'Sem permissão.');
  res.json(report);
}));

router.post('/', asyncRoute(async (req, res) => {
  validate(req.body);
  const db = getDb();
  const result = await db.query(`
    INSERT INTO bug_reports (titulo, descricao, tipo, severidade, created_by)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [
    req.body.titulo.trim(),
    req.body.descricao.trim(),
    req.body.tipo || 'bug',
    req.body.severidade || 'media',
    req.usuario.id
  ]);
  const report = result.rows[0];
  await recordAudit({ entityType: 'bug_report', entityId: report.id, action: 'create', summary: `Report: ${report.titulo}`, user: req.usuario });
  sendBugReport({ ...report, usuario_nome: req.usuario.name, instancia: process.env.INSTANCE_NAME || '' }).catch((err) => console.error('[EMAIL] Falha ao enviar report:', err.message));
  res.status(201).json(report);
}));

router.put('/:id', exigirPapel('admin', 'gestor'), asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const db = getDb();
  const existing = await db.query('SELECT * FROM bug_reports WHERE id = $1', [id]);
  if (!existing.rows[0]) httpError(404, 'Report não encontrado.');
  const allowedFields = {};
  if (req.body.status && VALID_STATUSES.includes(req.body.status)) allowedFields.status = req.body.status;
  if (req.body.severidade && VALID_SEVERITIES.includes(req.body.severidade)) allowedFields.severidade = req.body.severidade;
  if (Object.keys(allowedFields).length === 0) httpError(400, 'Nenhum campo para atualizar.');
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
  if (!existing.rows[0]) httpError(404, 'Report não encontrado.');
  await db.query('DELETE FROM bug_reports WHERE id = $1', [id]);
  await recordAudit({ entityType: 'bug_report', entityId: id, action: 'delete', summary: `Report: ${existing.rows[0].titulo}`, user: req.usuario });
  res.json({ ok: true });
}));

module.exports = router;
