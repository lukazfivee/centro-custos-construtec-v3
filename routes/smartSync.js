const express = require('express');
const { autenticar, exigirPapel } = require('../middleware/auth');
const { asyncRoute } = require('../lib/http');
const { buildPackage, importPackage, listImports, listConflicts, resolveConflict } = require('../services/smartSync');

const router = express.Router();
router.use(autenticar);

router.get('/exportar', asyncRoute(async (req, res) => {
  const pack = await buildPackage();
  const suffix = new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sincronizacao-inteligente-${suffix}.ccsync"`);
  res.send(JSON.stringify(pack, null, 2));
}));

router.post('/importar', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const result = await importPackage({
    content:req.body.conteudo,
    filename:req.body.nomeArquivo,
    user:req.usuario,
  });
  res.json(result);
}));

router.get('/historico', asyncRoute(async (req, res) => res.json(await listImports())));
router.get('/conflitos', asyncRoute(async (req, res) => res.json(await listConflicts())));

router.post('/conflitos/:id/resolver', exigirPapel('admin','gestor'), asyncRoute(async (req, res) => {
  const result = await resolveConflict({
    id:Number(req.params.id),
    choice:String(req.body.escolha || ''),
    user:req.usuario,
  });
  res.json(result);
}));

module.exports = router;
