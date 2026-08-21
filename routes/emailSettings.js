const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError } = require('../lib/http');
const { sendTestEmail, getSmtpConfig } = require('../services/email');

router.use(autenticar);

const SMTP_KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'bug_report_email'];

router.get('/', exigirPapel('admin'), asyncRoute(async (req, res) => {
  const db = getDb();
  const result = await db.query("SELECT key, value FROM app_settings WHERE key LIKE 'smtp_%' OR key = 'bug_report_email'");
  const settings = {};
  for (const row of result.rows) settings[row.key] = row.value;
  const configured = !!(settings.smtp_host && settings.smtp_user && settings.smtp_pass && settings.bug_report_email);
  res.json({ ...settings, configured });
}));

router.post('/', exigirPapel('admin'), asyncRoute(async (req, res) => {
  const db = getDb();
  for (const key of SMTP_KEYS) {
    if (req.body[key] !== undefined) {
      await db.query(
        'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        [key, String(req.body[key])]
      );
    }
  }
  res.json({ ok: true });
}));

router.post('/test', exigirPapel('admin'), asyncRoute(async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) throw httpError(400, 'E-mail invalido.');
  try {
    await sendTestEmail(email);
    res.json({ ok: true, mensagem: 'E-mail de teste enviado!' });
  } catch (err) {
    console.error('[EMAIL-TEST]', err);
    throw httpError(500, `Falha SMTP: ${err.message}`);
  }
}));

router.post('/import', asyncRoute(async (req, res) => {
  const { content } = req.body;
  if (!content) httpError(400, 'Conteudo vazio.');
  const match = content.match(/---BUG_REPORT---([\s\S]*?)---FIM---/);
  if (!match) httpError(400, 'Formato invalido. Use o bloco entre ---BUG_REPORT--- e ---FIM---.');
  const block = match[1];
  const get = (field) => {
    const m = block.match(new RegExp(`${field}:\\s*(.+)`));
    return m ? m[1].trim() : '';
  };
  const titulo = get('titulo');
  const tipo = get('tipo') || 'bug';
  const severidade = get('severidade') || 'media';
  const descricao = get('descricao');
  if (!titulo || !descricao) httpError(400, 'Titulo e descricao sao obrigatorios.');
  const db = getDb();
  const result = await db.query(
    'INSERT INTO bug_reports (titulo, descricao, tipo, severidade, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [titulo, descricao, tipo, severidade, req.usuario.id]
  );
  res.status(201).json(result.rows[0]);
}));

module.exports = router;
