const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Orçado vs. Realizado expõe a data de aprovação da proposta em contract.approvedAt', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-approved-at-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'approved-at-test-secret-com-mais-de-32-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'approved-at-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'approved-at@teste.local';

  const { initializeDatabase, closeDatabase } = require('../db');
  const { createApp } = require('../server');

  let server;
  context.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await initializeDatabase();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function request(route, method = 'GET', body, token = '') {
    const response = await fetch(base + route, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }

  const login = await request('/auth/login', 'POST', { email: 'approved-at@teste.local', senha: 'approved-at-teste-123' });
  assert.equal(login.status, 200);
  const token = login.data.token;

  const withoutBudget = await request('/centros-custo', 'POST', { codigo: 'APR-000', nome: 'Obra sem orçamento', orcamento: 0, situacao: 'execucao' }, token);
  assert.equal(withoutBudget.status, 201);
  const comparisonWithoutBudget = await request(`/centros-custo/${withoutBudget.data.id}/orcado-realizado`, 'GET', undefined, token);
  assert.equal(comparisonWithoutBudget.data.hasBudget, false);
  assert.equal(comparisonWithoutBudget.data.contract, undefined);

  const fixturePath = path.resolve(__dirname, 'fixtures/proposal-approved.v1.example.json');
  const officialEnvelope = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const imported = await request('/integracao/orcamentos/confirmar-direto', 'POST', officialEnvelope, token);
  assert.equal(imported.status, 201);

  const comparison = await request(`/centros-custo/${imported.data.costCenterId}/orcado-realizado`, 'GET', undefined, token);
  assert.equal(comparison.status, 200);
  assert.equal(comparison.data.hasBudget, true);
  assert.ok(comparison.data.contract.approvedAt, 'contract.approvedAt deveria estar presente');
  assert.ok(
    String(comparison.data.contract.approvedAt).startsWith('2026-09-06T15:00:00'),
    `esperado prefixo 2026-09-06T15:00:00, recebido ${comparison.data.contract.approvedAt}`
  );
});
