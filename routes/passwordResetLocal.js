// "Esqueci a senha" do desktop dentro da Suite: o servidor local nao tem o /v1 do diretorio central,
// entao repassa o pedido. Na nuvem o Worker atende /v1 antes do Container e esta rota nao e chamada.
const express = require('express');
const cloudAuth = require('../services/cloudAuth');
const logger = require('../lib/logger');
const { asyncRoute, httpError } = require('../lib/http');

const router = express.Router();

router.post('/request', asyncRoute(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 254);
  try {
    await cloudAuth.requestPasswordReset(email);
  } catch (error) {
    logger.warn('password_reset_request_unavailable', { status:error.status || null });
    throw httpError(503, 'Não foi possível pedir o link agora. Verifique a internet e tente de novo.');
  }
  res.status(202).json({ ok:true });
}));

module.exports = router;
