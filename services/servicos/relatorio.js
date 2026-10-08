// Relatorio do servico para o cliente: 1 pagina em HTML pronta para imprimir ou salvar em PDF.
// Mostra o que foi feito, checklist, fotos, valor cobrado e o aceite. Nunca mostra gastos, resultado nem margem.
const { getDb } = require('../../db');
const { loadService, money, isoDate, seesMoney } = require('./core');

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (value) => money(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brDate = (value) => { const d = isoDate(value); return d ? d.split('-').reverse().join('/') : ''; };
const brDateTime = (value) => (value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '');
const dataUri = (mime, content) => `data:${mime};base64,${Buffer.from(content).toString('base64')}`;

const CSS = `@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#1d2433;font-size:12px;margin:0}
header{display:flex;justify-content:space-between;border-bottom:2px solid #1d2433;padding-bottom:8px;margin-bottom:12px}
h1{font-size:18px;margin:0}h2{font-size:13px;margin:14px 0 6px;text-transform:uppercase;letter-spacing:.04em}
dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:0}dt{color:#5b6475}dd{margin:0}
ul{margin:0;padding-left:18px}.fotos{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
figure{margin:0}figure img{width:100%;height:110px;object-fit:cover;border:1px solid #ccd}figcaption{font-size:10px;color:#5b6475}
.valor{font-size:16px;font-weight:bold}.aceite{display:flex;gap:16px;align-items:flex-end}.aceite img{height:70px;border-bottom:1px solid #1d2433}
@media print{.no-print{display:none}}`;

async function serviceReportHtml(id, user) {
  const db = getDb();
  const { center, job } = await loadService(db, id);
  const photos = (await db.query("SELECT phase,mime_type,content,caption FROM service_photos WHERE cost_center_id=$1 ORDER BY phase='depois',created_at,id LIMIT 8", [id])).rows;
  const signature = (await db.query('SELECT accept_signature FROM service_jobs WHERE cost_center_id=$1', [id])).rows[0]?.accept_signature;
  const showValue = await seesMoney(user);
  const valor = job.billing_amount != null ? job.billing_amount : center.contract_amount;
  const checklist = (Array.isArray(job.checklist) ? job.checklist : []).filter((i) => i.feito);
  const figures = photos.map((p) => `<figure><img src="${dataUri(p.mime_type, p.content)}" alt=""><figcaption>${p.phase === 'antes' ? 'Antes' : 'Depois'}${p.caption ? ` - ${esc(p.caption)}` : ''}</figcaption></figure>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório do serviço ${esc(center.code)}</title><style>${CSS}</style></head><body>
<header><div><h1>Relatório do serviço</h1><div>${esc(center.code)} - ${esc(center.name)}</div></div><div>RC Construtec</div></header>
<dl><dt>Cliente</dt><dd>${esc(center.client)}</dd><dt>Local</dt><dd>${esc(job.location)}</dd>
<dt>Data</dt><dd>${esc(brDate(center.start_date))}</dd><dt>Responsável</dt><dd>${esc(center.responsible)}</dd></dl>
<h2>O que foi feito</h2><p>${esc(center.description || 'Sem descrição.').replace(/\n/g, '<br>')}</p>
${checklist.length ? `<ul>${checklist.map((i) => `<li>${esc(i.texto)}</li>`).join('')}</ul>` : ''}
${figures ? `<h2>Fotos</h2><div class="fotos">${figures}</div>` : ''}
${showValue ? `<h2>Valor</h2><div class="valor">${esc(brl(valor))}</div>` : ''}
<h2>Aceite do cliente</h2>${signature ? `<div class="aceite"><img src="${dataUri('image/png', signature)}" alt="Assinatura">
<dl><dt>Nome</dt><dd>${esc(job.accept_name)}</dd><dt>Cargo</dt><dd>${esc(job.accept_role)}</dd><dt>Data e hora</dt><dd>${esc(brDateTime(job.accept_at))}</dd></dl></div>` : '<p>Aceite ainda não registrado.</p>'}
</body></html>`;
}

module.exports = { serviceReportHtml };
