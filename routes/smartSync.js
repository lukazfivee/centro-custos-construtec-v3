const express = require('express');
const { autenticar } = require('../middleware/auth');
const { exigirPermissao } = require('../services/permissions');
const { bloquearEscopado } = require('../services/obraScope');
const { asyncRoute } = require('../lib/http');
const { todayIso } = require('../lib/dates');
const { buildPackage, importPackage, listImports, listConflicts, resolveConflict } = require('../services/smartSync');

const router = express.Router();
router.use(autenticar);

router.get('/exportar', exigirPermissao('p9'), bloquearEscopado, asyncRoute(async (req, res) => {
  const pack = await buildPackage();
  const suffix = todayIso();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sincronizacao-inteligente-${suffix}.ccsync"`);
  res.send(JSON.stringify(pack, null, 2));
}));

router.post('/importar', exigirPermissao('p5'), bloquearEscopado, asyncRoute(async (req, res) => {
  const result = await importPackage({
    content:req.body.conteudo,
    filename:req.body.nomeArquivo,
    user:req.usuario,
  });
  res.status(result.async ? 202 : 200).json(result);
}));

router.get('/historico', exigirPermissao('p9'), bloquearEscopado, asyncRoute(async (req, res) => res.json(await listImports())));
router.get('/conflitos', exigirPermissao('p9'), bloquearEscopado, asyncRoute(async (req, res) => res.json(await listConflicts())));

router.post('/conflitos/:id/resolver', exigirPermissao('p5'), bloquearEscopado, asyncRoute(async (req, res) => {
  const result = await resolveConflict({
    id:Number(req.params.id),
    choice:String(req.body.escolha || ''),
    user:req.usuario,
  });
  res.json(result);
}));

module.exports = router;
