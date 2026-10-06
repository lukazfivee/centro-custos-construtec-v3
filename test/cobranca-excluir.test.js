const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { iniciar } = require('../scripts/dev/fake-commercial-worker');

// Exclusao reversivel de cobrancas pela API Express (Worker de mentira): excluir, listar excluidas,
// restaurar, permissao p6, validacao e auditoria. Nada e apagado de verdade.
test('cobranças: excluir e restaurar de forma reversível, com p6, validação e auditoria', async (context) => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const obras = [
    { publicId: A, code: 'CC-PA-1001', name: 'Obra de teste', client: 'Cliente', contractAmount: 1000, projectStatus: 'execucao' },
    { publicId: B, code: 'CC-PA-1002', name: 'Outra obra', client: 'Cliente', contractAmount: 500, projectStatus: 'execucao' },
  ];
  const worker = await iniciar({ obras });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-cobranca-excluir-'));
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
  await request('/usuarios', 'POST', { nome: 'Tecnico', email: 'tec@rcconstrutec.com.br', senha: 'senha-tecnico-12', role: 'supervisor' }, 201, admin);
  const jwt = require('jsonwebtoken');
  const tokenDe = async (email) => {
    const { rows } = await getDb().query('SELECT id FROM users WHERE email=$1', [email]);
    return jwt.sign({}, process.env.JWT_SECRET, { subject: String(rows[0].id), expiresIn: '1h' });
  };
  const gestor = await tokenDe('gestora@rcconstrutec.com.br');
  const tecnico = await tokenDe('tec@rcconstrutec.com.br');

  // Sem p6 (tecnico) nao exclui nem restaura; nada muda.
  await request(`/cloud-sync/cobrancas/${A}/excluir`, 'POST', {}, 403, tecnico);
  await request(`/cloud-sync/cobrancas/${A}/restaurar`, 'POST', {}, 403, tecnico);
  assert.equal((await request('/cloud-sync/cobrancas', 'GET', undefined, 200, gestor)).items.length, 2);

  // Validacao e 404.
  await request('/cloud-sync/cobrancas/nada/excluir', 'POST', {}, 400, gestor);
  await request(`/cloud-sync/cobrancas/${A}/excluir`, 'POST', { motivo: 'x'.repeat(301) }, 400, gestor);
  await request('/cloud-sync/cobrancas/44444444-4444-4444-8444-444444444444/excluir', 'POST', {}, 404, gestor);

  // Exclui com motivo (a lista padrao deixa de mostrar; as excluidas mostram).
  const feito = await request(`/cloud-sync/cobrancas/${A}/excluir`, 'POST', { motivo: 'Item de teste' }, 200, gestor);
  assert.equal(feito.ok, true);
  assert.deepEqual((await request('/cloud-sync/cobrancas', 'GET', undefined, 200, gestor)).items.map((i) => i.publicId), [B]);
  const excluidas = await request('/cloud-sync/cobrancas?excluidas=1', 'GET', undefined, 200, gestor);
  assert.deepEqual(excluidas.items.map((i) => i.publicId), [A]);
  assert.equal(excluidas.items[0].deletedReason, 'Item de teste');
  await request('/cloud-sync/cobrancas?excluidas=1', 'GET', undefined, 403, tecnico);

  // Excluir de novo e restaurar o que nao esta excluido sao 409 vindos do Worker.
  await request(`/cloud-sync/cobrancas/${A}/excluir`, 'POST', {}, 409, gestor);
  await request(`/cloud-sync/cobrancas/${B}/restaurar`, 'POST', {}, 409, gestor);

  // Restaura: volta para a lista.
  await request(`/cloud-sync/cobrancas/${A}/restaurar`, 'POST', {}, 200, gestor);
  assert.equal((await request('/cloud-sync/cobrancas', 'GET', undefined, 200, gestor)).items.length, 2);
  assert.equal((await request('/cloud-sync/cobrancas?excluidas=1', 'GET', undefined, 200, gestor)).items.length, 0);

  // Auditoria: quem excluiu e restaurou (so as operacoes que deram certo).
  const { rows } = await getDb().query("SELECT action,entity_id,user_name FROM audit_log WHERE entity_type='cobranca' ORDER BY id");
  assert.deepEqual(rows.map((r) => r.action), ['cobranca_excluida', 'cobranca_restaurada']);
  assert.ok(rows.every((r) => r.entity_id === A));
});
