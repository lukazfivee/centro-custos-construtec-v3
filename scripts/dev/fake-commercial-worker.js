// Worker comercial de mentira, em memoria, so para testar Cobrancas sem a nuvem e SEM enviar e-mail.
// Reproduz as regras de cloudflare/center-container/commercialSync.js: acompanhamento com padroes,
// rascunho que zera a autorizacao ao salvar, envio so de rascunho autorizado. O envio apenas registra.
// Uso: const w = await iniciar({ obras: [...] }); process.env.SYNC_API_URL = w.url; w.enviados -> lista.
const http = require('http');

const STATUS_OP = ['em_execucao', 'finalizada', 'entregue'];
const STATUS_FIN = ['a_faturar', 'nf_emitida', 'enviada', 'aguardando_pagamento', 'pago'];

function padrao(o) {
  return { operationalStatus: o.projectStatus === 'concluido' ? 'finalizada' : 'em_execucao', financialStatus: 'a_faturar', clientName: o.client || '', clientEmails: [], responsible: o.responsible || '', invoiceNumber: '', contractAmount: Number(o.contractAmount || 0), receivableAmount: Number(o.contractAmount || 0), completionDate: o.endDate || null, dueDate: null, notes: '' };
}

async function iniciar({ obras = [], clientes = [] } = {}) {
  const estado = { followups: new Map(), excluidas: new Map(), drafts: new Map(), enviados: [], clientes: clientes.slice() };
  const linha = (o) => ({ publicId: o.publicId, code: o.code, name: o.name, client: o.client, ...padrao(o), ...(estado.followups.get(o.publicId) || {}), updatedByEmail: null, updatedAt: null });
  const draftPadrao = (o) => { const f = linha(o); return { to: f.clientEmails, cc: [], subject: `Acompanhamento financeiro — ${o.code} ${o.name}`.trim(), bodyText: `Prezados,

Entramos em contato para acompanhamento financeiro da obra/serviço ${o.code} — ${o.name}.

Valor em aberto: ${Number(f.receivableAmount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}${f.dueDate ? `
Vencimento: ${f.dueDate}` : ''}.

Permanecemos à disposição para qualquer esclarecimento.

Atenciosamente,
Construtec Engenharia`, status: 'draft' }; };

  const server = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const body = corpo ? JSON.parse(corpo) : {};
      const enviar = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
      const obra = (id) => obras.find((o) => o.publicId === id);
      const p = url.pathname;
      if (req.method === 'GET' && p === '/v1/client-followups') {
        const so = url.searchParams.get('excluidas') === '1';
        const items = obras.filter((o) => estado.excluidas.has(o.publicId) === so).map((o) => ({ ...linha(o), ...(estado.excluidas.get(o.publicId) || {}) }));
        return enviar(200, { ok: true, items, summary: { finalizadas: items.filter((i) => i.operationalStatus === 'finalizada').length, totalReceber: items.filter((i) => i.financialStatus !== 'pago').reduce((s, i) => s + i.receivableAmount, 0) } });
      }
      const ex = p.match(/^\/v1\/client-followups\/([^/]+)\/(delete|restore)$/);
      if (req.method === 'POST' && ex) {
        if (!obra(ex[1])) return enviar(404, { ok: false, error: 'Centro de custo nao encontrado.' });
        const ja = estado.excluidas.has(ex[1]);
        if (ex[2] === 'delete') {
          if (ja) return enviar(409, { ok: false, error: 'Esta cobranca ja foi excluida.' });
          estado.excluidas.set(ex[1], { deletedAt: new Date().toISOString(), deletedByEmail: 'gestor@rcconstrutec.com.br', deletedReason: String(body.motivo || '') });
          return enviar(200, { ok: true, deletedAt: estado.excluidas.get(ex[1]).deletedAt });
        }
        if (!ja) return enviar(409, { ok: false, error: 'Esta cobranca nao esta excluida.' });
        estado.excluidas.delete(ex[1]);
        return enviar(200, { ok: true });
      }
      let m = p.match(/^\/v1\/client-followups\/([^/]+)$/);
      if (req.method === 'PUT' && m) {
        if (!obra(m[1])) return enviar(404, { ok: false, error: 'Centro de custo nao encontrado.' });
        if (!STATUS_OP.includes(body.operationalStatus) || !STATUS_FIN.includes(body.financialStatus)) return enviar(400, { ok: false, error: 'Status invalido.' });
        estado.followups.set(m[1], { ...body });
        return enviar(200, { ok: true, updatedAt: new Date().toISOString() });
      }
      if (p === '/v1/client-email-draft') {
        if (req.method === 'GET') {
          const id = url.searchParams.get('costCenterPublicId');
          if (!obra(id)) return enviar(404, { ok: false, error: 'Centro de custo nao encontrado.' });
          return enviar(200, { ok: true, draft: { authorizedByEmail: null, authorizedAt: null, sentByEmail: null, sentAt: null, attachments: [], ...(estado.drafts.get(id) || draftPadrao(obra(id))) } });
        }
        if (req.method === 'PUT') {
          if (!body.to || !body.to.length) return enviar(400, { ok: false, error: 'Informe pelo menos um e-mail de destinatario.' });
          if (!body.subject || String(body.bodyText || '').trim().length < 5) return enviar(400, { ok: false, error: 'Informe assunto e mensagem.' });
          estado.drafts.set(body.costCenterPublicId, { to: body.to, cc: body.cc || [], subject: body.subject, bodyText: body.bodyText, status: 'draft', authorizedByEmail: null, authorizedAt: null, sentByEmail: null, sentAt: null });
          return enviar(200, { ok: true, status: 'draft', updatedAt: new Date().toISOString() });
        }
      }
      if (req.method === 'POST' && p === '/v1/client-email-draft/authorize') {
        const d = estado.drafts.get(body.costCenterPublicId);
        if (!d) return enviar(404, { ok: false, error: 'Salve o rascunho antes de autorizar.' });
        Object.assign(d, { status: 'authorized', authorizedByEmail: 'gestor@rcconstrutec.com.br', authorizedAt: new Date().toISOString() });
        return enviar(200, { ok: true, status: 'authorized' });
      }
      if (req.method === 'POST' && p === '/v1/client-email-draft/send') {
        const d = estado.drafts.get(body.costCenterPublicId);
        if (!d) return enviar(404, { ok: false, error: 'Rascunho nao encontrado.' });
        if (d.status !== 'authorized') return enviar(409, { ok: false, error: 'Este e-mail precisa ser autorizado por administrador ou gestor antes do envio.' });
        Object.assign(d, { status: 'sent', sentAt: new Date().toISOString(), sentByEmail: 'gestor@rcconstrutec.com.br' });
        estado.enviados.push({ obra: body.costCenterPublicId, to: d.to, cc: d.cc, anexos: (body.attachments || []).map((a) => a.filename) });
        return enviar(200, { ok: true, status: 'sent', sentAt: d.sentAt });
      }
      if (req.method === 'GET' && p === '/v1/clients') return enviar(200, { ok: true, clients: estado.clientes });
      return enviar(404, { ok: false, error: `Rota nao simulada: ${req.method} ${p}` });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, estado, enviados: estado.enviados, fechar: () => new Promise((r) => server.close(r)) };
}

module.exports = { iniciar };
