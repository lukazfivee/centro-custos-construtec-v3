const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Cockpit Consolidado da Carteira de Obras (Multi-Obras)', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-portf-test-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'portf-test-secret-at-least-32-chars';
  process.env.ADMIN_INITIAL_PASSWORD = 'portf-test-123';
  process.env.ADMIN_INITIAL_EMAIL = 'portf-test@teste.local';

  const { initializeDatabase, closeDatabase } = require('../db');
  const { createApp } = require('../server');

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

  async function request(route, method = 'GET', body, status = 200, token = auth) {
    const response = await fetch(base + route, {
      method,
      headers: {
        Authorization: `Bearer ${token || ''}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    assert.equal(response.status, status, text);
    return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
  }

  let auth = (await request('/auth/login', 'POST', { email: 'portf-test@teste.local', senha: 'portf-test-123' }, 200, '')).token;

  const fixturePath = path.resolve(__dirname, '../../INTEGRAÇÃO-ORÇAMENTOS-CENTRO V3/contracts/proposal-approved.v1.example.json');
  const officialEnvelope = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  let costCenterId;
  let contractId;

  await context.test('1. Ingestão de obra com baseline e cálculo do consolidado da carteira', async () => {
    const importResult = await request('/integracao/orcamentos/confirmar-direto', 'POST', officialEnvelope, 201);
    costCenterId = importResult.costCenterId;
    contractId = importResult.contractId;

    const summaryData = await request('/centros-custo/portfolio-summary', 'GET', undefined, 200);
    const p = summaryData.portfolio;

    assert.ok(p);
    assert.ok(p.totalCenters >= 1);
    assert.equal(p.integratedWorksCount, 1);
    assert.equal(p.totalContractValue, 3450.00);
    assert.equal(p.totalBaseCost, 2760.00);
    assert.equal(p.totalRealizedCost, 0);
    assert.equal(p.totalBalance, 2760.00);
    assert.equal(p.burnRatePercent, 0);
    assert.equal(p.isOverBudget, false);
    assert.equal(p.atRiskCount, 0);
  });

  await context.test('2. Apontamento de despesas e medições atualizam os indicadores globais', async () => {
    const categories = await request('/categorias');
    const categoryId = categories[0].id;

    // Criar despesa de R$ 2.400 (que representa >85% de 2.760, ativando risco)
    await request('/lancamentos', 'POST', {
      tipo: 'despesa',
      cost_center_id: costCenterId,
      category_id: categoryId,
      descricao: 'Estruturas metálicas de alta relevância',
      valor: 2400.00,
      data: '2026-03-10',
      status_financeiro: 'liquidado',
    }, 201);

    // Apontar medição de mão de obra (40 horas)
    await request(`/centros-custo/${costCenterId}/medicoes`, 'POST', {
      type: 'labor',
      periodStart: '2026-03-01',
      periodEnd: '2026-03-15',
      teamHours: 40.0,
      notes: 'Montagem estrutural',
    }, 201);

    // Apontar medição contratual de faturamento ao cliente (R$ 2.000)
    await request(`/centros-custo/${costCenterId}/medicoes`, 'POST', {
      type: 'contract',
      measurementNumber: 1,
      periodStart: '2026-03-01',
      periodEnd: '2026-03-15',
      measuredAmount: 2000.00,
    }, 201);

    const updated = await request('/centros-custo/portfolio-summary', 'GET', undefined, 200);
    const p = updated.portfolio;

    assert.equal(p.totalRealizedCost, 2400.00);
    assert.equal(p.totalBalance, 360.00); // 2760 - 2400
    assert.equal(p.laborHours.consumed, 40.0);
    assert.equal(p.laborHours.planned, 88.0);
    assert.equal(p.clientBilling.totalBilled, 2000.00);
    assert.equal(p.clientBilling.balanceToBill, 1450.00);

    // Como 2400 / 2760 = 86.9% (> 80%), a obra deve constar na lista de risco
    assert.equal(p.atRiskCount, 1);
    assert.equal(p.atRiskCenters[0].id, costCenterId);
    assert.equal(p.atRiskCenters[0].burnRate, 87.0);
    assert.equal(p.atRiskCenters[0].isOverBudget, false);
  });

  await context.test('3. Proteção e autenticação', async () => {
    const unauth = await fetch(`${base}/centros-custo/portfolio-summary`);
    assert.equal(unauth.status, 401);
  });
});
