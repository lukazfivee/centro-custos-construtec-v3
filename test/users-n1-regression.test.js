const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.PGLITE_DATA_DIR = path.join(os.tmpdir(), 'centro-custos-users-n1');
process.env.RESTORE_ROOT_DIR = path.join(os.tmpdir(), 'centro-custos-users-restore-n1');
process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.ADMIN_INITIAL_PASSWORD = 'Admin@123456';
process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
process.env.INSTANCE_NAME = 'Instalação de teste';
delete process.env.DATABASE_URL;

require('../server');
delete process.env.DATABASE_URL;

const jwt = require('jsonwebtoken');
const { initializeDatabase, closeDatabase, getDb } = require('../db');
const { createApp } = require('../server');
const { snapshot, resetForTests } = require('../lib/metrics');
const cloudAuth = require('../services/cloudAuth');

function hr() { return process.hrtime.bigint(); }
function ms(a, b) { return Number(b - a) / 1e6; }

async function setup() {
  fs.rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
  await initializeDatabase();
}

// O e-mail precisa bater com o dominio corporativo (cloudAuth.corporateEmail)
// para a rota entrar no ramo "corporativo" de GET /api/usuarios.
async function makeCloudAdmin(db) {
  const existing = (await db.query("SELECT id FROM users WHERE email='admin@teste.local'")).rows[0];
  await db.query(
    "UPDATE users SET email='admin@rcconstrutec.com.br', cloud_managed=TRUE, cloud_session_token='tok-admin' WHERE id=$1",
    [existing.id]
  );
  return existing.id;
}

function tokenFor(id) {
  return jwt.sign({}, process.env.JWT_SECRET, { subject: String(id), expiresIn: '8h' });
}

function mockListUsers(n) {
  const users = [];
  for (let i = 0; i < n; i++) {
    users.push({ name: `Usuario Remoto ${i + 1}`, email: `user${i}@rcconstrutec.com.br`, role: 'supervisor', active: true });
  }
  cloudAuth.listUsers = async () => ({ users });
}

test('GET /api/usuarios (corporativo) não é N+1 (queries O(1) em relação a N)', async () => {
  await setup();
  const db = getDb();
  const adminId = await makeCloudAdmin(db);
  const token = tokenFor(adminId);
  mockListUsers(50);

  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  resetForTests();
  const t0 = hr();
  const resp = await fetch(base + '/usuarios', { headers: { Authorization: `Bearer ${token}` } });
  const t1 = hr();
  const data = await resp.json();
  const snap = snapshot();

  assert.equal(resp.status, 200, `HTTP status: ${resp.status}`);
  assert.equal(data.length, 50, `esperados 50 usuários, recebeu ${data.length}`);
  // Anti-N+1: queries devem ser O(1), não O(N). 50 usuários remotos não deve gerar 100+ queries.
  assert.ok(snap.database.total <= 6, `queries demais para 50 usuários remotos (N+1?): ${snap.database.total}`);
  assert.ok(ms(t0, t1) < 2000, `latência alta: ${ms(t0, t1)}ms`);

  const count = (await db.query("SELECT COUNT(*)::int AS total FROM users WHERE cloud_managed = TRUE")).rows[0].total;
  assert.equal(count, 51, `usuários cloud_managed devem ser 51 (admin + 50 remotos), recebeu ${count}`);

  await new Promise((r) => server.close(r));
  await closeDatabase();
});

test('GET /api/usuarios (corporativo) preserva índice único ao atualizar usuários já existentes', async () => {
  await setup();
  const db = getDb();
  const adminId = await makeCloudAdmin(db);
  const token = tokenFor(adminId);

  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  // Primeira chamada cria os usuários remotos.
  mockListUsers(5);
  let resp = await fetch(base + '/usuarios', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(resp.status, 200);
  const firstIds = (await resp.json()).map((u) => u.id).sort();

  // Segunda chamada com o mesmo conjunto de e-mails deve atualizar, não duplicar.
  resetForTests();
  const t0 = hr();
  resp = await fetch(base + '/usuarios', { headers: { Authorization: `Bearer ${token}` } });
  const t1 = hr();
  const data = await resp.json();
  const snap = snapshot();
  const secondIds = data.map((u) => u.id).sort();

  assert.equal(resp.status, 200, `HTTP status: ${resp.status}`);
  assert.deepEqual(secondIds, firstIds, 'usuários existentes devem ser atualizados (mesmos ids), não duplicados');
  assert.ok(snap.database.total <= 6, `queries demais na atualização em lote: ${snap.database.total}`);
  assert.ok(ms(t0, t1) < 1000, `latência alta na atualização: ${ms(t0, t1)}ms`);

  const total = (await db.query('SELECT COUNT(*)::int AS total FROM users').then((r) => r.rows[0].total));
  assert.equal(total, 6, `não deve haver duplicatas (admin + 5 remotos = 6), recebeu ${total}`);

  await new Promise((r) => server.close(r));
  await closeDatabase();
});
