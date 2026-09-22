const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-curves-test-'));
process.env.DATABASE_URL = '';
process.env.PGLITE_DATA_DIR = path.join(tempDir, 'data');
process.env.JWT_SECRET = 'test-jwt-secret-with-minimum-32-chars-long';
process.env.ADMIN_INITIAL_EMAIL = 'curves@teste.local';
process.env.ADMIN_INITIAL_PASSWORD = 'CurvesPassword123!';

const { initializeDatabase, getDb, closeDatabase } = require('../db');
const { createApp } = require('../server');
const { confirmImport } = require('../services/budgets/budgetImportService');
const { recordContractMeasurement } = require('../services/budgets/budgetMeasurements');
const { getCostCenterCurveS } = require('../services/budgets/budgetCurveS');

test.describe('Análise Temporal: Curva S Físico-Financeira e Previsão de Término (EAC)', () => {
  let app;
  let server;
  let baseUrl;
  let db;
  let adminToken;
  let costCenterId;
  let contractId;

  test.before(async () => {
    await initializeDatabase();
    db = getDb();
    app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}/api`;
        resolve();
      });
    });

    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'curves@teste.local', senha: 'CurvesPassword123!' }),
    });
    const loginData = await loginRes.json();
    adminToken = loginData.token;
  });

  test.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('1. Ingestão de proposta, setup de despesas e medições físicas', async () => {
    const fixturePath = path.resolve(__dirname, 'fixtures/proposal-approved.v1.example.json');
    const envelope = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    const result = await confirmImport(db, {
      envelope,
      confirmedHash: envelope.payloadSha256,
    }, 1);

    costCenterId = result.costCenterId;
    contractId = result.contractId;
    assert.ok(costCenterId);
    assert.ok(contractId);

    // Inserir despesa e apropriar com reconhecimento de custo
    const catRes = await fetch(`${baseUrl}/categorias`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const categories = await catRes.json();
    const catId = categories[0].id;

    const txRes = await fetch(`${baseUrl}/lancamentos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo: 'despesa',
        cost_center_id: costCenterId,
        category_id: catId,
        descricao: 'Compra de Revestimento e Argamassa',
        valor: 550.00,
        data: '2026-09-02',
        status_financeiro: 'liquidado',
      }),
    });
    const tx = await txRes.json();

    const itemsRes = await db.query('SELECT id FROM budget_control_items WHERE contract_id = $1 LIMIT 1', [contractId]);
    const controlItemId = itemsRes.rows[0].id;

    await fetch(`${baseUrl}/centros-custo/${costCenterId}/apropriacoes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactionId: tx.id,
        amount: 550.00,
        contractId,
        controlItemId,
      }),
    });

    // Registrar medição contratual ao cliente (avanço físico de R$ 1.000,00)
    await recordContractMeasurement(db, {
      contractId,
      costCenterId,
      measurementNumber: 1,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-15',
      measuredAmount: 1000.00,
      userId: 1,
      notes: '1ª Medição de Alvenaria e Revestimento',
    });
  });

  test('2. Cálculo matemático da Curva S e Previsão de Término (EVM / EAC)', async () => {
    const data = await getCostCenterCurveS(db, costCenterId);

    assert.equal(data.costCenterId, costCenterId);
    assert.ok(Array.isArray(data.timeline));
    assert.ok(data.timeline.length >= 6);

    // Validação da curva S prevista: evolução estritamente crescente
    let lastCum = 0;
    for (const t of data.timeline) {
      assert.ok(t.plannedCumulative >= lastCum, 'Curva prevista acumulada deve ser não decrescente');
      lastCum = t.plannedCumulative;
    }
    // O último mês previsto deve atingir o Custo Base total (BAC)
    assert.equal(data.timeline[data.timeline.length - 1].plannedCumulative, data.center.baseCost);

    // Validação dos indicadores EVM
    const evm = data.evm;
    assert.equal(evm.bac, 2760); // Custo base da proposta
    assert.equal(evm.ac, 550); // Custo real realizado
    assert.ok(evm.ev > 0, 'Earned value deve ser positivo devido à medição física');
    assert.ok(evm.cpi > 0, 'Cost Performance Index deve ser calculado');
    assert.ok(evm.eac > 0, 'Estimate At Completion deve ser projetado');
    assert.equal(typeof evm.vac, 'number');
    assert.ok(Array.isArray(data.hypotheses));
    assert.equal(data.hypotheses.length, 4);
  });

  test('3. Endpoint GET /api/centros-custo/:id/curva-s e controle de acesso', async () => {
    // 401 sem autenticação
    const unauthRes = await fetch(`${baseUrl}/centros-custo/${costCenterId}/curva-s`);
    assert.equal(unauthRes.status, 401);

    // 200 com token de autenticação
    const res = await fetch(`${baseUrl}/centros-custo/${costCenterId}/curva-s`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.costCenterId, costCenterId);
    assert.ok(data.evm.eac > 0);
    assert.ok(data.timeline.length >= 6);
  });
});
