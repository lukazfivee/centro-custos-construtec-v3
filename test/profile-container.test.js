const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

// Meu perfil (/api/perfil): local sem conta central; com conta central, pelo Worker
// (rota interna) e com cópia local do nome e da foto.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64');

test('perfil do Centro de Custos', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-perfil-'));
  const calls = [];
  let state = { name: 'Conta Central', email: 'perfil@teste.local', role: 'admin', phone: '', photo: null };
  const fakeWorker = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      calls.push({ path: req.url, key: req.headers['x-sync-key'], body });
      if (body.action === 'update' && body.phone === '1') {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Informe o celular com DDD.' }));
      }
      if (body.action === 'update') state = { ...state, name: body.name, phone: body.phone.replace(/\D/g, '') };
      if (body.action === 'setPhoto') state = { ...state, photo: { mime: body.mime, contentBase64: body.contentBase64 } };
      if (body.action === 'removePhoto') state = { ...state, photo: null };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, profile: state }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => fakeWorker.once('listening', resolve));
  Object.assign(process.env, {
    DATABASE_URL: '', PGLITE_DATA_DIR: path.join(tempRoot, 'database'), RESTORE_ROOT_DIR: path.join(tempRoot, 'restore'),
    JWT_SECRET: 'perfil-test-secret-at-least-32-characters', ADMIN_INITIAL_PASSWORD: 'perfil-test-123', ADMIN_INITIAL_EMAIL: 'perfil@teste.local',
    SYNC_API_URL: `http://127.0.0.1:${fakeWorker.address().port}`, SYNC_SHARED_KEY: 'q'.repeat(40),
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
  const token = (await request('/auth/login', { method: 'POST', body: { email: 'perfil@teste.local', senha: 'perfil-test-123' } })).data.token;

  // Sem conta central: só o local, sem chamar o Worker.
  const local = await request('/perfil', { token });
  assert.equal(local.status, 200);
  assert.equal(local.data.central, false);
  assert.equal((await request('/perfil', { method: 'PUT', token, body: { nome: 'Adm Local' } })).data.nome, 'Adm Local');
  assert.equal((await request('/perfil/foto', { method: 'POST', token, body: { mime: 'image/png', contentBase64: PNG } })).data.foto.mime, 'image/png');
  assert.equal((await request('/perfil/foto', { method: 'POST', token, body: { mime: 'image/png', contentBase64: 'bm9wZQ==' } })).status, 400);
  assert.equal(calls.length, 0);

  // Com conta central: pelo Worker, com a chave e o id da conta; o Centro guarda a cópia.
  await getDb().query("UPDATE users SET cloud_user_id='conta-perfil' WHERE email='perfil@teste.local'");
  const read = await request('/perfil', { token });
  assert.equal(read.data.central, true);
  assert.equal(read.data.nome, 'Conta Central');
  assert.deepEqual(calls.at(-1).body, { action: 'get', userId: 'conta-perfil' });
  assert.equal(calls.at(-1).key, process.env.SYNC_SHARED_KEY);
  assert.equal(read.data.foto, null, 'foto local some quando a central não tem foto');

  const saved = await request('/perfil', { method: 'PUT', token, body: { nome: ' Maria  Clara ', celular: '(71) 99999-1234' } });
  assert.equal(saved.data.nome, 'Maria Clara');
  assert.equal(saved.data.celular, '71999991234');
  assert.equal((await getDb().query("SELECT name FROM users WHERE email='perfil@teste.local'")).rows[0].name, 'Maria Clara');
  const bad = await request('/perfil', { method: 'PUT', token, body: { nome: 'Maria Clara', celular: '1' } });
  assert.equal(bad.status, 400);
  assert.match(JSON.stringify(bad.data), /DDD/);

  const photo = await request('/perfil/foto', { method: 'POST', token, body: { mime: 'image/png', contentBase64: PNG } });
  assert.equal(photo.data.foto.contentBase64, PNG);
  assert.ok((await getDb().query("SELECT profile_photo FROM users WHERE email='perfil@teste.local'")).rows[0].profile_photo);
  assert.equal((await request('/perfil/foto', { method: 'DELETE', token })).data.foto, null);
});
