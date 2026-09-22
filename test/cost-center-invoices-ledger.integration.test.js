const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('Notas fiscais do centro de custo: lança, lista, atualiza status e remove', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-nf-ledger-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-nf-ledger-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-nf-ledger-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin-nf-ledger@teste.local';
  process.env.INSTANCE_NAME = 'Instalação NF Ledger';

  const { initializeDatabase, closeDatabase } = require('../db');
  const { createApp } = require('../server');
  delete process.env.DATABASE_URL;
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  context.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  async function request(route, options = {}) {
    const response = await fetch(base + route, {
      method: options.method || 'GET',
      headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  const login = await request('/auth/login', { method: 'POST', body: { email: 'admin-nf-ledger@teste.local', senha: 'senha-teste-nf-ledger-123' } });
  assert.equal(login.response.ok, true);
  const token = login.data.token;
  const center = await request('/centros-custo', { method: 'POST', token, body: { codigo: 'NFL-001', nome: 'Obra NF Ledger', orcamento: 1000, situacao: 'execucao' } });
  assert.equal(center.response.status, 201);
  const centerId = center.data.id;

  const emptyList = await request(`/centros-custo/${centerId}/notas-fiscais`, { token });
  assert.equal(emptyList.response.ok, true);
  assert.deepEqual(emptyList.data, []);

  const fornecedor = await request(`/centros-custo/${centerId}/notas-fiscais`, {
    method: 'POST', token,
    body: { tipo: 'fornecedor', dataEmissao: '2026-09-10', valor: 1500.5, status: 'nao_paga', observacao: 'Cimento e areia' },
  });
  assert.equal(fornecedor.response.status, 201);
  assert.equal(fornecedor.data.tipo, 'fornecedor');
  assert.equal(fornecedor.data.status, 'nao_paga');
  assert.equal(fornecedor.data.temArquivo, false);

  const bytes = Buffer.from('%PDF-1.4\n% nf cliente\n%%EOF\n');
  const cliente = await request(`/centros-custo/${centerId}/notas-fiscais`, {
    method: 'POST', token,
    body: { tipo: 'cliente', dataEmissao: '2026-09-12', valor: 8000, status: 'paga', nome: 'nf-cliente.pdf', tipoArquivo: 'application/pdf', conteudoBase64: bytes.toString('base64') },
  });
  assert.equal(cliente.response.status, 201);
  assert.equal(cliente.data.temArquivo, true);
  assert.equal(cliente.data.nomeArquivo, 'nf-cliente.pdf');

  const invalidTipo = await request(`/centros-custo/${centerId}/notas-fiscais`, { method: 'POST', token, body: { tipo: 'invalido', valor: 10 } });
  assert.equal(invalidTipo.response.status, 400);

  const listaFornecedor = await request(`/centros-custo/${centerId}/notas-fiscais?tipo=fornecedor`, { token });
  assert.equal(listaFornecedor.data.length, 1);
  assert.equal(listaFornecedor.data[0].tipo, 'fornecedor');

  const listaCompleta = await request(`/centros-custo/${centerId}/notas-fiscais`, { token });
  assert.equal(listaCompleta.data.length, 2);

  const atualizado = await request(`/centros-custo/notas-fiscais/${fornecedor.data.id}`, { method: 'PUT', token, body: { status: 'paga' } });
  assert.equal(atualizado.response.status, 200);
  assert.equal(atualizado.data.status, 'paga');
  assert.equal(atualizado.data.valor, 1500.5);

  const removido = await request(`/centros-custo/notas-fiscais/${cliente.data.id}`, { method: 'DELETE', token });
  assert.equal(removido.response.status, 200);
  const listaFinal = await request(`/centros-custo/${centerId}/notas-fiscais`, { token });
  assert.equal(listaFinal.data.length, 1);
});
