const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('Proposta do centro de custo: envia, consulta, baixa, substitui e remove', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-proposta-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
  process.env.INSTANCE_NAME = 'Instalação de teste';

  const { initializeDatabase, closeDatabase } = require('../db');
  const { createApp } = require('../server');
  delete process.env.DATABASE_URL;
  await initializeDatabase();
  let server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  context.after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  async function request(route, options = {}) {
    const response = await fetch(base + route, {
      method: options.method || 'GET',
      headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json();
    assert.equal(response.ok, true, data.erro || `HTTP ${response.status}`);
    return data;
  }

  async function requestWithStatus(route, options = {}) {
    const response = await fetch(base + route, {
      method: options.method || 'GET',
      headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  const login = await request('/auth/login', { method: 'POST', body: { email: 'admin@teste.local', senha: 'senha-teste-123' } });
  const auth = login.token;

  const center = await request('/centros-custo', { method: 'POST', token: auth, body: { codigo: 'PROP-001', nome: 'Obra Proposta', orcamento: 1000, situacao: 'execucao' } });
  const centerId = center.id;

  const empty = await request(`/centros-custo/${centerId}/proposta`, { token: auth });
  assert.equal(empty.proposta, null);

  const bytes = Buffer.from('%PDF-1.4\n% proposta original\n%%EOF\n');
  const uploadBody = { nome: 'proposta-comercial.pdf', tipo: 'application/pdf', conteudoBase64: bytes.toString('base64') };
  const uploaded = await request(`/centros-custo/${centerId}/proposta`, { method: 'POST', token: auth, body: uploadBody });
  assert.equal(uploaded.proposta.nome, 'proposta-comercial.pdf');
  assert.equal(uploaded.proposta.tamanho, bytes.length);

  const metadata = await request(`/centros-custo/${centerId}/proposta`, { token: auth });
  assert.equal(metadata.proposta.nome, 'proposta-comercial.pdf');

  const fileResponse = await fetch(base + `/centros-custo/${centerId}/proposta/arquivo`, { headers: { Authorization: `Bearer ${auth}` } });
  assert.equal(fileResponse.ok, true);
  assert.equal(fileResponse.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await fileResponse.arrayBuffer()), bytes);

  const invalidUpload = await requestWithStatus(`/centros-custo/${centerId}/proposta`, { method: 'POST', token: auth, body: { nome: 'nao-e-pdf.txt', tipo: 'application/pdf', conteudoBase64: Buffer.from('nao e pdf').toString('base64') } });
  assert.equal(invalidUpload.response.status, 400);

  const oversized = await requestWithStatus(`/centros-custo/${centerId}/proposta`, { method: 'POST', token: auth, body: { nome: 'grande.pdf', tipo: 'application/pdf', conteudoBase64: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024)]).toString('base64') } });
  assert.equal(oversized.response.status, 413);

  const replacementBytes = Buffer.from('%PDF-1.4\n% proposta revisada\n%%EOF\n');
  const replaced = await request(`/centros-custo/${centerId}/proposta`, { method: 'POST', token: auth, body: { nome: 'proposta-revisada.pdf', tipo: 'application/pdf', conteudoBase64: replacementBytes.toString('base64') } });
  assert.equal(replaced.proposta.nome, 'proposta-revisada.pdf');

  const removed = await request(`/centros-custo/${centerId}/proposta`, { method: 'DELETE', token: auth });
  assert.equal(removed.ok, true);
  const afterRemoval = await request(`/centros-custo/${centerId}/proposta`, { token: auth });
  assert.equal(afterRemoval.proposta, null);
});
