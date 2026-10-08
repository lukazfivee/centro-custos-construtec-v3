const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Obra ou servico: tipo do centro de custo na API, no CSV e na importacao do Orcamentos', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-kind-test-'));
  process.env.DATABASE_URL = '';
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'cost-center-kind-test-secret-at-least-32-chars';
  process.env.ADMIN_INITIAL_PASSWORD = 'kind-test-123';
  process.env.ADMIN_INITIAL_EMAIL = 'kind@teste.local';

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  const { computeSha256, canonicalJsonStringify } = require('../services/budgets/budgetCanonical');

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
  const db = getDb();
  const KEY = { 'x-construtec-integration-key': 'construtec-internal-integration-secret-2026' };
  let auth = '';

  async function request(route, method = 'GET', body, status = 200, headers = {}) {
    const h = { 'Content-Type': 'application/json', ...headers };
    if (auth && !headers['x-construtec-integration-key']) h.Authorization = `Bearer ${auth}`;
    const response = await fetch(base + route, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    assert.equal(response.status, status, text);
    return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
  }

  function fixture(suffix) {
    const envelope = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/proposal-approved.v1.example.json'), 'utf8'));
    if (suffix) {
      envelope.payload.proposal.seriesId = `${envelope.payload.proposal.seriesId}-${suffix}`;
      envelope.payload.proposal.id = `${envelope.payload.proposal.id}-${suffix}`;
      envelope.payloadSha256 = computeSha256(canonicalJsonStringify(envelope.payload));
    }
    return envelope;
  }

  const kindOf = async (id) => (await db.query('SELECT kind FROM cost_centers WHERE id=$1', [id])).rows[0].kind;

  auth = (await request('/auth/login', 'POST', { email: 'kind@teste.local', senha: 'kind-test-123' })).token;

  let obraId;
  let servicoId;

  await context.test('cria obra (padrao) e servico; lista e detalhe devolvem o tipo', async () => {
    obraId = (await request('/centros-custo', 'POST', { codigo: 'OB-1', nome: 'Obra grande' }, 201)).id;
    servicoId = (await request('/centros-custo', 'POST', { codigo: 'SV-1', nome: 'Instalar camera', tipo: 'servico' }, 201)).id;
    const list = await request('/centros-custo');
    assert.equal(list.find((c) => c.id === obraId).tipo, 'obra');
    assert.equal(list.find((c) => c.id === servicoId).tipo, 'servico');
    const detail = await request(`/centros-custo/${servicoId}/detalhes`);
    assert.equal(detail.centro.tipo, 'servico');
  });

  await context.test('tipo invalido e recusado', async () => {
    await request('/centros-custo', 'POST', { codigo: 'X-1', nome: 'X', tipo: 'reforma' }, 400);
  });

  await context.test('filtro ?kind= na lista simples e paginada', async () => {
    const servicos = await request('/centros-custo?kind=servico');
    assert.deepEqual(servicos.map((c) => c.id), [servicoId]);
    const obras = await request('/centros-custo?kind=obra');
    assert.ok(obras.every((c) => c.tipo === 'obra'));
    assert.ok(obras.some((c) => c.id === obraId));
    const paged = await request('/centros-custo?kind=servico&pagina=1&limite=10');
    assert.equal(paged.paginacao.total, 1);
    assert.equal(paged.itens[0].id, servicoId);
    await request('/centros-custo?kind=qualquer', 'GET', undefined, 400);
  });

  await context.test('editar muda o tipo; editar sem tipo mantem o atual', async () => {
    await request(`/centros-custo/${obraId}`, 'PUT', { codigo: 'OB-1', nome: 'Obra grande', tipo: 'servico' });
    assert.equal(await kindOf(obraId), 'servico');
    await request(`/centros-custo/${obraId}`, 'PUT', { codigo: 'OB-1', nome: 'Obra grande renomeada' });
    assert.equal(await kindOf(obraId), 'servico');
    await request(`/centros-custo/${obraId}`, 'PUT', { codigo: 'OB-1', nome: 'Obra grande', tipo: 'obra' });
    assert.equal(await kindOf(obraId), 'obra');
  });

  await context.test('o banco recusa tipo fora de obra/servico', async () => {
    await assert.rejects(db.query("UPDATE cost_centers SET kind='outro' WHERE id=$1", [obraId]));
  });

  await context.test('CSV de cadastros leva o tipo na coluna tipo', async () => {
    const csv = await request('/cadastro-sync/exportar.csv');
    const line = csv.split('\r\n').find((l) => l.includes('SV-1'));
    assert.ok(line && line.includes('servico'), line);
  });

  await context.test('sync-direto com costCenterKind=servico na raiz cria servico', async () => {
    const envelope = fixture('servico');
    await request('/integracao/orcamentos/sync-direto', 'POST', { ...envelope, costCenterKind: 'tipo-errado' }, 400, KEY);
    const result = await request('/integracao/orcamentos/sync-direto', 'POST', { ...envelope, costCenterKind: 'servico' }, 201, KEY);
    assert.equal(await kindOf(result.costCenterId), 'servico');
    // Codigo SV- a partir do numero da proposta (PA-1001 -> SV-1001) e valor cobrado = valor final da proposta.
    const cc = (await db.query('SELECT code,contract_amount FROM cost_centers WHERE id=$1', [result.costCenterId])).rows[0];
    assert.equal(cc.code, 'SV-1001');
    assert.equal(Number(cc.contract_amount), 3450);
  });

  await context.test('costCenterKind em options vale; sem o campo cria obra', async () => {
    const result = await request('/integracao/orcamentos/sync-direto', 'POST', { envelope: fixture('opt'), options: { costCenterKind: 'servico' } }, 201, KEY);
    assert.equal(await kindOf(result.costCenterId), 'servico');
    assert.equal((await db.query('SELECT code FROM cost_centers WHERE id=$1', [result.costCenterId])).rows[0].code, 'SV-1001-2');
    const plain = await request('/integracao/orcamentos/sync-direto', 'POST', fixture(), 201, KEY);
    assert.equal(await kindOf(plain.costCenterId), 'obra');
  });
});
