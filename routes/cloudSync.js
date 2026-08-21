const express = require('express');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute } = require('../lib/http');
const { configured, corporateEmail, syncNow, pullNow } = require('../services/cloudSync');

const router = express.Router();
router.use(autenticar);

router.get('/status', asyncRoute(async (req, res) => {
  res.json({
    configured:configured(),
    eligible:corporateEmail(req.usuario.email),
    domain:'rcconstrutec.com.br',
  });
}));

router.post('/sincronizar', exigirPapel('admin','gestor','supervisor'), asyncRoute(async (req, res) => {
  res.json(await syncNow(req.usuario));
}));

router.post('/receber', exigirPapel('admin','gestor','supervisor'), asyncRoute(async (req, res) => {
  res.json(await pullNow(req.usuario));
}));

module.exports = router;
