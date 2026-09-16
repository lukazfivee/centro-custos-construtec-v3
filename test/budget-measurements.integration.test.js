const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Medições de Campo: Mão de Obra e Medição Contratual ao Cliente', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-meas-test-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'meas-test-secret-at-least-32-chars';
  process.env.ADMIN_INITIAL_PASSWORD = 'meas-test-123';
  process.env.ADMIN_INITIAL_EMAIL = 'meas-test@teste.local';

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

  let auth = (await request('/auth/login', 'POST', { email: 'meas-test@teste.local', senha: 'meas-test-123' }, 200, '')).token;

  const fixturePath = path.resolve(__dirname, '../../INTEGRAÇÃO-ORÇAMENTOS-CENTRO V3/contracts/proposal-approved.v1.example.json');
  const officialEnvelope = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  let costCenterId;
  let contractId;

  await context.test('1. Ingestão inicial de baseline orçamentária e estado inicial de medições', async () => {
    const importResult = await request('/integracao/orcamentos/confirmar-direto', 'POST', officialEnvelope, 201);
    costCenterId = importResult.costCenterId;
    contractId = importResult.contractId;

    const initialMeas = await request(`/centros-custo/${costCenterId}/medicoes`, 'GET', undefined, 200);
    assert.equal(initialMeas.labor.length, 0);
    assert.equal(initialMeas.contracts.length, 0);

    const comp = await request(`/centros-custo/${costCenterId}/orcado-realizado`, 'GET', undefined, 200);
    assert.equal(comp.laborHours.planned, 88.0);
    assert.equal(comp.laborHours.consumed, 0);
  });

  await context.test('2. Registro de medição de mão de obra (horas de equipe)', async () => {
    // Registrar sem passar contractId explicitamente (deve auto-resolver a partir do ativo)
    const laborRes = await request(`/centros-custo/${costCenterId}/medicoes`, 'POST', {
      type: 'labor',
      periodStart: '2026-03-01',
      periodEnd: '2026-03-07',
      teamHours: 35.5,
      notes: '1ª semana de instalações hidráulicas',
    }, 201);

    assert.ok(laborRes.id);
    assert.equal(laborRes.teamHours, 35.5);

    // Consulta de medições
    const meas = await request(`/centros-custo/${costCenterId}/medicoes`, 'GET', undefined, 200);
    assert.equal(meas.labor.length, 1);
    assert.equal(Number(meas.labor[0].team_hours), 35.5);
    assert.equal(meas.labor[0].notes, '1ª semana de instalações hidráulicas');

    // Orçado vs. Realizado deve refletir as 35.5h consumidas
    const comp = await request(`/centros-custo/${costCenterId}/orcado-realizado`, 'GET', undefined, 200);
    assert.equal(comp.laborHours.consumed, 35.5);
    assert.equal(comp.laborHours.planned, 88.0);
  });

  await context.test('3. Registro de medição contratual ao cliente (faturamento de avanço físico)', async () => {
    const contractRes = await request(`/centros-custo/${costCenterId}/medicoes`, 'POST', {
      type: 'contract',
      measurementNumber: 1,
      periodStart: '2026-03-01',
      periodEnd: '2026-03-15',
      measuredAmount: 1200.00,
      notes: 'Primeira medição quinzenal liberada pela fiscalização',
    }, 201);

    assert.ok(contractRes.id);
    assert.equal(contractRes.measurementNumber, 1);
    assert.equal(contractRes.measuredAmount, 1200.00);

    const meas = await request(`/centros-custo/${costCenterId}/medicoes`, 'GET', undefined, 200);
    assert.equal(meas.contracts.length, 1);
    assert.equal(Number(meas.contracts[0].measurement_number), 1);
    assert.equal(Number(meas.contracts[0].measured_amount), 1200.00);
  });

  await context.test('4. Validação de autenticação e proteção contra centro sem contrato', async () => {
    // Não autenticado
    const unauth = await fetch(`${base}/centros-custo/${costCenterId}/medicoes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'labor', periodStart: '2026-03-01', periodEnd: '2026-03-07', teamHours: 10 }),
    });
    assert.equal(unauth.status, 401);

    // Centro inexistente
    const notFound = await fetch(`${base}/centros-custo/999999/medicoes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'labor', periodStart: '2026-03-01', periodEnd: '2026-03-07', teamHours: 10 }),
    });
    assert.equal(notFound.status, 400);
  });
});
