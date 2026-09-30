const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = path.join(os.tmpdir(), `centro-users-access-${process.pid}`);
process.env.PGLITE_DATA_DIR = dataDir;
process.env.RESTORE_ROOT_DIR = `${dataDir}-restore`;
process.env.JWT_SECRET = 'jwt-users-access-test-secret-with-thirty-two-chars';
process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
process.env.ADMIN_INITIAL_PASSWORD = 'AdminSenha123!';
delete process.env.DATABASE_URL;

const jwt = require('jsonwebtoken');
const { initializeDatabase, closeDatabase, getDb } = require('../db');
const { setup, hasSQLite } = require('./password-reset-fixture.test');
const { resetPermissionsCache } = require('../services/permissions');
const maybe = hasSQLite ? test : test.skip;

// Centro de ponta a ponta com o Worker central de verdade (codigo real + D1 em memoria).
maybe('usuarios: papel, apps e obras, pela API do Centro e pelo Worker central', async (t) => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  await initializeDatabase();
  process.env.DATABASE_URL = 'postgres://users-access-test';
  process.env.SYNC_API_URL = 'https://centro.test';
  const { env, call, token: workerToken } = await setup();
  process.env.SYNC_SHARED_KEY = env.SYNC_SHARED_KEY;
  const nativeFetch = global.fetch;
  const auth = await import('../cloudflare/center-container/centralAuth.js');
  global.fetch = (input, options) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://centro.test/v1/')) return auth.handleCentralAuth(new Request(url, options), env);
    return nativeFetch(input, options);
  };
  const { createApp } = require('../server');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    global.fetch = nativeFetch;
    delete process.env.DATABASE_URL; delete process.env.SYNC_SHARED_KEY; delete process.env.SYNC_API_URL;
    resetPermissionsCache();
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  // Admin local do Centro ligado a conta central de verdade.
  const adminId = env.DB.raw.prepare("SELECT id FROM cloud_users WHERE role='admin'").get().id;
  const db = getDb();
  await db.query("UPDATE users SET email='admin@rcconstrutec.com.br',cloud_managed=TRUE,cloud_user_id=$1,cloud_session_token=$2 WHERE email='admin@teste.local'", [adminId, workerToken]);
  const localAdmin = (await db.query("SELECT id FROM users WHERE email='admin@rcconstrutec.com.br'")).rows[0].id;
  const adminJwt = jwt.sign({}, process.env.JWT_SECRET, { subject: String(localAdmin), expiresIn: '1h' });
  const api = async (method, route, body, token = adminJwt) => {
    const response = await nativeFetch(base + route, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  };

  const obra = async (codigo) => (await api('POST', '/centros-custo', { codigo, nome: `Obra ${codigo}`, orcamento: 100, situacao: 'execucao' })).data.id;
  const [a, b] = [await obra('ACC-A'), await obra('ACC-B')];

  // Criar com papel novo, apps e obras.
  const criado = await api('POST', '/usuarios', { nome: 'Tec Campo', email: 'tec@rcconstrutec.com.br', senha: 'senha-tecnico-1', suiteRole: 'tecnico', apps: ['centro'], obras: [a] });
  assert.equal(criado.status, 201, JSON.stringify(criado.data));
  assert.equal(criado.data.suiteRole, 'tecnico');
  assert.deepEqual(criado.data.apps, ['centro']);
  assert.deepEqual(criado.data.obras, [a]);
  assert.equal(criado.data.todasObras, false);
  assert.equal(env.DB.raw.prepare("SELECT suite_role FROM cloud_users WHERE email='tec@rcconstrutec.com.br'").get().suite_role, 'tecnico');

  // Conta criada sem obras: nasce escopada e sem nada.
  const semObras = await api('POST', '/usuarios', { nome: 'Eng Nova', email: 'eng@rcconstrutec.com.br', senha: 'senha-eng-12345', suiteRole: 'engenharia' });
  assert.equal(semObras.status, 201);
  assert.equal(semObras.data.todasObras, false);
  assert.deepEqual(semObras.data.obras, []);

  // Lista traz papel, apps, obras e ultimo acesso.
  const lista = await api('GET', '/usuarios');
  assert.equal(lista.status, 200);
  const tec = lista.data.find((u) => u.email === 'tec@rcconstrutec.com.br');
  assert.equal(tec.suiteRole, 'tecnico');
  assert.deepEqual(tec.obras, [a]);
  assert.equal(lista.data.find((u) => u.email === 'admin@rcconstrutec.com.br').suiteRole, 'admin');

  // Editar acesso: papel, apps e obras; o Worker e o Centro concordam.
  const editado = await api('PUT', `/usuarios/${tec.id}/acesso`, { suiteRole: 'engenharia', apps: ['centro', 'orcamentos'], obras: [a, b] });
  assert.equal(editado.status, 200, JSON.stringify(editado.data));
  assert.equal(editado.data.suiteRole, 'engenharia');
  assert.deepEqual(editado.data.obras.sort(), [a, b].sort());
  const noWorker = env.DB.raw.prepare("SELECT role,suite_role,apps FROM cloud_users WHERE email='tec@rcconstrutec.com.br'").get();
  assert.deepEqual({ ...noWorker }, { role: 'supervisor', suite_role: 'engenharia', apps: '["centro","orcamentos"]' });
  assert.equal((await api('PUT', `/usuarios/${tec.id}/acesso`, { suiteRole: 'inexistente' })).status, 400);
  assert.equal((await api('PUT', `/usuarios/${tec.id}/acesso`, { suiteRole: 'tecnico', obras: [999999] })).status, 400);
  assert.equal((await api('PUT', `/usuarios/${localAdmin}/acesso`, { suiteRole: 'tecnico' })).status, 400, 'nao altera o proprio papel');
  await api('PUT', `/usuarios/${tec.id}/acesso`, { suiteRole: 'engenharia', obras: 'todas' });
  assert.equal((await db.query('SELECT all_cost_centers FROM users WHERE id=$1', [tec.id])).rows[0].all_cost_centers, true);

  // Quem nao e admin nao mexe em acesso nem em permissoes.
  const tecJwt = jwt.sign({}, process.env.JWT_SECRET, { subject: String(tec.id), expiresIn: '1h' });
  const tecLogin = await call('POST', '/v1/auth/login', { body: { email: 'tec@rcconstrutec.com.br', password: 'senha-tecnico-1' } });
  await db.query('UPDATE users SET cloud_session_token=$1 WHERE id=$2', [tecLogin.data.sessionToken, tec.id]);
  assert.equal((await api('PUT', `/usuarios/${tec.id}/acesso`, { suiteRole: 'admin' }, tecJwt)).status, 403);
  assert.equal((await api('POST', '/usuarios/permissoes', { papel: 'tecnico', permissao: 'p3', permitido: true }, tecJwt)).status, 403);

  // Matriz: ler, ajustar, admin travado, restaurar; o ajuste vale nas rotas do Centro.
  const matriz = await api('GET', '/usuarios/permissoes');
  assert.equal(matriz.status, 200);
  assert.equal(matriz.data.matriz.gestor.p4, true);
  assert.equal(matriz.data.matriz.tecnico.p3, false);
  const ajustada = await api('POST', '/usuarios/permissoes', { papel: 'financeiro', permissao: 'p5', permitido: true });
  assert.equal(ajustada.data.matriz.financeiro.p5, true);
  assert.equal(ajustada.data.padrao.financeiro.p5, false);
  assert.equal((await api('POST', '/usuarios/permissoes', { papel: 'admin', permissao: 'p9', permitido: false })).status, 400);
  const restaurada = await api('POST', '/usuarios/permissoes/restaurar', {});
  assert.equal(restaurada.data.matriz.financeiro.p5, false);
});
