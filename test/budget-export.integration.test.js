const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Exportação Executiva Orçado vs. Realizado (CSV e Curva ABC)', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-budget-export-test-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'budget-export-secret-at-least-32-chars';
  process.env.ADMIN_INITIAL_PASSWORD = 'budget-test-123';
  process.env.ADMIN_INITIAL_EMAIL = 'budget-export@teste.local';

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

  let auth = (await request('/auth/login', 'POST', { email: 'budget-export@teste.local', senha: 'budget-test-123' }, 200, '')).token;

  // Carregar fixture normativa
  const fixturePath = path.resolve(__dirname, '../../INTEGRAÇÃO-ORÇAMENTOS-CENTRO V3/contracts/proposal-approved.v1.example.json');
  const officialEnvelope = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  let costCenterId;
  let contractId;
  let controlItemId;

  await context.test('1. Ingestão de proposta e configuração de despesas para exportação', async () => {
    const importResult = await request('/integracao/orcamentos/confirmar-direto', 'POST', officialEnvelope, 201);
    costCenterId = importResult.costCenterId;
    contractId = importResult.contractId;

    const compInitial = await request(`/centros-custo/${costCenterId}/orcado-realizado`, 'GET', undefined, 200);
    assert.ok(compInitial.items.length > 0);
    controlItemId = compInitial.items[0].controlItemId;

    const categories = await request('/categorias');
    const categoryId = categories[0].id;

    // Lançamento 1: Despesa vinculada diretamente ao item de controle (com apropriação mapeada)
    const txMapped = await request('/lancamentos', 'POST', {
      tipo: 'despesa',
      cost_center_id: costCenterId,
      category_id: categoryId,
      descricao: 'Aquisição de tubulações Tigre',
      valor: 450.00,
      data: '2026-03-10',
      status_financeiro: 'liquidado',
    }, 201);

    await request(`/centros-custo/${costCenterId}/apropriacoes`, 'POST', {
      transactionId: txMapped.id,
      amount: 450.00,
      contractId,
      controlItemId,
      quantity: 45.0,
      unit: 'm',
      notes: 'Lote 1 entrega de tubulações',
    }, 201);

    // Lançamento 2: Despesa não mapeada (sem vínculo ao item de controle)
    const txUnmapped = await request('/lancamentos', 'POST', {
      tipo: 'despesa',
      cost_center_id: costCenterId,
      category_id: categoryId,
      descricao: 'Serviço avulso de caçamba de entulho',
      valor: 150.00,
      data: '2026-03-12',
      status_financeiro: 'liquidado',
    }, 201);

    await request(`/centros-custo/${costCenterId}/apropriacoes`, 'POST', {
      transactionId: txUnmapped.id,
      amount: 150.00,
      notes: 'Despesa não mapeada aguardando classificação',
    }, 201);
  });

  await context.test('2. Exportação de CSV com BOM UTF-8, delimitador ";", cabeçalhos e formatação pt-BR', async () => {
    const res = await fetch(`${base}/centros-custo/${costCenterId}/orcado-realizado/csv`, {
      headers: { Authorization: `Bearer ${auth}` },
    });

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv;\s*charset=utf-8/i);
    assert.match(res.headers.get('content-disposition'), /attachment;\s*filename="orcado-vs-realizado-.*\.csv"/i);

    const rawBuffer = Buffer.from(await res.arrayBuffer());
    // Verificar BOM UTF-8 (\uFEFF -> 0xEF, 0xBB, 0xBF)
    assert.equal(rawBuffer[0], 0xEF);
    assert.equal(rawBuffer[1], 0xBB);
    assert.equal(rawBuffer[2], 0xBF);

    const csvContent = rawBuffer.toString('utf8');

    // Verificar seções institucionais e financeiras
    assert.ok(csvContent.includes('CONSTRUTEC ENGENHARIA — RELATÓRIO DE ORÇADO VS. REALIZADO'));
    assert.ok(csvContent.includes('RESUMO EXECUTIVO'));
    assert.ok(csvContent.includes('Valor Contratual;3450,00'));
    assert.ok(csvContent.includes('Custo Base Orçado;2760,00'));
    assert.ok(csvContent.includes('Realizado Líquido;600,00'));
    assert.ok(csvContent.includes('Despesas Não Mapeadas;150,00'));

    // Verificar cabeçalho da tabela analítica com ponto-e-vírgula
    assert.ok(csvContent.includes('Código;Insumo / Descrição;Tipo;Categoria;Unidade;Qtd Orçada;Custo Unit. (R$);Custo Total Orçado (R$);Realizado Líquido (R$);Desvio (R$);Desvio (%);Saldo (R$);Classe ABC;Status'));

    // Verificar classificação da Curva ABC presente
    assert.ok(csvContent.includes(';A;') || csvContent.includes(';B;') || csvContent.includes(';C;'));

    // Verificar seção de despesas não mapeadas
    assert.ok(csvContent.includes('LANÇAMENTOS NÃO MAPEADOS (SEM VÍNCULO AO ORÇAMENTO)'));
    assert.ok(csvContent.includes('Serviço avulso de caçamba de entulho;150,00'));
  });

  await context.test('3. Validação de segurança e rotas de erro', async () => {
    // Acesso não autenticado
    const unauthRes = await fetch(`${base}/centros-custo/${costCenterId}/orcado-realizado/csv`);
    assert.equal(unauthRes.status, 401);

    // Centro inexistente
    const notFoundRes = await fetch(`${base}/centros-custo/999999/orcado-realizado/csv`, {
      headers: { Authorization: `Bearer ${auth}` },
    });
    assert.equal(notFoundRes.status, 404);
  });
});
