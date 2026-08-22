const express = require('express');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError } = require('../lib/http');
const cloud = require('../services/cloudSync');

const router = express.Router();
router.use(autenticar);

const BILLING_CC = [
  'supervisao@rcconstrutec.com.br',
  'engenharia@rcconstrutec.com.br',
  'comercial@rcconstrutec.com.br',
  'pcm@rcconstrutec.com.br',
];

function emailList(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))];
}

function billingCc(value, senderEmail, to = []) {
  const sender = String(senderEmail || '').trim().toLowerCase();
  const primary = new Set(emailList(to));
  return [...new Set([...emailList(value), ...BILLING_CC])]
    .filter((email) => email !== sender && !primary.has(email));
}

function validateInvoicePdfAttachments(value) {
  const attachments = Array.isArray(value) ? value : [];
  if (attachments.length > 1) throw httpError(400,'Anexe somente uma nota fiscal em PDF por envio.');
  if (!attachments.length) return attachments;

  const file = attachments[0] || {};
  const filename = String(file.filename || '').trim();
  const contentType = String(file.contentType || '').trim().toLowerCase();
  const contentBase64 = String(file.contentBase64 || '').trim();
  if (!filename || !contentBase64) throw httpError(400,'O arquivo da nota fiscal é inválido.');
  if (!/\.pdf$/i.test(filename) || contentType !== 'application/pdf') {
    throw httpError(400,'A nota fiscal deve ser enviada em formato PDF.');
  }
  const estimatedBytes = Math.ceil(contentBase64.length * 0.75);
  if (estimatedBytes > 5 * 1024 * 1024) throw httpError(413,'A nota fiscal em PDF deve ter no máximo 5 MB.');
  return attachments;
}

router.get('/status', asyncRoute(async (req, res) => {
  res.json({
    configured:cloud.configured(),
    eligible:cloud.corporateEmail(req.usuario.email),
    domain:'rcconstrutec.com.br',
  });
}));

router.post('/sincronizar', exigirPapel('admin','gestor','supervisor'), asyncRoute(async (req, res) => {
  res.json(await cloud.syncNow(req.usuario));
}));

router.post('/receber', exigirPapel('admin','gestor','supervisor'), asyncRoute(async (req, res) => {
  res.json(await cloud.pullNow(req.usuario));
}));

router.get('/atividade', exigirPapel('admin','gestor','supervisor'), asyncRoute(async (req, res) => {
  res.json(await cloud.activitySince(req.usuario, req.query.after));
}));

router.get('/clientes', exigirPapel('admin','gestor','supervisor'), asyncRoute(async (req, res) => {
  res.json(await cloud.listClients(req.usuario));
}));

router.post('/clientes', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  res.status(201).json(await cloud.createClient(req.usuario, req.body));
}));

router.put('/clientes/:id', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  res.json(await cloud.updateClient(req.usuario, req.params.id, req.body));
}));

router.post('/clientes/:id/status', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  res.json(await cloud.setClientStatus(req.usuario, req.params.id, req.body?.active === true));
}));

router.get('/cobrancas', exigirPapel('admin','gestor','supervisor'), asyncRoute(async (req, res) => {
  res.json(await cloud.listClientFollowups(req.usuario));
}));

router.put('/cobrancas/:publicId', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  res.json(await cloud.saveClientFollowup(req.usuario, req.params.publicId, req.body));
}));

router.get('/cobrancas/:publicId/rascunho', exigirPapel('admin','gestor','supervisor'), asyncRoute(async (req, res) => {
  const data = await cloud.getClientDraft(req.usuario, req.params.publicId);
  if (data?.draft) {
    data.draft.cc = billingCc(data.draft.cc, req.usuario.email, data.draft.to);
    data.copyPolicy = { mandatory:true, emails:BILLING_CC };
  }
  res.json(data);
}));

router.put('/cobrancas/:publicId/rascunho', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const to = emailList(req.body?.to);
  const payload = {
    ...req.body,
    to,
    cc:billingCc(req.body?.cc, req.usuario.email, to),
    costCenterPublicId:req.params.publicId,
  };
  res.json(await cloud.saveClientDraft(req.usuario, payload));
}));

router.post('/cobrancas/:publicId/autorizar', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  if (req.body?.confirmar !== true) throw httpError(400,'Confirme explicitamente a autorização do envio.');
  res.json(await cloud.authorizeClientDraft(req.usuario, req.params.publicId));
}));

router.post('/cobrancas/:publicId/enviar', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const attachments = validateInvoicePdfAttachments(req.body?.attachments);
  res.json(await cloud.sendClientDraft(req.usuario, req.params.publicId, attachments));
}));

module.exports = router;
