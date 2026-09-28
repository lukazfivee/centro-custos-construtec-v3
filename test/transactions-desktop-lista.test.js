const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Desktop novo (D2): busca pela NF, contador de documentos, aprovacao, total liquido do filtro
// e leitura de um lancamento por id.
test('lista de lançamentos para o desktop: NF na busca, documentos, total líquido e GET por id', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-lista-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
  delete process.env.DATABASE_URL;

  const { initializeDatabase, closeDatabase } = require('../db');
  const { createApp } = require('../server');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  context.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  let token = '';
  async function request(url, method = 'GET', body, status) {
    const response = await fetch(`${base}${url}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (status) assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  token = (await request('/auth/login', 'POST', { email: 'admin@teste.local', senha: 'senha-teste-123' }, 200)).token;
  const obra = (await request('/centros-custo', 'POST', { codigo: 'OB-7', nome: 'Obra Lista' }, 201)).id;
  const categorias = await request('/categorias');
  const despesa = categorias.find((c) => c.tipo === 'despesa').id;
  const receita = categorias.find((c) => c.tipo !== 'despesa').id;
  const lancar = (tipo, valor, extra = {}) => request('/lancamentos', 'POST', {
    tipo, valor, status_financeiro: 'liquidado', data: '2026-09-10', cost_center_id: obra,
    category_id: tipo === 'receita' ? receita : despesa, descricao: `${tipo} ${valor}`, ...extra,
  }, 201);

  const nf = await lancar('despesa', 300, { documento: 'NF-77781', favorecido: 'Fios & Cabos' });
  await lancar('receita', 1000);
  const estornada = await lancar('despesa', 200);
  await request(`/lancamentos/${estornada.id}/estornar`, 'POST', { motivo: 'Lançado errado', data_estorno: '2026-09-11' }, 201);
  await request(`/anexos/lancamento/${nf.id}`, 'POST', { nome: 'nf.pdf', tipo: 'application/pdf', categoria: 'nota_fiscal', conteudoBase64: Buffer.from('%PDF-1.4 teste').toString('base64') }, 201);

  // A busca acha pelo numero da NF.
  const busca = await request('/lancamentos?busca=77781&pagina=1&limite=10', 'GET', undefined, 200);
  assert.equal(busca.itens.length, 1);
  assert.equal(busca.itens[0].id, nf.id);
  assert.equal(busca.itens[0].qtd_anexos, 1);
  assert.equal(busca.itens[0].aprovacao, 'aprovado');

  // Total liquido de tudo o que o filtro achou: 1000 - 300 - 200 + 200 (estorno) = 700.
  const todos = await request('/lancamentos?pagina=1&limite=2', 'GET', undefined, 200);
  assert.equal(todos.paginacao.total, 4);
  assert.equal(todos.itens.length, 2);
  assert.equal(todos.totalLiquido, 700);
  const despesas = await request('/lancamentos?tipo=despesa&pagina=1&limite=50', 'GET', undefined, 200);
  assert.equal(despesas.totalLiquido, -300);

  // A lista sem paginacao (sistema atual) continua um array.
  assert.ok(Array.isArray(await request('/lancamentos', 'GET', undefined, 200)));

  const um = await request(`/lancamentos/${nf.id}`, 'GET', undefined, 200);
  assert.equal(um.documento, 'NF-77781');
  assert.equal(um.favorecido, 'Fios & Cabos');
  assert.equal(um.centro_codigo, 'OB-7');
  assert.equal(um.qtd_anexos, 1);
  const orig = await request(`/lancamentos/${estornada.id}`, 'GET', undefined, 200);
  assert.equal(orig.estornado, true);

  await request(`/lancamentos/${nf.id}`, 'DELETE', undefined, 200);
  await request(`/lancamentos/${nf.id}`, 'GET', undefined, 404);
  await request('/lancamentos/abc', 'GET', undefined, 400);
});
