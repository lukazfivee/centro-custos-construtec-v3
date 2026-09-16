const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Fase 3 - Apropriação de Custos, Orçado vs. Realizado e Medições', async context => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-budget-comp-test-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'budget-comp-test-secret-at-least-32-chars';
  process.env.ADMIN_INITIAL_PASSWORD = 'budget-test-123';
  process.env.ADMIN_INITIAL_EMAIL = 'budget-comp@teste.local';

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
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
  const db = getDb();

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

  let auth = (await request('/auth/login', 'POST', { email: 'budget-comp@teste.local', senha: 'budget-test-123' }, 200, '')).token;

  // Carregar fixture normativa
  const fixturePath = path.resolve(__dirname, '../../INTEGRAÇÃO-ORÇAMENTOS-CENTRO V3/contracts/proposal-approved.v1.example.json');
  const officialEnvelope = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  let importResult;
  let costCenterId;
  let contractId;
  let controlItemId;

  await context.test('1. Ingestão inicial de baseline canônica e consulta de contratos/baselines', async () => {
    importResult = await request('/integracao/orcamentos/confirmar-direto', 'POST', officialEnvelope, 201);
    costCenterId = importResult.costCenterId;
    contractId = importResult.contractId;

    const baselines = await request(`/centros-custo/${costCenterId}/baselines`, 'GET', undefined, 200);
    assert.equal(baselines.length, 1);
    assert.equal(baselines[0].version, 0);
    assert.equal(baselines[0].is_current, true);
    assert.equal(Number(baselines[0].contract_value), 3450.00);
    assert.equal(Number(baselines[0].base_cost), 2760.00);
  });

  await context.test('2. Orçado vs. Realizado inicial: saldo integral, zero despesas e zero horas consumidas', async () => {
    const comp = await request(`/centros-custo/${costCenterId}/orcado-realizado`, 'GET', undefined, 200);
    assert.equal(comp.hasBudget, true);
    assert.equal(comp.summary.contractValue, 3450.00);
    assert.equal(comp.summary.baseCost, 2760.00);
    assert.equal(comp.summary.realizedCost, 0);
    assert.equal(comp.summary.balance, 2760.00);
    assert.equal(comp.summary.isOverBudget, false);
    assert.equal(comp.laborHours.planned, 88.00);
    assert.equal(comp.laborHours.consumed, 0);
    assert.equal(comp.items.length, 2); // 1 material + 1 labor

    controlItemId = comp.items[0].controlItemId;
    assert.ok(controlItemId);
  });

  let transactionId;
  let allocationId;

  await context.test('3. Apropriação de despesa a item de controle: atualiza realizado, saldo e curva ABC', async () => {
    const categories = await request('/categorias');
    const categoryId = categories[0].id;
    const tx = await request('/lancamentos', 'POST', {
      tipo: 'despesa',
      cost_center_id: costCenterId,
      category_id: categoryId,
      descricao: 'Compra de Porcelanato 60x60',
      valor: 450.00,
      data: '2026-09-06',
      status_financeiro: 'liquidado',
    }, 201);
    transactionId = tx.id;

    // Apropriar no item de controle
    const allocRes = await request(`/centros-custo/${costCenterId}/apropriacoes`, 'POST', {
      transactionId,
      amount: 450.00,
      contractId,
      controlItemId,
      quantity: 45.0,
      unit: 'm²',
      notes: 'Lote 1 entrega parcial',
    }, 201);

    assert.equal(allocRes.mappingStatus, 'mapped');
    allocationId = allocRes.id;

    // Verificar recálculo de Orçado vs Realizado
    const comp = await request(`/centros-custo/${costCenterId}/orcado-realizado`, 'GET', undefined, 200);
    assert.equal(comp.summary.realizedCost, 450.00);
    assert.equal(comp.summary.balance, 2310.00); // 2760 - 450
    assert.equal(comp.summary.burnRatePercent, 16.3); // 450 / 2760 = 16.3%

    // O item apropriado deve ter realizedCost = 450
    const item = comp.items.find(i => i.controlItemId === controlItemId);
    assert.equal(item.realizedCost, 450.00);
    assert.equal(item.balance, 550.00); // 1000 orçado - 450 realizado

    // Deve constar na Faixa A da Curva ABC
    assert.equal(comp.abcCurve.a.length, 1);
    assert.equal(comp.abcCurve.a[0].controlItemId, controlItemId);
  });

  await context.test('4. Despesa não mapeada: entra no total da obra e fica disponível para associação', async () => {
    const categories = await request('/categorias');
    const categoryId = categories[0].id;
    const tx = await request('/lancamentos', 'POST', {
      tipo: 'despesa',
      cost_center_id: costCenterId,
      category_id: categoryId,
      descricao: 'Frete e descarga não mapeados',
      valor: 150.00,
      data: '2026-09-06',
      status_financeiro: 'liquidado',
    }, 201);

    // Criar alocação não mapeada
    const unmappedAlloc = await request(`/centros-custo/${costCenterId}/apropriacoes`, 'POST', {
      transactionId: tx.id,
      amount: 150.00,
      notes: 'Aguardando classificação do gestor',
    }, 201);
    assert.equal(unmappedAlloc.mappingStatus, 'unmapped');

    // Verificar comparativo: total realizado = 450 + 150 = 600
    const comp = await request(`/centros-custo/${costCenterId}/orcado-realizado`, 'GET', undefined, 200);
    assert.equal(comp.summary.realizedCost, 600.00);
    assert.equal(comp.summary.realizedMappedCost, 450.00);
    assert.equal(comp.summary.realizedUnmappedCost, 150.00);
    assert.equal(comp.unmapped.count, 1);

    // Listar apropriações
    const allAllocations = await request(`/centros-custo/${costCenterId}/apropriacoes`, 'GET', undefined, 200);
    assert.equal(allAllocations.length, 2);

    // Agora mapear a despesa que estava não mapeada
    await request(`/centros-custo/${costCenterId}/apropriacoes`, 'POST', {
      allocationId: unmappedAlloc.id,
      contractId,
      controlItemId,
      notes: 'Classificado como custo acessório do porcelanato',
    }, 200);

    // Recalcular: agora 0 não mapeados e 600 mapeados no item
    const compAfter = await request(`/centros-custo/${costCenterId}/orcado-realizado`, 'GET', undefined, 200);
    assert.equal(compAfter.summary.realizedCost, 600.00);
    assert.equal(compAfter.summary.realizedMappedCost, 600.00);
    assert.equal(compAfter.summary.realizedUnmappedCost, 0);
    assert.equal(compAfter.unmapped.count, 0);
  });

  await context.test('5. Medições de mão de obra e medições contratuais ao cliente', async () => {
    // Registrar medição de 44 horas de mão de obra
    const laborItem = (await request(`/centros-custo/${costCenterId}/orcado-realizado`, 'GET', undefined, 200))
      .items.find(i => i.kind === 'labor');

    const laborMeas = await request(`/centros-custo/${costCenterId}/medicoes`, 'POST', {
      type: 'labor',
      contractId,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-15',
      teamHours: 44.0,
      costAmount: 880.00,
      lines: [
        { controlItemId: laborItem.controlItemId, teamHours: 44.0, costAmount: 880.00, evidenceRef: 'Diário de obra #12' }
      ],
      notes: '1ª Quinzena - Alvenaria e Revestimento',
    }, 201);

    assert.ok(laborMeas.id);

    // Consultar Orçado vs Realizado: horas consumidas = 44, saldo de horas = 44
    const comp = await request(`/centros-custo/${costCenterId}/orcado-realizado`, 'GET', undefined, 200);
    assert.equal(comp.laborHours.planned, 88.00);
    assert.equal(comp.laborHours.consumed, 44.00);
    assert.equal(comp.laborHours.balance, 44.00);

    // Registrar medição contratual ao cliente (faturamento de R$ 1.500)
    const contractMeas = await request(`/centros-custo/${costCenterId}/medicoes`, 'POST', {
      type: 'contract',
      contractId,
      measurementNumber: 1,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-15',
      measuredAmount: 1500.00,
      notes: 'Primeira medição liberada pelo fiscal',
    }, 201);

    assert.ok(contractMeas.id);
    assert.equal(contractMeas.measurementNumber, 1);

    // Listar medições
    const measurements = await request(`/centros-custo/${costCenterId}/medicoes`, 'GET', undefined, 200);
    assert.equal(measurements.labor.length, 1);
    assert.equal(measurements.contracts.length, 1);
    assert.equal(Number(measurements.contracts[0].measured_amount), 1500.00);
  });
});
