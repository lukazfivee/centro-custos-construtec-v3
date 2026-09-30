const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Desktop novo (D3b): medicoes com data pura (sem hora, corrige o problema 4) e quem registrou;
// importar orcamento so para admin e gestor.
test('medições com data pura e autor; importação só para admin e gestor', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-d3b-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
  delete process.env.DATABASE_URL;

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  context.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  async function request(url, method, body, status, token) {
    const response = await fetch(`${base}${url}`, {
      method: method || 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (status) assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  const admin = (await request('/auth/login', 'POST', { email: 'admin@teste.local', senha: 'senha-teste-123' }, 200)).token;
  await request('/usuarios', 'POST', { nome: 'Supervisor', email: 'sup@teste.local', senha: 'senha-sup-1234', role: 'supervisor' }, 201, admin);
  const sup = (await request('/auth/login', 'POST', { email: 'sup@teste.local', senha: 'senha-sup-1234' }, 200)).token;

  const envelope = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/proposal-approved.v1.example.json'), 'utf8'));
  // Supervisor nao importa (nem previa, nem direto).
  await request('/integracao/orcamentos/previas', 'POST', envelope, 403, sup);
  await request('/integracao/orcamentos/confirmar-direto', 'POST', envelope, 403, sup);
  // Admin faz a previa e confirma.
  const previa = await request('/integracao/orcamentos/previas', 'POST', envelope, 200, admin);
  assert.ok(previa.previewId);
  await request(`/integracao/orcamentos/previas/${previa.previewId}/confirmar`, 'POST', { hash: previa.hash }, 403, sup);
  const imp = await request(`/integracao/orcamentos/previas/${previa.previewId}/confirmar`, 'POST', { hash: previa.hash, costCenterId: null }, 201, admin);
  const obra = imp.costCenterId;
  assert.ok(obra);

  await request(`/centros-custo/${obra}/medicoes`, 'POST', { type: 'labor', periodStart: '2026-09-01', periodEnd: '2026-09-07', teamHours: 12 }, 201, admin);
  await request(`/centros-custo/${obra}/medicoes`, 'POST', { type: 'contract', measurementNumber: 1, periodStart: '2026-09-01', periodEnd: '2026-09-15', measuredAmount: 500 }, 201, admin);
  const med = await request(`/centros-custo/${obra}/medicoes`, 'GET', undefined, 200, sup);
  assert.equal(med.labor[0].period_start, '2026-09-01');
  assert.equal(med.labor[0].period_end, '2026-09-07');
  assert.equal(med.contracts[0].period_end, '2026-09-15');
  assert.equal(med.labor[0].created_by_name, 'Administrador');
  assert.equal(med.contracts[0].created_by_name, 'Administrador');
  // O supervisor legado vira tecnico, que registra horas e medicoes (p12). Financeiro nao.
  await request(`/centros-custo/${obra}/medicoes`, 'POST', { type: 'labor', periodStart: '2026-09-08', periodEnd: '2026-09-14', teamHours: 5 }, 201, sup);
  await getDb().query("UPDATE users SET suite_role='financeiro' WHERE email=$1", ['sup@teste.local']);
  await request(`/centros-custo/${obra}/medicoes`, 'POST', { type: 'labor', periodStart: '2026-09-15', periodEnd: '2026-09-21', teamHours: 5 }, 403, sup);
});
