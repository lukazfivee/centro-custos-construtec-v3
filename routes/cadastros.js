// Pedidos de acesso, convites e código da empresa (Fase 5), para o site do celular
// e a tela de usuários do Centro web. Tudo fica no Worker central; aqui só se traduz
// o usuário local na conta central, e o Worker confere se ela é admin.
const express = require('express');
const { autenticar } = require('../middleware/auth');
const { asyncRoute, httpError } = require('../lib/http');
const { workerCall } = require('../services/notify');

const PERFIS = ['admin', 'gestor', 'supervisor'];

const router = express.Router();
router.use(autenticar);

function actor(req) {
  const id = req.usuario && req.usuario.cloud_user_id;
  if (!id) throw httpError(409, 'Pedidos de acesso usam a conta central. Entre com a conta @rcconstrutec.com.br.');
  return id;
}

// Erros de validação do Worker (400, 403, 404, 409) chegam como estão; o resto vira 503.
async function forward(req, res, action, extra = {}) {
  const actorId = actor(req);
  try {
    res.json(await workerCall('/v1/internal/signup', { ...extra, action, actorId }));
  } catch (error) {
    const passthrough = [400, 403, 404, 409].includes(error.upstream);
    throw httpError(passthrough ? error.upstream : 503, passthrough ? error.message : 'Central de acesso indisponível.');
  }
}

const perfil = (value) => (PERFIS.includes(value) ? value : 'supervisor');
const pedidoId = (req) => String(req.params.id || '').slice(0, 64);

router.get('/', asyncRoute(async (req, res) => forward(req, res, 'list')));
router.post('/:id/aprovar', asyncRoute(async (req, res) => forward(req, res, 'approve', { id: pedidoId(req), role: perfil((req.body || {}).perfil) })));
router.post('/:id/recusar', asyncRoute(async (req, res) => forward(req, res, 'reject', { id: pedidoId(req) })));
router.post('/convites', asyncRoute(async (req, res) => {
  const body = req.body || {};
  return forward(req, res, 'invite', { email: String(body.email || '').trim().slice(0, 200), role: perfil(body.perfil) });
}));
router.post('/codigo/trocar', asyncRoute(async (req, res) => forward(req, res, 'rotate')));

module.exports = router;
