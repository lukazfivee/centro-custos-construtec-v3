const nodemailer = require('nodemailer');
const { getDb } = require('../db');

let cachedTransport = null;
let cachedKey = null;

async function getSmtpConfig() {
  const db = getDb();
  const result = await db.query("SELECT key, value FROM app_settings WHERE key LIKE 'smtp_%' OR key = 'bug_report_email'");
  const map = {};
  for (const row of result.rows) map[row.key] = row.value;
  return {
    host: map.smtp_host || process.env.SMTP_HOST || 'smtp.uol.com.br',
    port: Number(map.smtp_port || process.env.SMTP_PORT || 465),
    user: map.smtp_user || process.env.SMTP_USER || '',
    pass: map.smtp_pass || process.env.SMTP_PASS || '',
    from: map.smtp_from || process.env.SMTP_FROM || '',
    to: map.bug_report_email || process.env.BUG_REPORT_EMAIL || 'pcm@rcconstrutec.com.br',
  };
}

async function getTransport() {
  const cfg = await getSmtpConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) return null;
  const key = `${cfg.host}:${cfg.port}:${cfg.user}`;
  if (cachedKey === key && cachedTransport) return cachedTransport;
  const port = cfg.port || 465;
  cachedTransport = nodemailer.createTransport({
    host: cfg.host,
    port,
    secure: port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
    tls: { rejectUnauthorized: false },
    from: cfg.user,
  });
  cachedKey = key;
  return cachedTransport;
}

async function isConfigured() {
  const cfg = await getSmtpConfig();
  return !!(cfg.host && cfg.user && cfg.pass && cfg.to);
}

async function sendBugReport(report) {
  const transport = await getTransport();
  const cfg = await getSmtpConfig();
  if (!transport || !cfg.to) return false;

  const severidadeCor = { baixa: '#16835d', media: '#d89b26', alta: '#e67e22', critica: '#c44747' };
  const cor = severidadeCor[report.severidade] || '#657780';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#021d26;color:white;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">Report de Bug</h2>
        <p style="margin:4px 0 0;color:#8fa2ad;font-size:13px">${report.usuario_nome || 'Usuario desconhecido'} | ${report.instancia || 'Instalacao'}</p>
      </div>
      <div style="background:#f2f6f7;padding:20px;border:1px solid #d7e1e5;border-top:0">
        <table style="width:100%;font-size:14px;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#657780;width:120px">Titulo</td><td style="padding:6px 0;font-weight:700">${report.titulo}</td></tr>
          <tr><td style="padding:6px 0;color:#657780">Tipo</td><td style="padding:6px 0">${report.tipo}</td></tr>
          <tr><td style="padding:6px 0;color:#657780">Severidade</td><td style="padding:6px 0"><span style="background:${cor};color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:700">${report.severidade}</span></td></tr>
          <tr><td style="padding:6px 0;color:#657780">Data</td><td style="padding:6px 0">${new Date().toLocaleString('pt-BR')}</td></tr>
        </table>
        <hr style="border:none;border-top:1px solid #d7e1e5;margin:12px 0">
        <p style="margin:0;color:#657780;font-size:12px;text-transform:uppercase;font-weight:700">Descricao</p>
        <p style="margin:6px 0 0;font-size:14px;color:#102a33;white-space:pre-wrap">${report.descricao}</p>
        <hr style="border:none;border-top:1px solid #d7e1e5;margin:12px 0">
        <p style="margin:0;color:#999;font-size:11px">Para importar este report no Centro de Custos, copie o conteudo abaixo e cole na tela de Reports.</p>
        <pre style="background:#fff;padding:10px;border-radius:6px;font-size:11px;overflow-x:auto;border:1px solid #d7e1e5;margin-top:8px">---BUG_REPORT---
titulo: ${report.titulo}
tipo: ${report.tipo}
severidade: ${report.severidade}
descricao: ${report.descricao}
---FIM---</pre>
      </div>
    </div>`;

  await transport.sendMail({
    from: cfg.user,
    to: cfg.to,
    subject: `[Bug Report] ${report.severidade.toUpperCase()} - ${report.titulo}`,
    html,
  });
  return true;
}

async function sendTestEmail(to) {
  const transport = await getTransport();
  if (!transport) throw new Error('SMTP nao configurado. Preencha o e-mail e senha em Configuracoes.');
  const cfg = await getSmtpConfig();
  await transport.sendMail({
    from: cfg.user,
    to,
    subject: 'Centro de Custos - Teste de e-mail',
    html: '<p style="font-family:Arial,sans-serif">E-mail de teste enviado com sucesso! O sistema de reports esta funcionando.</p>',
  });
}

module.exports = { sendBugReport, sendTestEmail, isConfigured, getSmtpConfig };
