const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.PGLITE_DATA_DIR = path.join(os.tmpdir(), `centro-custos-no-fallback-${process.pid}`);
process.env.RESTORE_ROOT_DIR = path.join(os.tmpdir(), `centro-custos-no-fallback-restore-${process.pid}`);
process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.ADMIN_INITIAL_PASSWORD = 'Admin@123456';
process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
delete process.env.DATABASE_URL;

const { initializeDatabase, closeDatabase } = require('../db');
const { createApp } = require('../server');
const cloudAuth = require('../services/cloudAuth');

test('na nuvem, senha local antiga nao entra quando o diretorio recusa', async (t) => {
  fs.rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const originalLogin = cloudAuth.login;
  t.after(async () => {
    cloudAuth.login = originalLogin;
    delete process.env.DATABASE_URL;
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
  });
  const login = (senha) => fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@teste.local', senha }),
  });

  // Desktop: conta local continua valida.
  assert.equal((await login('Admin@123456')).status, 200);

  // Nuvem: o diretorio e a unica fonte; recusa central nao cai no bcrypt local.
  process.env.DATABASE_URL = 'postgres://somente-para-o-teste';
  cloudAuth.login = async () => { const error = new Error('E-mail ou senha invalidos.'); error.status = 401; throw error; };
  assert.equal((await login('Admin@123456')).status, 401);
  cloudAuth.login = async () => { const error = new Error('fora do ar'); error.status = 503; throw error; };
  assert.equal((await login('Admin@123456')).status, 503);
});
