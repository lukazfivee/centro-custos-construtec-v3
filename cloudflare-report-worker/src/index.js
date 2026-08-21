function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function text(value) {
  return String(value ?? '').trim();
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function makeReportId() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `RPT-${y}${m}${d}-${suffix}`;
}

function validateReport(body) {
  const errors = [];
  const type = text(body.type);
  const severity = text(body.severity);
  if (!text(body.clientReportId)) errors.push('clientReportId ausente');
  if (text(body.title).length < 3 || text(body.title).length > 200) errors.push('titulo invalido');
  if (text(body.description).length < 5 || text(body.description).length > 10000) errors.push('descricao invalida');
  if (!['bug', 'melhoria', 'sugestao'].includes(type)) errors.push('tipo invalido');
  if (!['baixa', 'media', 'alta', 'critica'].includes(severity)) errors.push('severidade invalida');
  if (!text(body.user?.name) || !validEmail(body.user?.email)) errors.push('usuario invalido');
  if (!text(body.installation?.id) || !text(body.installation?.name)) errors.push('instalacao invalida');
  return errors;
}

async function consumeRate(db, ip) {
  const now = Math.floor(Date.now() / 1000);
  const hour = Math.floor(now / 3600);
  const bucket = `${ip || 'unknown'}:${hour}`;
  const existing = await db.prepare('SELECT count, expires_at FROM report_rate_limits WHERE bucket = ?').bind(bucket).first();
  if (!existing) {
    await db.prepare('INSERT INTO report_rate_limits(bucket,count,expires_at) VALUES(?,?,?)').bind(bucket, 1, (hour + 2) * 3600).run();
    return true;
  }
  if (Number(existing.count) >= 20) return false;
  await db.prepare('UPDATE report_rate_limits SET count = count + 1 WHERE bucket = ?').bind(bucket).run();
  if (Math.random() < 0.02) {
    await db.prepare('DELETE FROM report_rate_limits WHERE expires_at < ?').bind(now).run();
  }
  return true;
}

async function sendEmail(env, report) {
  if (!env.RESEND_API_KEY || !env.REPORT_FROM) {
    throw new Error('Resend nao configurado no Worker.');
  }
  const to = env.REPORT_TO || 'pcm@rcconstrutec.com.br';
  const subject = `[Report ${report.report_id}] ${report.severity.toUpperCase()} - ${report.title}`;
  const plain = [
    `Report: ${report.report_id}`,
    `Titulo: ${report.title}`,
    `Tipo: ${report.type}`,
    `Prioridade: ${report.severity}`,
    `Usuario: ${report.user_name} <${report.user_email}>`,
    `Instalacao: ${report.installation_name} (${report.installation_id})`,
    `Versao: ${report.app_version || '-'}`,
    `Plataforma: ${report.platform || '-'}`,
    `Data: ${report.created_at}`,
    '',
    report.description,
  ].join('\n');

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f7;color:#102a33;margin:0;padding:24px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden">
  <tr><td style="background:#021d26;padding:20px;color:#ffffff"><div style="font-size:20px;font-weight:700">Novo report do Centro de Custos</div><div style="font-size:13px;margin-top:6px;color:#c7d2d7">${esc(report.report_id)}</div></td></tr>
  <tr><td style="padding:20px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;line-height:1.5">
  <tr><td style="padding:5px 0;color:#657780;width:130px">Titulo</td><td style="padding:5px 0;font-weight:700">${esc(report.title)}</td></tr>
  <tr><td style="padding:5px 0;color:#657780">Tipo</td><td style="padding:5px 0">${esc(report.type)}</td></tr>
  <tr><td style="padding:5px 0;color:#657780">Prioridade</td><td style="padding:5px 0">${esc(report.severity)}</td></tr>
  <tr><td style="padding:5px 0;color:#657780">Usuario</td><td style="padding:5px 0">${esc(report.user_name)} &lt;${esc(report.user_email)}&gt;</td></tr>
  <tr><td style="padding:5px 0;color:#657780">Instalacao</td><td style="padding:5px 0">${esc(report.installation_name)}</td></tr>
  <tr><td style="padding:5px 0;color:#657780">Versao</td><td style="padding:5px 0">${esc(report.app_version || '-')}</td></tr>
  <tr><td style="padding:5px 0;color:#657780">Plataforma</td><td style="padding:5px 0">${esc(report.platform || '-')}</td></tr>
  <tr><td style="padding:5px 0;color:#657780">Data</td><td style="padding:5px 0">${esc(report.created_at)}</td></tr>
  </table>
  <hr style="border:0;border-top:1px solid #dde5e8;margin:16px 0">
  <div style="font-size:12px;color:#657780;font-weight:700;text-transform:uppercase">Descricao</div>
  <div style="font-size:14px;line-height:1.6;margin-top:8px;white-space:pre-wrap">${esc(report.description)}</div>
  </td></tr></table></td></tr></table></body></html>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.REPORT_FROM,
      to: [to],
      reply_to: report.user_email,
      subject,
      text: plain,
      html,
      tags: [
        { name: 'system', value: 'centro-custos' },
        { name: 'type', value: report.type },
        { name: 'severity', value: report.severity },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Resend HTTP ${response.status}`);
  return data.id || null;
}

async function upsertAndSend(env, body, ip) {
  const existing = await env.DB.prepare('SELECT * FROM reports WHERE client_report_id = ?').bind(body.clientReportId).first();
  let report = existing;
  if (!report) {
    const now = new Date().toISOString();
    const reportId = makeReportId();
    await env.DB.prepare(`
      INSERT INTO reports(
        report_id, client_report_id, title, description, type, severity,
        user_name, user_email, installation_id, installation_name,
        app_version, platform, source_ip, email_status, created_at, updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)
    `).bind(
      reportId, body.clientReportId, text(body.title), text(body.description), text(body.type), text(body.severity),
      text(body.user.name), text(body.user.email), text(body.installation.id), text(body.installation.name),
      text(body.app?.version), text(body.app?.platform), ip || '', body.createdAt || now, now
    ).run();
    report = await env.DB.prepare('SELECT * FROM reports WHERE client_report_id = ?').bind(body.clientReportId).first();
  }

  if (report.email_status === 'sent') {
    return { reportId: report.report_id, emailStatus: 'sent', duplicate: true };
  }

  try {
    const emailId = await sendEmail(env, report);
    await env.DB.prepare(`UPDATE reports SET email_status='sent',email_id=?,email_error=NULL,emailed_at=?,updated_at=? WHERE id=?`)
      .bind(emailId, new Date().toISOString(), new Date().toISOString(), report.id).run();
    return { reportId: report.report_id, emailStatus: 'sent', duplicate: Boolean(existing) };
  } catch (error) {
    await env.DB.prepare(`UPDATE reports SET email_status='failed',email_error=?,updated_at=? WHERE id=?`)
      .bind(String(error.message || error).slice(0, 1000), new Date().toISOString(), report.id).run();
    throw error;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'centro-custos-reports' });
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/reports') {
      return json({ ok: false, error: 'not_found' }, 404);
    }

    const length = Number(request.headers.get('content-length') || 0);
    if (length > 32768) return json({ ok: false, error: 'payload_too_large' }, 413);

    if (env.REPORT_INGEST_KEY) {
      const supplied = request.headers.get('x-report-key') || '';
      if (supplied !== env.REPORT_INGEST_KEY) return json({ ok: false, error: 'unauthorized' }, 401);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!(await consumeRate(env.DB, ip))) return json({ ok: false, error: 'rate_limited' }, 429);

    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: 'invalid_json' }, 400); }

    const errors = validateReport(body);
    if (errors.length) return json({ ok: false, error: errors.join(', ') }, 400);

    try {
      const result = await upsertAndSend(env, body, ip);
      return json({ ok: true, ...result });
    } catch (error) {
      return json({ ok: false, error: String(error.message || error).slice(0, 500) }, 502);
    }
  },
};
