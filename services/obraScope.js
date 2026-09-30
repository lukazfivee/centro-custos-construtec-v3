// Visibilidade por obra (D6). Engenharia e tecnico so veem as obras atribuidas em
// user_cost_centers, a menos que users.all_cost_centers seja TRUE (o padrao das
// contas antigas). Os demais papeis veem todas. Sem obra atribuida, nao veem nada.
const { getDb } = require('../db');
const { httpError } = require('../lib/http');
const { suiteRoleOf, SCOPED_ROLES } = require('./permissions');

function escopado(user) {
  return Boolean(user) && SCOPED_ROLES.includes(suiteRoleOf(user)) && user.all_cost_centers === false;
}

// null = todas as obras; lista = so estas (pode ser vazia).
async function obrasPermitidas(req) {
  if (!escopado(req.usuario)) return null;
  if (!req.obrasPermitidas) {
    const { rows } = await getDb().query('SELECT cost_center_id FROM user_cost_centers WHERE user_id=$1', [req.usuario.id]);
    req.obrasPermitidas = rows.map((row) => Number(row.cost_center_id));
  }
  return req.obrasPermitidas;
}

async function assertObra(req, costCenterId) {
  const ids = await obrasPermitidas(req);
  if (ids && !ids.includes(Number(costCenterId))) throw httpError(403, 'Você não tem acesso a esta obra.');
}

// Rotas que somam ou listam todas as obras e nao tem filtro: escopado nao entra.
function bloquearEscopado(req, res, next) {
  if (escopado(req.usuario)) return res.status(403).json({ erro: 'Você não tem permissão para esta ação.' });
  return next();
}

// Acrescenta "coluna = ANY(ids)" a um WHERE ja montado (ou cria o WHERE).
function restringir(where, values, ids, column = 't.cost_center_id') {
  if (!ids) return { where, values };
  const next = [...values, ids];
  const clause = `${column} = ANY($${next.length}::int[])`;
  return { where: where && where.trim() ? `${where} AND ${clause}` : `WHERE ${clause}`, values: next };
}

// Para router.param('id', ...) em rotas onde :id e o centro de custo.
function paramObra(req, res, next, value) {
  assertObra(req, value).then(() => next(), next);
}

// Lista de obras para filtrar uma consulta: se a tela pediu uma obra (centroId), ela precisa estar no escopo.
async function obrasDaConsulta(req) {
  if (req.query?.centroId) await assertObra(req, req.query.centroId);
  return obrasPermitidas(req);
}

module.exports = { escopado, obrasPermitidas, obrasDaConsulta, assertObra, bloquearEscopado, restringir, paramObra };
