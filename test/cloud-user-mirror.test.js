const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.PGLITE_DATA_DIR = path.join(os.tmpdir(), `centro-custos-mirror-${process.pid}`);
process.env.RESTORE_ROOT_DIR = path.join(os.tmpdir(), `centro-custos-mirror-restore-${process.pid}`);
process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.ADMIN_INITIAL_PASSWORD = 'Admin@123456';
process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
delete process.env.DATABASE_URL;

const { initializeDatabase, closeDatabase, getDb } = require('../db');
const { mirrorCloudUser } = require('../services/cloudUserMirror');

test('espelho local: conta central recriada com o mesmo e-mail vira linha nova', async (t) => {
  fs.rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
  await initializeDatabase();
  t.after(async () => {
    await closeDatabase();
    fs.rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
  });
  const db = getDb();
  const email = 'fulano@rcconstrutec.com.br';

  const first = await mirrorCloudUser(db, { id: 'cloud-1', name: 'Fulano', email, role: 'gestor' }, { sessionToken: 'tok-1' });
  const again = await mirrorCloudUser(db, { id: 'cloud-1', name: 'Fulano Silva', email, role: 'gestor' });
  assert.equal(again.id, first.id);
  assert.equal(again.cloud_session_token, 'tok-1');

  const recreated = await mirrorCloudUser(db, { id: 'cloud-2', name: 'Fulano Novo', email, role: 'supervisor' });
  assert.notEqual(recreated.id, first.id);
  const old = (await db.query('SELECT name,active,deleted_at,cloud_session_token FROM users WHERE id=$1', [first.id])).rows[0];
  assert.equal(old.name, 'Fulano Silva');
  assert.equal(old.active, false);
  assert.ok(old.deleted_at);
  assert.equal(old.cloud_session_token, null);

  const legacy = await mirrorCloudUser(db, { name: 'Sem id', email: 'semid@rcconstrutec.com.br', role: 'gestor' });
  const linked = await mirrorCloudUser(db, { id: 'cloud-3', name: 'Sem id', email: 'semid@rcconstrutec.com.br', role: 'gestor' });
  assert.equal(linked.id, legacy.id);
  assert.equal(linked.cloud_user_id, 'cloud-3');
});
