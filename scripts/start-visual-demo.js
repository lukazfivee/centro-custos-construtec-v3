const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-visual-demo-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempDir, 'data');
  process.env.PORT = '3456';
  process.env.HOST = '127.0.0.1';
  process.env.JWT_SECRET = 'demo-visual-secret-32-characters-minimum';
  process.env.ADMIN_INITIAL_EMAIL = 'admin@construtec.local';
  process.env.ADMIN_INITIAL_PASSWORD = 'admin-demo-123';

  const { initializeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  const { confirmImport } = require('../services/budgets/budgetImportService');
  const { recordLaborMeasurement, recordContractMeasurement } = require('../services/budgets/budgetMeasurements');

  console.log('Inicializando banco de demonstração visual...');
  await initializeDatabase();
  const db = getDb();

  // 1. Carregar e importar proposta canônica
  const fixturePath = path.resolve(__dirname, '../../INTEGRAÇÃO-ORÇAMENTOS-CENTRO V3/contracts/proposal-approved.v1.example.json');
  const envelope = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  console.log('Importando baseline orçamentária...');
  const importResult = await confirmImport(db, {
    envelope,
    confirmedHash: envelope.payloadSha256,
  }, 1);

  const costCenterId = importResult.costCenterId;
  const contractId = importResult.contractId;

  // 2. Iniciar servidor Express
  const app = createApp();
  const server = app.listen(3456, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:3456/api';

  // 3. Autenticar via API
  const loginRes = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@construtec.local', senha: 'admin-demo-123' }),
  });
  const { token } = await loginRes.json();
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 4. Obter categoria
  const catRes = await fetch(`${base}/categorias`, { headers: authHeaders });
  const categories = await catRes.json();
  const catId = categories[0].id;

  // 5. Inserir despesa de material e apropriar no item de controle
  console.log('Criando lançamento de Porcelanato...');
  const tx1Res = await fetch(`${base}/lancamentos`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      tipo: 'despesa',
      cost_center_id: costCenterId,
      category_id: catId,
      descricao: 'Compra de Porcelanato 60x60 - Lote 1',
      valor: 450.00,
      data: '2026-09-06',
      status_financeiro: 'liquidado',
    }),
  });
  const tx1 = await tx1Res.json();

  const items = await db.query('SELECT id, kind, name FROM budget_control_items WHERE contract_id = $1', [contractId]);
  const materialItem = items.rows.find(i => i.kind === 'material');
  const laborItem = items.rows.find(i => i.kind === 'labor');

  await fetch(`${base}/centros-custo/${costCenterId}/apropriacoes`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      transactionId: tx1.id,
      amount: 450.00,
      contractId,
      controlItemId: materialItem.id,
      quantity: 45.0,
      unit: 'm²',
      notes: 'Primeira entrega no canteiro',
    }),
  });

  // 6. Inserir despesa não mapeada
  console.log('Criando lançamento não mapeado...');
  const tx2Res = await fetch(`${base}/lancamentos`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      tipo: 'despesa',
      cost_center_id: costCenterId,
      category_id: catId,
      descricao: 'Frete e Caçamba de Entulho',
      valor: 150.00,
      data: '2026-09-06',
      status_financeiro: 'liquidado',
    }),
  });
  const tx2 = await tx2Res.json();

  await fetch(`${base}/centros-custo/${costCenterId}/apropriacoes`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      transactionId: tx2.id,
      amount: 150.00,
      notes: 'Despesa acessória pendente de classificação',
    }),
  });

  // 7. Inserir medição de mão de obra (44h)
  console.log('Criando medição de mão de obra...');
  await recordLaborMeasurement(db, {
    contractId,
    costCenterId,
    periodStart: '2026-09-01',
    periodEnd: '2026-09-15',
    teamHours: 44.0,
    costAmount: 880.00,
    lines: [
      { controlItemId: laborItem.id, teamHours: 44.0, costAmount: 880.00, evidenceRef: 'Diário de Obras Quinzena 1' }
    ],
    userId: 1,
    notes: '1ª Quinzena - Execução de Revestimento',
  });
  // 8. Inserir medição contratual de cliente (Medição 01 - R$ 1.250,00)
  console.log('Criando medição contratual ao cliente...');
  await recordContractMeasurement(db, {
    contractId,
    costCenterId,
    measurementNumber: 1,
    periodStart: '2026-09-01',
    periodEnd: '2026-09-15',
    measuredAmount: 1250.00,
    userId: 1,
    notes: '1ª Medição de Avanço Físico - Fundação e Alvenaria',
  });
  console.log('\n========================================');
  console.log('DEMO_SERVER_READY: http://127.0.0.1:3456');
  console.log('USER: admin@construtec.local');
  console.log('PASSWORD: admin-demo-123');
  console.log(`COST_CENTER_ID: ${costCenterId}`);
  console.log('========================================\n');
}

main().catch(err => {
  console.error('Falha no servidor de demonstração:', err);
  process.exit(1);
});
