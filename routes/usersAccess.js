// Papel, apps e obras de cada usuario, e a matriz de permissoes (D6). Sempre admin (p9).
const express = require('express');
const { getDb } = require('../db');
const { autenticar } = require('../middleware/auth');
const { exigirPermissao, defaultMatrix, SUITE_ROLES, PERMISSIONS, resetPermissionsCache } = require('../services/permissions');
const { asyncRoute, httpError, positiveId } = require('../lib/http');
const { recordAudit } = require('../services/audit');
const cloudAuth = require('../services/cloudAuth');
const { mirrorCloudUser } = require('../services/cloudUserMirror');
const { readAccess, setObras, legacyRoleFor, decorate } = require('../services/userAccess');

const router = express.Router();
router.use(autenticar, exigirPermissao('p9'));

function cloudToken(req) {
  if (!req.usuario.cloud_managed || !req.usuario.cloud_session_token || String(req.usuario.cloud_session_token).startsWith('hash:')) {
    throw httpError(400, 'Papéis e permissões compartilhados são gerenciados por um administrador com login corporativo.');
  }
  return req.usuario.cloud_session_token;
}

function cloudFailure(error, fallback) {
  if ([400, 401, 403, 404, 409].includes(error.status)) return httpError(error.status, error.message);
  return httpError(503, fallback);
}

function matrixPayload(data) {
  return { papeis: data.roles, permissoes: data.permissions, matriz: data.matrix, padrao: data.defaults };
}

// Matriz atual. Sem nuvem (desktop local), vale a matriz padrao, somente leitura.
router.get('/permissoes', asyncRoute(async (req, res) => {
  if (!process.env.DATABASE_URL || !req.usuario.cloud_managed) {
    const padrao = defaultMatrix();
    return res.json({ ...matrixPayload({ roles: SUITE_ROLES, permissions: PERMISSIONS, matrix: padrao, defaults: padrao }), somenteLeitura: true });
  }
  try { return res.json(matrixPayload(await cloudAuth.permissions(cloudToken(req)))); }
  catch (error) { throw error.statusCode ? error : cloudFailure(error, 'Não foi possível carregar as permissões agora.'); }
}));

router.post('/permissoes', asyncRoute(async (req, res) => {
  const { papel, permissao, permitido } = req.body || {};
  if (!SUITE_ROLES.includes(papel) || !PERMISSIONS.includes(permissao) || typeof permitido !== 'boolean') throw httpError(400, 'Informe papel, permissão e valor.');
  if (papel === 'admin') throw httpError(400, 'O administrador fica sempre com todas as permissões.');
  let data;
  try { data = await cloudAuth.setPermission(cloudToken(req), { role: papel, permission: permissao, allowed: permitido }); }
  catch (error) { throw error.statusCode ? error : cloudFailure(error, 'Não foi possível salvar a permissão agora.'); }
  resetPermissionsCache();
  await recordAudit({ entityType: 'permissao', entityId: `${papel}:${permissao}`, action: 'alterada', summary: `Permissão ${permissao} de ${papel}: ${permitido ? 'liberada' : 'retirada'}.`, data: { papel, permissao, permitido }, user: req.usuario });
  res.json(matrixPayload(data));
}));

router.post('/permissoes/restaurar', asyncRoute(async (req, res) => {
  let data;
  try { data = await cloudAuth.resetPermissions(cloudToken(req)); }
  catch (error) { throw error.statusCode ? error : cloudFailure(error, 'Não foi possível restaurar o padrão agora.'); }
  resetPermissionsCache();
  await recordAudit({ entityType: 'permissao', entityId: 'todas', action: 'restaurada', summary: 'Matriz de permissões restaurada ao padrão.', data: {}, user: req.usuario });
  res.json(matrixPayload(data));
}));

// Papel, apps e obras de um usuario.
router.put('/:id/acesso', asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id, 'Usuário');
  const access = readAccess(req.body || {}, { required: true });
  const db = getDb();
  const target = (await db.query('SELECT id,name,email,role,suite_role,active,cloud_managed,cloud_user_id FROM users WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
  if (!target) throw httpError(404, 'Usuário não encontrado.');
  if (id === req.usuario.id) throw httpError(400, 'Você não pode alterar o próprio papel.');

  if (target.cloud_managed) {
    let remote;
    try { remote = await cloudAuth.setUserAccess(cloudToken(req), { email: target.email, id: target.cloud_user_id || undefined, suiteRole: access.suiteRole, apps: access.apps }); }
    catch (error) { throw error.statusCode ? error : cloudFailure(error, 'Não foi possível alterar o acesso corporativo agora.'); }
    await mirrorCloudUser(db, remote.user);
  } else {
    await db.query('UPDATE users SET suite_role=$1, role=$2, apps=COALESCE($3,apps), updated_at=NOW() WHERE id=$4',
      [access.suiteRole, legacyRoleFor(access.suiteRole), access.apps ? JSON.stringify(access.apps) : null, id]);
  }
  if (access.obras !== undefined) await setObras(db, id, access.obras);
  const [user] = await decorate(db, [{ id: target.id, nome: target.name, email: target.email, role: legacyRoleFor(access.suiteRole), ativo: target.active, cloud_managed: target.cloud_managed === true }]);
  await recordAudit({ entityType: 'usuario', entityId: id, action: 'acesso_alterado', summary: `Acesso de ${target.name}: papel ${access.suiteRole}.`, data: { papel: access.suiteRole, apps: access.apps, obras: access.obras }, user: req.usuario });
  res.json(user);
}));

module.exports = router;
