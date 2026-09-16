// Post-fix measurement for POST /api/recorrentes/gerar
// Usage: node scripts\measure-recurring-after.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.PGLITE_DATA_DIR = path.join(os.tmpdir(), 'centro-custos-rec-after');
process.env.RESTORE_ROOT_DIR = path.join(os.tmpdir(), 'centro-custos-rec-restore2');
process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.ADMIN_INITIAL_PASSWORD = 'Admin@123456';
process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
process.env.INSTANCE_NAME = 'Instalação de teste';

require('../server');
delete process.env.DATABASE_URL;

const { initializeDatabase, closeDatabase, getDb } = require('../db');
const { createApp } = require('../server');
const { snapshot, resetForTests } = require('../lib/metrics');

function hr() { return process.hrtime.bigint(); }
function ms(a, b) { return Number(b - a) / 1e6; }

async function setup() {
  fs.rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
  await initializeDatabase();
}

async function seedPrerequisites(db) {
  const user = (await db.query("SELECT id FROM users LIMIT 1")).rows[0];
  let cc = (await db.query("SELECT id FROM cost_centers LIMIT 1")).rows[0];
  if (!cc) {
    const r = await db.query(
      `INSERT INTO cost_centers (code,name,responsible,monthly_budget,client,contract_number,start_date,end_date,contract_amount,project_status,public_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      ['OBRA-001', 'Hospital Teste', 'Engenheiro Teste', 0, 'Cliente Teste', 'CT-2026-01', '2026-08-01', '2026-12-20', 50000, 'execucao', crypto.randomUUID()]
    );
    cc = r.rows[0];
  }
  let cat = (await db.query("SELECT id FROM categories WHERE type<>'receita' LIMIT 1")).rows[0];
  if (!cat) {
    const r = await db.query("INSERT INTO categories (name,type,public_id) VALUES ($1,'despesa',$2) RETURNING id", ['Material'], crypto.randomUUID());
    cat = r.rows[0];
  }
  return { user, cc, cat };
}

async function seedTemplates(db, { user, cc, cat }, n) {
  for (let i = 0; i < n; i++) {
    await db.query(
      `INSERT INTO recurring_templates (name,type,cost_center_id,category_id,counterparty,amount,payment_method,day_of_month,frequency,total_installments,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [`Recorrente ${i + 1}`, 'despesa', cc.id, cat.id, `Fav ${i}`, 1000 + i, 'dinheiro', 15, 'mensal', null, user.id]
    );
  }
}

async function runOnce(app, token, n) {
  await setup();
  const db = getDb();
  const prereq = await seedPrerequisites(db);
  await seedTemplates(db, prereq, n);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    resetForTests();
    const t0 = hr();
    const resp = await fetch(base + '/recorrentes/gerar', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const t1 = hr();
    const data = await resp.json();
    const snap = snapshot();
    const latency = ms(t0, t1);
    const body = JSON.stringify(data);
    return { n, queries: snap.database.total, latencyMs: latency, status: resp.status, bodyLen: body.length, gerados: data.gerados };
  } finally {
    await new Promise((r) => server.close(r));
    await closeDatabase();
  }
}

(async () => {
  const app = createApp();
  await setup();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const loginResp = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@teste.local', senha: 'Admin@123456' }) });
  const loginData = await loginResp.json();
  if (!loginResp.ok) { console.error('LOGIN FAILED', loginResp.status, loginData); process.exit(2); }
  const token = loginData.token;
  await new Promise((r) => server.close(r));
  await closeDatabase();
  const results = [];
  for (const n of [1, 10, 50]) {
    const r = await runOnce(app, token, n);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  console.log('AFTER_DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });