const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Para cada papel da Suite, quais rotas o servidor recusa (403) ou deixa passar (qualquer outro status).
const CASES = [
  // [metodo, url, permissao]
  ['POST', '/lancamentos', 'p2'],
  ['PUT', '/lancamentos/999999', 'p3'],
  ['DELETE', '/lancamentos/999999', 'p3'],
  ['POST', '/lancamentos/999999/estornar', 'p4'],
  ['POST', '/categorias', 'p5'],
  ['POST', '/fornecedores', 'p5'],
  ['POST', '/notas-fiscais-centro/999999', 'p6'],
  ['POST', '/cloud-sync/cobrancas/x/autorizar', 'p7'], // p6 das cobrancas em si: test/cobrancas-desktop.test.js
  ['POST', '/fechamento-mensal', 'p8'],
  ['DELETE', '/fechamento-mensal/999999', 'p8'],
  ['GET', '/fechamento-mensal/resumo?ano=2026', 'p8'],
  ['GET', '/fechamento-mensal/checklist?ano=2026&mes=9', 'p8'],
  ['GET', '/usuarios', 'p9'],
  ['POST', '/centros-custo/999999/medicoes', 'p12'],
];

test('cada papel da Suite passa so pelas rotas da sua permissao', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-perm-routes-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
  delete process.env.DATABASE_URL;

  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { createApp } = require('../server');
  const { defaultMatrix, SUITE_ROLES, PERMISSIONS } = require('../services/permissions');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  context.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const call = async (method, url, token, body) => {
    const response = await fetch(`${base}${url}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body || {}),
    });
    return response.status;
  };
  const login = async (email, senha) => {
    const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, senha }) });
    assert.equal(response.status, 200);
    return (await response.json()).token;
  };

  const admin = await login('admin@teste.local', 'senha-teste-123');
  const matrix = defaultMatrix();
  assert.equal(PERMISSIONS.length, 12);
  for (const role of SUITE_ROLES.filter((r) => r !== 'admin')) {
    const email = `${role}@teste.local`;
    const created = await fetch(`${base}/usuarios`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ nome: role, email, senha: `senha-${role}-123`, role: role === 'gestor' ? 'gestor' : 'supervisor' }),
    });
    assert.equal(created.status, 201);
    await getDb().query('UPDATE users SET suite_role=$1 WHERE email=$2', [role, email]);
    const token = await login(email, `senha-${role}-123`);
    for (const [method, url, permission] of CASES) {
      const status = await call(method, url, token);
      if (matrix[role][permission]) assert.notEqual(status, 403, `${role} deveria passar em ${method} ${url} (${permission})`);
      else assert.equal(status, 403, `${role} deveria ser recusado em ${method} ${url} (${permission})`);
    }
  }
  // Admin passa em tudo.
  for (const [method, url, permission] of CASES) {
    assert.notEqual(await call(method, url, admin), 403, `admin em ${method} ${url} (${permission})`);
  }
});
