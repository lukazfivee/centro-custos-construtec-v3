const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { iniciar } = require('../scripts/dev/fake-commercial-worker');

// Desktop novo (D4): fluxo rascunho -> autorizar -> enviar contra um Worker de mentira (nada e enviado de verdade),
// e o envio sem nota fiscal e barrado pelo servidor.
test('cobranças: rascunho, autorização e envio; sem NF o envio é barrado; supervisor só lê', async (context) => {
  const obraId = '11111111-1111-4111-8111-111111111111';
  const obras = [{ publicId: obraId, code: 'CC-031', name: 'Residencial Aurora', client: 'Aurora', responsible: 'Carla', contractAmount: 1000, projectStatus: 'execucao', endDate: '2026-12-20' }];
  const worker = await iniciar({ obras });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-cobrancas-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
  process.env.SYNC_API_URL = worker.url;
  process.env.SYNC_SHARED_KEY = 'chave-de-teste';
  delete process.env.DATABASE_URL;

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  context.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await worker.fechar();
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.SYNC_API_URL;
    delete process.env.SYNC_SHARED_KEY;
  });

  async function request(url, method, body, status, token) {
    const response = await fetch(`${base}${url}`, {
      method: method || 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (status) assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  const admin = (await request('/auth/login', 'POST', { email: 'admin@teste.local', senha: 'senha-teste-123' }, 200)).token;
  await request('/usuarios', 'POST', { nome: 'Gestora', email: 'gestora@rcconstrutec.com.br', senha: 'senha-gestora-1', role: 'gestor' }, 201, admin);
  await request('/usuarios', 'POST', { nome: 'Supervisor', email: 'sup@rcconstrutec.com.br', senha: 'senha-super-1234', role: 'supervisor' }, 201, admin);
  // O login de e-mail da empresa passa pela autenticacao central; aqui assina-se o token da sessao local.
  const jwt = require('jsonwebtoken');
  const tokenDe = async (email) => {
    const { rows } = await getDb().query('SELECT id FROM users WHERE email=$1', [email]);
    return jwt.sign({}, process.env.JWT_SECRET, { subject: String(rows[0].id), expiresIn: '1h' });
  };
  const gestor = await tokenDe('gestora@rcconstrutec.com.br');
  const sup = await tokenDe('sup@rcconstrutec.com.br');
  // E-mail que nao e da empresa nao entra em Cobrancas.
  await request('/cloud-sync/cobrancas', 'GET', undefined, 403, admin);

  const lista = await request('/cloud-sync/cobrancas', 'GET', undefined, 200, gestor);
  assert.equal(lista.items.length, 1);
  assert.equal(lista.items[0].financialStatus, 'a_faturar');
  assert.equal(lista.items[0].receivableAmount, 1000);
  await request(`/cloud-sync/cobrancas/${obraId}`, 'PUT', { ...lista.items[0], financialStatus: 'nf_emitida', invoiceNumber: 'NF 2199', dueDate: '2026-10-10', clientEmails: ['sindico@exemplo.com.br'] }, 200, gestor);
  await request(`/cloud-sync/cobrancas/${obraId}`, 'PUT', { ...lista.items[0], financialStatus: 'pago' }, 403, sup);
  assert.equal((await request('/cloud-sync/cobrancas', 'GET', undefined, 200, sup)).items[0].financialStatus, 'nf_emitida');

  // Rascunho: o supervisor le, so admin e gestor salvam. A copia de faturamento e obrigatoria.
  const salvo = await request(`/cloud-sync/cobrancas/${obraId}/rascunho`, 'PUT', { to: ['sindico@exemplo.com.br'], cc: [], subject: 'Medição 4', bodyText: 'Segue a medição.' }, 200, gestor);
  assert.equal(salvo.status, 'draft');
  await request(`/cloud-sync/cobrancas/${obraId}/rascunho`, 'PUT', { to: ['a@b.com'], subject: 'x', bodyText: 'xxxxxx' }, 403, sup);
  const rascunho = await request(`/cloud-sync/cobrancas/${obraId}/rascunho`, 'GET', undefined, 200, sup);
  assert.equal(rascunho.draft.status, 'draft');
  assert.ok(rascunho.draft.cc.includes('pcm@rcconstrutec.com.br'));
  assert.equal(rascunho.copyPolicy.mandatory, true);

  // Sem autorizacao, nao envia. Com autorizacao mas sem NF (nem anexo, nem PDF na obra), o servidor barra.
  const pdf = Buffer.from('%PDF-1.4 nf 2199').toString('base64');
  await request(`/cloud-sync/cobrancas/${obraId}/enviar`, 'POST', { attachments: [{ filename: 'nf-2199.pdf', contentType: 'application/pdf', contentBase64: pdf }] }, 409, gestor);
  await request(`/cloud-sync/cobrancas/${obraId}/autorizar`, 'POST', {}, 400, gestor);
  await request(`/cloud-sync/cobrancas/${obraId}/autorizar`, 'POST', { confirmar: true }, 200, gestor);
  const semNf = await request(`/cloud-sync/cobrancas/${obraId}/enviar`, 'POST', {}, 409, gestor);
  assert.match(semNf.erro, /nota fiscal/i);
  assert.equal(worker.enviados.length, 0);
  await request(`/cloud-sync/cobrancas/${obraId}/enviar`, 'POST', { attachments: [{ filename: 'nf.txt', contentType: 'text/plain', contentBase64: pdf }] }, 400, gestor);
  await request(`/cloud-sync/cobrancas/${obraId}/enviar`, 'POST', {}, 403, sup);
  await request(`/cloud-sync/cobrancas/${obraId}/autorizar`, 'POST', { confirmar: true }, 403, sup);

  // Com a NF anexada, envia (o Worker de mentira so registra).
  const ok = await request(`/cloud-sync/cobrancas/${obraId}/enviar`, 'POST', { attachments: [{ filename: 'nf-2199.pdf', contentType: 'application/pdf', contentBase64: pdf }] }, 200, gestor);
  assert.equal(ok.status, 'sent');
  assert.deepEqual(worker.enviados[0].anexos, ['nf-2199.pdf']);

  // Editar o rascunho depois zera a autorizacao (regra do Worker): e preciso autorizar de novo.
  await request(`/cloud-sync/cobrancas/${obraId}/rascunho`, 'PUT', { to: ['sindico@exemplo.com.br'], subject: 'Medição 4 (2)', bodyText: 'Segue de novo.' }, 200, gestor);
  await request(`/cloud-sync/cobrancas/${obraId}/enviar`, 'POST', { attachments: [{ filename: 'nf-2199.pdf', contentType: 'application/pdf', contentBase64: pdf }] }, 409, gestor);

  // A NF em PDF vinculada a obra tambem vale como anexo (sem enviar nada junto).
  const cc = await request('/centros-custo', 'POST', { codigo: 'OB-NF', nome: 'Obra com NF' }, 201, admin);
  const publico = (await getDb().query('SELECT public_id FROM cost_centers WHERE id=$1', [cc.id])).rows[0].public_id;
  obras.push({ publicId: publico, code: 'OB-NF', name: 'Obra com NF', client: 'Cliente', contractAmount: 500, projectStatus: 'execucao' });
  await getDb().query('INSERT INTO cost_center_invoices (cost_center_id,original_name,mime_type,size_bytes,sha256,content,uploaded_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7)', [cc.id, 'nf-vinculada.pdf', 'application/pdf', 20, 'x', Buffer.from('%PDF-1.4 vinculada'), 'teste']);
  await request(`/cloud-sync/cobrancas/${publico}/rascunho`, 'PUT', { to: ['cliente@exemplo.com.br'], subject: 'Cobrança', bodyText: 'Segue a cobrança.' }, 200, gestor);
  await request(`/cloud-sync/cobrancas/${publico}/autorizar`, 'POST', { confirmar: true }, 200, gestor);
  await request(`/cloud-sync/cobrancas/${publico}/enviar`, 'POST', {}, 200, gestor);
  assert.deepEqual(worker.enviados.at(-1).anexos, ['nf-vinculada.pdf']);
});
