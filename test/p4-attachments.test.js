const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('P4 cria estrutura segura de anexos e interface de documentos', () => {
  const root = path.join(__dirname, '..');
  const migration = fs.readFileSync(path.join(root, 'migrations/013_transaction_attachments.sql'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'routes/attachments.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'public/chatgpt-p4.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public/teste-chatgpt.html'), 'utf8');
  assert.match(migration, /transaction_attachments/);
  assert.match(migration, /sha256 VARCHAR\(64\)/);
  assert.match(migration, /8388608/);
  assert.match(route, /application\/pdf/);
  assert.match(route, /Este mesmo arquivo já está anexado/);
  assert.match(route, /anexo_adicionado/);
  assert.match(ui, /Documentos/);
  assert.match(ui, /máximo 8 MB/);
  assert.match(html, /chatgpt-p4\.js/);
});

test('P4 envia, lista, baixa, bloqueia duplicata e remove documento', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-p4-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-p4-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-p4-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin-p4@teste.local';
  process.env.INSTANCE_NAME = 'Instalação P4';

  const { initializeDatabase, closeDatabase } = require('../db');
  const { createApp } = require('../server');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  context.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive:true, force:true });
  });

  async function request(route, options = {}) {
    const response = await fetch(base + route, {
      method:options.method || 'GET',
      headers:{ ...(options.token ? { Authorization:`Bearer ${options.token}` } : {}), ...(options.body ? { 'Content-Type':'application/json' } : {}) },
      body:options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { response,data };
  }

  const login = await request('/auth/login', { method:'POST',body:{ email:'admin-p4@teste.local',senha:'senha-teste-p4-123' } });
  assert.equal(login.response.ok, true);
  const token = login.data.token;
  const center = await request('/centros-custo', { method:'POST',token,body:{ codigo:'P4-001',nome:'Obra P4',orcamento:1000,situacao:'execucao' } });
  assert.equal(center.response.status, 201);
  const categories = await request('/categorias', { token });
  const material = categories.data.find((item) => item.nome === 'Material');
  const transaction = await request('/lancamentos', { method:'POST',token,body:{ tipo:'despesa',data:'2026-08-20',cost_center_id:center.data.id,category_id:material.id,descricao:'Compra com comprovante',valor:55.9,status_financeiro:'liquidado',data_liquidacao:'2026-08-20' } });
  assert.equal(transaction.response.status, 201);

  const bytes = Buffer.from('%PDF-1.4\n% comprovante P4\n%%EOF\n');
  const uploadBody = { nome:'comprovante-p4.pdf',tipo:'application/pdf',categoria:'comprovante',observacao:'Teste automatizado P4',conteudoBase64:bytes.toString('base64') };
  const uploaded = await request(`/anexos/lancamento/${transaction.data.id}`, { method:'POST',token,body:uploadBody });
  assert.equal(uploaded.response.status, 201);
  assert.equal(uploaded.data.nome, 'comprovante-p4.pdf');

  const listed = await request(`/anexos/lancamento/${transaction.data.id}`, { token });
  assert.equal(listed.response.ok, true);
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].tamanho, bytes.length);

  const fileResponse = await fetch(base + `/anexos/${uploaded.data.id}/arquivo`, { headers:{ Authorization:`Bearer ${token}` } });
  assert.equal(fileResponse.ok, true);
  assert.equal(fileResponse.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await fileResponse.arrayBuffer()), bytes);

  const duplicate = await request(`/anexos/lancamento/${transaction.data.id}`, { method:'POST',token,body:uploadBody });
  assert.equal(duplicate.response.status, 409);
  assert.match(duplicate.data.erro, /já está anexado/i);

  const removed = await request(`/anexos/${uploaded.data.id}`, { method:'DELETE',token });
  assert.equal(removed.response.ok, true);
  const after = await request(`/anexos/lancamento/${transaction.data.id}`, { token });
  assert.equal(after.data.length, 0);
});
