const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('resumo de acompanhamento do contrato para o Orcamentos', async context => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-contract-summary-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'contract-summary-secret-at-least-32-chars';
  process.env.ADMIN_INITIAL_PASSWORD = 'summary-test-123';
  process.env.ADMIN_INITIAL_EMAIL = 'summary@teste.local';

  const { initializeDatabase, closeDatabase } = require('../db');
  const { createApp } = require('../server');
  const { toCents } = require('../services/budgets/budgetContractSummary');

  let server;
  context.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await initializeDatabase();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = (route, { method = 'GET', body, key, token } = {}) => fetch(base + route, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'X-Construtec-Integration-Key': key } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const login = await (await call('/auth/login', { method: 'POST', body: { email: 'summary@teste.local', senha: 'summary-test-123' } })).json();
  const envelope = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'proposal-approved.v1.example.json'), 'utf8'));
  const imported = await (await call('/integracao/orcamentos/confirmar-direto', { method: 'POST', body: envelope, token: login.token })).json();
  const localKey = 'construtec-internal-integration-secret-2026';

  const response = await call(`/integracao/orcamentos/contratos/${imported.contractId}/resumo`, { key: localKey });
  assert.equal(response.status, 200);
  const summary = await response.json();
  assert.equal(summary.hasBudget, true);
  assert.equal(summary.costCenterId, imported.costCenterId);
  assert.equal(summary.costCenterStatus, 'planejamento');
  assert.equal(summary.baseline.contractValueCents, 345000);
  assert.equal(summary.baseline.baseCostCents, 276000);
  assert.equal(summary.realizedCents, 0);
  assert.equal(summary.overBudget, false);
  assert.equal('items' in summary, false, 'sem linhas individuais');

  assert.equal((await call('/integracao/orcamentos/contratos/nao-existe/resumo', { key: localKey })).status, 404);
  assert.equal((await call(`/integracao/orcamentos/contratos/${imported.contractId}/resumo`, { key: 'x'.repeat(40) })).status, 401);

  assert.equal(toCents(0.285), 29);
  assert.equal(toCents(1.005), 101);
  assert.equal(toCents(2760), 276000);
  assert.equal(toCents(-1.005), -101);
});
