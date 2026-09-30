// Permissoes da Suite no Centro (D6). A matriz vem do diretorio central
// (GET /v1/permissions) e fica em cache curto; sem nuvem, ou se o Worker ainda
// nao a oferece, vale a matriz padrao daqui. Igual a cloudflare/center-container/suiteRoles.js
// (test/permissions.test.js confere).
const cloudAuth = require('./cloudAuth');
const logger = require('../lib/logger');

const SUITE_ROLES = ['admin', 'gestor', 'financeiro', 'engenharia', 'tecnico', 'comercial'];
const MATRIX = {
  p1: ['admin', 'gestor', 'financeiro', 'engenharia'],
  p2: ['admin', 'gestor', 'financeiro', 'engenharia', 'tecnico'],
  p3: ['admin', 'gestor', 'financeiro'],
  p4: ['admin', 'gestor', 'financeiro'],
  p5: ['admin', 'gestor'],
  p6: ['admin', 'gestor', 'financeiro'],
  p7: ['admin', 'gestor'],
  p8: ['admin'],
  p9: ['admin'],
  p10: ['admin', 'gestor', 'engenharia', 'comercial'],
  p11: ['admin', 'gestor', 'comercial'],
  p12: ['admin', 'gestor', 'engenharia', 'tecnico'],
};
const PERMISSIONS = Object.keys(MATRIX);
// Papeis que so veem as obras atribuidas (a menos que all_cost_centers seja TRUE).
const SCOPED_ROLES = ['engenharia', 'tecnico'];
const CACHE_MS = 60 * 1000;

function defaultMatrix() {
  const out = {};
  for (const role of SUITE_ROLES) {
    out[role] = {};
    for (const p of PERMISSIONS) out[role][p] = MATRIX[p].includes(role);
  }
  return out;
}

function suiteRoleOf(user) {
  if (SUITE_ROLES.includes(user?.suite_role)) return user.suite_role;
  if (user?.role === 'admin') return 'admin';
  if (user?.role === 'gestor') return 'gestor';
  return 'tecnico';
}

let cached = null;

function resetPermissionsCache() { cached = null; }

// A matriz do central vale para todos; qualquer sessao corporativa pode le-la.
async function matrixFor(user) {
  if (!process.env.DATABASE_URL || !user?.cloud_managed) return defaultMatrix();
  if (cached && cached.until > Date.now()) return cached.matrix;
  const token = user.cloud_session_token;
  if (!token || String(token).startsWith('hash:')) return cached?.matrix || defaultMatrix();
  try {
    const data = await cloudAuth.permissions(token);
    if (data?.matrix && data.matrix.admin) {
      cached = { matrix: data.matrix, until: Date.now() + CACHE_MS };
      return cached.matrix;
    }
  } catch (error) {
    if (error.status !== 404) logger.warn('permissions_matrix_unavailable', { status: error.status || null });
  }
  // Worker antigo (sem a rota) ou fora do ar: usa a ultima matriz boa ou o padrao.
  return cached?.matrix || defaultMatrix();
}

async function can(user, permission) {
  const role = suiteRoleOf(user);
  if (role === 'admin') return true;
  const matrix = await matrixFor(user);
  return Boolean(matrix[role]?.[permission]);
}

function exigirPermissao(...permissions) {
  return async (req, res, next) => {
    try {
      for (const p of permissions) if (req.usuario && await can(req.usuario, p)) return next();
      return res.status(403).json({ erro: 'Você não tem permissão para esta ação.' });
    } catch (error) { return next(error); }
  };
}

module.exports = {
  SUITE_ROLES, PERMISSIONS, SCOPED_ROLES, defaultMatrix, suiteRoleOf, matrixFor, can, exigirPermissao, resetPermissionsCache,
};
