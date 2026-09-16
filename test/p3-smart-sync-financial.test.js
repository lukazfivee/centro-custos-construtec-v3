const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

test('SmartSync com transporte de rateios, aprovações e guards de competência fechada', async context => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-sync-financial-test-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'sync-financial-test-secret-at-least-32-chars';
  process.env.ADMIN_INITIAL_PASSWORD = 'sync-test-123';
  process.env.ADMIN_INITIAL_EMAIL = 'sync@teste.local';

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

  let auth = (await request('/auth/login', 'POST', { email: 'sync@teste.local', senha: 'sync-test-123' }, 200, '')).token;
  const category = (await request('/categorias')).find(x => x.nome === 'Material').id;

  // 1. Criar duas obras e um lançamento com rateio 60/40
  const centerA = (await request('/centros-custo', 'POST', { codigo: 'SYNC-A', nome: 'Obra Alfa', orcamento: 1000 }, 201)).id;
  const centerB = (await request('/centros-custo', 'POST', { codigo: 'SYNC-B', nome: 'Obra Beta', orcamento: 1000 }, 201)).id;

  const entry = await request('/lancamentos', 'POST', {
    tipo: 'despesa',
    cost_center_id: centerA,
    category_id: category,
    descricao: 'Compra de Insumos Compartilhados',
    valor: 100,
    data: '2026-09-06',
    status_financeiro: 'liquidado',
  }, 201);

  await request(`/produtividade/rateio/${entry.id}`, 'PUT', {
    rateios: [
      { cost_center_id: centerA, valor: 60, observacao: '60% Alfa' },
      { cost_center_id: centerB, valor: 40, observacao: '40% Beta' },
    ],
  }, 200);

  // 2. Exportar pacote SmartSync e validar presença de rateio e aprovação
  const pack = await request('/sincronizacao-inteligente/exportar', 'GET');
  assert.equal(pack.formatVersion, 3);
  assert.ok(Array.isArray(pack.payload.transactions));

  const syncedTx = pack.payload.transactions.find(t => t.publicId === entry.public_id);
  assert.ok(syncedTx, 'Lançamento deve estar no pacote');
  assert.equal(syncedTx.approvalStatus, 'aprovado');
  assert.ok(Array.isArray(syncedTx.allocations));
  assert.equal(syncedTx.allocations.length, 2);

  const totalAllocated = syncedTx.allocations.reduce((sum, a) => sum + Number(a.amount), 0);
  assert.equal(totalAllocated, 100);

  // 3. Teste de reimportação com mês fechado gerando conflito
  // Fecha a competência 2026-09 no banco
  await db.query('INSERT INTO monthly_closings (year, month, closed_by) VALUES (2026, 9, 1)');

  // Monta pacote com nova revisão modificada
  const modifiedPack = JSON.parse(JSON.stringify(pack));
  const txToModify = modifiedPack.payload.transactions.find(t => t.publicId === entry.public_id);
  txToModify.revision = Number(txToModify.revision || 1) + 1;
  txToModify.description = 'Tentativa de alteração em mês fechado';
  txToModify.lastModifiedInstanceId = crypto.randomUUID();
  modifiedPack.payloadHash = require('../services/smartSync').stableHash(modifiedPack.payload);
  modifiedPack.packageId = crypto.randomUUID();

  const importResult = await request('/sincronizacao-inteligente/importar', 'POST', {
    conteudo: JSON.stringify(modifiedPack),
    nomeArquivo: 'teste-fechado.ccsync',
  }, 200);

  assert.equal(importResult.resumo.conflitos, 1, 'Deve gerar conflito ao importar alteração em mês fechado');
  assert.equal(importResult.resumo.atualizados, 0, 'Não deve atualizar lançamento em mês fechado');

  const conflitos = await request('/sincronizacao-inteligente/conflitos', 'GET');
  const conf = conflitos.find(c => c.entity_public_id === entry.public_id);
  assert.ok(conf, 'Conflito deve estar registrado');
  assert.match(conf.reason, /Competência/);

  // 4. Reabrir o mês e resolver o conflito
  await db.query('DELETE FROM monthly_closings WHERE year=2026 AND month=9');

  const resolveResult = await request(`/sincronizacao-inteligente/conflitos/${conf.id}/resolver`, 'POST', {
    escolha: 'recebido',
  }, 200);

  assert.ok(resolveResult.ok);
  assert.match(resolveResult.mensagem, /versão recebida/);

  // Verificar que os dados foram atualizados e os rateios foram preservados
  const updatedEntry = (await db.query('SELECT * FROM transactions WHERE public_id=$1', [entry.public_id])).rows[0];
  assert.equal(updatedEntry.description, 'Tentativa de alteração em mês fechado');

  const allocRows = (await db.query('SELECT * FROM transaction_allocations WHERE transaction_id=$1', [updatedEntry.id])).rows;
  assert.equal(allocRows.length, 2);
  const sumAfter = allocRows.reduce((sum, a) => sum + Number(a.amount), 0);
  assert.equal(sumAfter, 100);
});
