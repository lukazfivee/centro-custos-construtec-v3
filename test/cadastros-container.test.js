const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

// Centro (Express) da Fase 5: /api/cadastros repassa ao Worker central com a
// conta central de quem pediu; erros de validação do Worker chegam como estão.
test('pedidos de acesso pelo Centro de Custos', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cadastros-'));
  const calls = [];
  const fakeWorker = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      calls.push({ path: req.url, key: req.headers['x-sync-key'], body });
      const conflict = body.action === 'invite' && body.email === 'ja@teste.local';
      res.writeHead(conflict ? 409 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(conflict ? { ok: false, error: 'Este e-mail já tem conta.' } : { ok: true, code: 'CONST-ABC234', requests: [], invites: [] }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => fakeWorker.once('listening', resolve));
  Object.assign(process.env, {
    DATABASE_URL: '', PGLITE_DATA_DIR: path.join(tempRoot, 'database'), RESTORE_ROOT_DIR: path.join(tempRoot, 'restore'),
    JWT_SECRET: 'cadastros-test-secret-at-least-32-chars', ADMIN_INITIAL_PASSWORD: 'cad-test-123', ADMIN_INITIAL_EMAIL: 'cad@teste.local',
    SYNC_API_URL: `http://127.0.0.1:${fakeWorker.address().port}`, SYNC_SHARED_KEY: 'k'.repeat(40),
  });
  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fakeWorker.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (route, { method = 'GET', body, token } = {}) => {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  };

  assert.equal((await request('/cadastros')).status, 401);
  const token = (await request('/auth/login', { method: 'POST', body: { email: 'cad@teste.local', senha: 'cad-test-123' } })).data.token;
  const semConta = await request('/cadastros', { token });
  assert.equal(semConta.status, 200, 'sem conta central a lista não é erro');
  assert.equal(semConta.data.disponivel, false);
  assert.equal((await request('/cadastros/p1/aprovar', { method: 'POST', token })).status, 409, 'ações exigem conta central');
  assert.equal(calls.length, 0);

  await getDb().query("UPDATE users SET cloud_user_id='admin-central' WHERE email='cad@teste.local'");
  const listed = await request('/cadastros', { token });
  assert.equal(listed.status, 200);
  assert.equal(listed.data.code, 'CONST-ABC234');
  assert.equal(calls.at(-1).path, '/v1/internal/signup');
  assert.equal(calls.at(-1).key, process.env.SYNC_SHARED_KEY);
  assert.deepEqual(calls.at(-1).body, { action: 'list', actorId: 'admin-central' });

  await request('/cadastros/pedido-1/aprovar', { method: 'POST', token, body: { perfil: 'gestor' } });
  assert.deepEqual(calls.at(-1).body, { id: 'pedido-1', role: 'gestor', action: 'approve', actorId: 'admin-central' });
  await request('/cadastros/pedido-2/aprovar', { method: 'POST', token, body: { perfil: 'dono' } });
  assert.equal(calls.at(-1).body.role, 'supervisor', 'perfil desconhecido vira Supervisor');
  await request('/cadastros/pedido-3/recusar', { method: 'POST', token });
  assert.deepEqual(calls.at(-1).body, { id: 'pedido-3', action: 'reject', actorId: 'admin-central' });
  await request('/cadastros/codigo/trocar', { method: 'POST', token });
  assert.equal(calls.at(-1).body.action, 'rotate');

  const invited = await request('/cadastros/convites', { method: 'POST', token, body: { email: ' novo@teste.local ', perfil: 'supervisor' } });
  assert.equal(invited.status, 200);
  assert.deepEqual(calls.at(-1).body, { email: 'novo@teste.local', role: 'supervisor', action: 'invite', actorId: 'admin-central' });
  const conflict = await request('/cadastros/convites', { method: 'POST', token, body: { email: 'ja@teste.local' } });
  assert.equal(conflict.status, 409);
  assert.match(JSON.stringify(conflict.data), /já tem conta/);
});
