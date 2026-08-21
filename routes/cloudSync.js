const express = require('express');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute, httpError } = require('../lib/http');
const cloud = require('../services/cloudSync');

const router = express.Router();
router.use(autenticar);

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
  res.json(await cloud.getClientDraft(req.usuario, req.params.publicId));
}));

router.put('/cobrancas/:publicId/rascunho', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  res.json(await cloud.saveClientDraft(req.usuario, { ...req.body, costCenterPublicId:req.params.publicId }));
}));

router.post('/cobrancas/:publicId/autorizar', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  if (req.body?.confirmar !== true) throw httpError(400,'Confirme explicitamente a autorização do envio.');
  res.json(await cloud.authorizeClientDraft(req.usuario, req.params.publicId));
}));

router.post('/cobrancas/:publicId/enviar', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  res.json(await cloud.sendClientDraft(req.usuario, req.params.publicId, req.body?.attachments || []));
}));

module.exports = router;
