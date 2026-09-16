// Measurement for GET /api/usuarios (corporate mode)
// Usage: node scripts\measure-users-baseline.js
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.PGLITE_DATA_DIR = path.join(os.tmpdir(), 'centro-custos-users-baseline');
process.env.RESTORE_ROOT_DIR = path.join(os.tmpdir(), 'centro-custos-users-restore');
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
// para que a rota entre no ramo "corporativo" de GET /api/usuarios.
async function makeCloudAdmin(db) {
  const existing = (await db.query("SELECT id FROM users WHERE email='admin@teste.local'")).rows[0];
  const id = existing.id;
  await db.query(
    "UPDATE users SET email='admin@rcconstrutec.com.br', cloud_managed=TRUE, cloud_session_token='tok-admin' WHERE id=$1",
    [id]
  );
  return id;
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

async function runOnce(app, n) {
  await setup();
  const db = getDb();
  const adminId = await makeCloudAdmin(db);
  const token = tokenFor(adminId);
  mockListUsers(n);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    resetForTests();
    const t0 = hr();
    const resp = await fetch(base + '/usuarios', { headers: { Authorization: `Bearer ${token}` } });
    const t1 = hr();
    const data = await resp.json();
    const snap = snapshot();
    return { n, queries: snap.database.total, latencyMs: ms(t0, t1), status: resp.status, bodyLen: JSON.stringify(data).length, count: Array.isArray(data) ? data.length : null };
  } finally {
    await new Promise((r) => server.close(r));
    await closeDatabase();
  }
}

(async () => {
  const app = createApp();
  const results = [];
  for (const n of [1, 10, 50]) {
    const r = await runOnce(app, n);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  console.log('BASELINE_DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
