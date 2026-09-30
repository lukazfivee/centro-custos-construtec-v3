const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

process.env.PGLITE_DATA_DIR = path.join(os.tmpdir(), `centro-custos-perm-${process.pid}`);
process.env.RESTORE_ROOT_DIR = path.join(os.tmpdir(), `centro-custos-perm-restore-${process.pid}`);
process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.ADMIN_INITIAL_PASSWORD = 'Admin@123456';
process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
delete process.env.DATABASE_URL;

const { initializeDatabase, closeDatabase, getDb } = require('../db');
const { mirrorCloudUser } = require('../services/cloudUserMirror');
const permissions = require('../services/permissions');

test('matriz padrao do Centro e igual a do Worker central', async () => {
  const worker = await import(pathToFileURL(path.join(__dirname, '..', 'cloudflare', 'center-container', 'suiteRoles.js')).href);
  assert.deepEqual(permissions.defaultMatrix(), worker.defaultMatrix());
  assert.deepEqual(permissions.SUITE_ROLES, worker.SUITE_ROLES);
  assert.deepEqual(permissions.PERMISSIONS, worker.PERMISSIONS);
});

test('papel efetivo: papel novo, ou o mapeamento do legado (supervisor -> tecnico)', () => {
  const { suiteRoleOf } = permissions;
  assert.equal(suiteRoleOf({ role: 'supervisor' }), 'tecnico');
  assert.equal(suiteRoleOf({ role: 'gestor' }), 'gestor');
  assert.equal(suiteRoleOf({ role: 'admin' }), 'admin');
  assert.equal(suiteRoleOf({ role: 'supervisor', suite_role: 'financeiro' }), 'financeiro');
  assert.equal(suiteRoleOf({ role: 'admin', suite_role: 'invalido' }), 'admin');
});

test('exigirPermissao: cada papel passa so onde a matriz permite', async () => {
  const run = async (role, ...perms) => {
    let status = 200;
    let nextCalled = false;
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    await permissions.exigirPermissao(...perms)({ usuario: { role: 'supervisor', suite_role: role } }, res, () => { nextCalled = true; });
    return nextCalled ? 200 : status;
  };
  assert.equal(await run('tecnico', 'p2'), 200);
  assert.equal(await run('tecnico', 'p3'), 403);
  assert.equal(await run('financeiro', 'p4'), 200);
  assert.equal(await run('financeiro', 'p5'), 403);
  assert.equal(await run('comercial', 'p2'), 403);
  assert.equal(await run('comercial', 'p10', 'p11'), 200);
  assert.equal(await run('gestor', 'p8'), 403);
  assert.equal(await run('admin', 'p8', 'p9'), 200);
  let status = 200;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  await permissions.exigirPermissao('p1')({}, res, () => {});
  assert.equal(status, 403);
});

test('espelho grava o papel novo sem tocar no legado e escopa engenharia e tecnico novos', async (t) => {
  fs.rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
  await initializeDatabase();
  t.after(async () => {
    await closeDatabase();
    fs.rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
  });
  const db = getDb();

  // Conta antiga (sem papel novo): mantem todas as obras.
  const old = await mirrorCloudUser(db, { id: 'c1', name: 'Sup', email: 'sup@rcconstrutec.com.br', role: 'supervisor' });
  assert.equal(old.suite_role, null);
  assert.equal(old.all_cost_centers, true);

  // Worker novo promove a conta: papel novo entra, legado segue o do diretorio, obras nao mudam.
  const promoted = await mirrorCloudUser(db, { id: 'c1', name: 'Sup', email: 'sup@rcconstrutec.com.br', role: 'supervisor', suiteRole: 'financeiro', apps: ['centro'] });
  assert.equal(promoted.suite_role, 'financeiro');
  assert.equal(promoted.role, 'supervisor');
  assert.equal(promoted.all_cost_centers, true);
  assert.equal((await db.query('SELECT apps FROM users WHERE id=$1', [promoted.id])).rows[0].apps, '["centro"]');

  // Worker antigo (sem os campos) nao apaga o papel novo ja espelhado.
  const kept = await mirrorCloudUser(db, { id: 'c1', name: 'Sup', email: 'sup@rcconstrutec.com.br', role: 'supervisor' });
  assert.equal(kept.suite_role, 'financeiro');

  const tecnico = await mirrorCloudUser(db, { id: 'c2', name: 'Tec', email: 'tec@rcconstrutec.com.br', role: 'supervisor', suiteRole: 'tecnico' });
  assert.equal(tecnico.all_cost_centers, false);
  const eng = await mirrorCloudUser(db, { id: 'c3', name: 'Eng', email: 'eng@rcconstrutec.com.br', role: 'supervisor', suiteRole: 'engenharia' });
  assert.equal(eng.all_cost_centers, false);
  const comercial = await mirrorCloudUser(db, { id: 'c4', name: 'Com', email: 'com@rcconstrutec.com.br', role: 'supervisor', suiteRole: 'comercial' });
  assert.equal(comercial.all_cost_centers, true);
  // Tecnico novo que ainda nao tem papel novo no Worker (legado) tambem nasce sem obras? Nao: sem suite_role vale TRUE.
  const legacyNew = await mirrorCloudUser(db, { id: 'c5', name: 'Leg', email: 'leg@rcconstrutec.com.br', role: 'supervisor' });
  assert.equal(legacyNew.all_cost_centers, true);
});
