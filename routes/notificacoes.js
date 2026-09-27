// Central de notificações do site do celular (Fase 4) e rota interna dos avisos
// diários. A central fica no Worker; aqui só se traduz o usuário local na conta
// central (users.cloud_user_id).
const crypto = require('crypto');
const express = require('express');
const { getDb } = require('../db');
const { autenticar } = require('../middleware/auth');
const { asyncRoute, httpError } = require('../lib/http');
const { userAction } = require('../services/notify');
const { computeDailyNotices } = require('../services/dailyNotices');

const TYPES = ['proposta_aprovada', 'acima_orcado', 'conta_vencer', 'novo_acesso'];

const router = express.Router();
router.use(autenticar);

function cloudId(req) {
  const id = req.usuario && req.usuario.cloud_user_id;
  if (!id) throw httpError(409, 'As notificações usam a conta central. Entre com a conta @rcconstrutec.com.br.');
  return id;
}

async function forward(res, promise) {
  try { res.json(await promise); }
  catch (error) { throw httpError(error.status === 404 ? 404 : 503, error.message || 'Central de notificações indisponível.'); }
}

router.get('/', asyncRoute(async (req, res) => forward(res, userAction(cloudId(req), 'list', { limit: req.query.limite }))));
router.post('/lidas', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 100) : [];
  return forward(res, userAction(cloudId(req), 'read', body.todas === true ? { all: true } : { ids }));
}));
router.get('/preferencias', asyncRoute(async (req, res) => forward(res, userAction(cloudId(req), 'prefs'))));
router.put('/preferencias', asyncRoute(async (req, res) => {
  const { tipo, ativo } = req.body || {};
  if (!TYPES.includes(tipo) || typeof ativo !== 'boolean') throw httpError(400, 'Preferência inválida.');
  return forward(res, userAction(cloudId(req), 'setPref', { type: tipo, enabled: ativo }));
}));
router.post('/teste', asyncRoute(async (req, res) => forward(res, userAction(cloudId(req), 'test'))));

// Chamada só pelo cron do Worker (o Worker bloqueia /api/interno/ ao público).
const interno = express.Router();
function syncKeyValid(req) {
  const expected = String(process.env.SYNC_SHARED_KEY || '');
  const provided = String(req.headers['x-sync-key'] || '');
  return expected.length >= 32 && provided.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
interno.post('/avisos-diarios', asyncRoute(async (req, res) => {
  if (!syncKeyValid(req)) return res.status(404).end();
  res.json({ events: await computeDailyNotices(getDb()) });
}));

module.exports = { router, interno };
