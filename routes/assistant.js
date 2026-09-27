// Consultas do assistente do celular (IA) que não existem nas rotas do Centro:
// as propostas do Orçamentos, lidas com a sessão central de quem pergunta.
const express = require('express');
const { autenticar } = require('../middleware/auth');
const { asyncRoute } = require('../lib/http');
const { listProposals, proposalDetail } = require('../services/orcamentosProxy');

const router = express.Router();
router.use(autenticar);

router.get('/orcamentos/propostas', asyncRoute(async (req, res) => {
  const busca = String(req.query.busca || '').slice(0, 80);
  const status = String(req.query.status || '').slice(0, 20);
  res.json(await listProposals(req.usuario, { busca, status }));
}));

router.get('/orcamentos/propostas/:id', asyncRoute(async (req, res) => {
  res.json(await proposalDetail(req.usuario, req.params.id));
}));

module.exports = router;
