const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRestoreRoot = path.join(os.tmpdir(), 'centro-custos-backup-manual-restore');
process.env.PGLITE_DATA_DIR = path.join(os.tmpdir(), 'centro-custos-backup-manual');
process.env.RESTORE_ROOT_DIR = tempRestoreRoot;
process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.ADMIN_INITIAL_PASSWORD = 'Admin@123456';
process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
process.env.INSTANCE_NAME = 'Instalação de teste';
delete process.env.DATABASE_URL;

require('../server');
delete process.env.DATABASE_URL;

const { initializeDatabase, closeDatabase } = require('../db');
const { createApp } = require('../server');
const { autoBackupDir } = require('../services/autoBackup');
const jobs = require('../lib/jobs');

async function setup() {
  fs.rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
  fs.rmSync(tempRestoreRoot, { recursive: true, force: true });
  await initializeDatabase();
}

test('disparo manual de backup responde 202 com jobId e conclui como job em segundo plano', async () => {
  await setup();
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const loginResp = await fetch(base + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@teste.local', senha: 'Admin@123456' }),
    });
    const { token } = await loginResp.json();
    assert.ok(token);

    const dir = autoBackupDir;
    const before = fs.existsSync(dir()) ? fs.readdirSync(dir()).length : 0;

    const resp = await fetch(base + '/backup-automatico/executar', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
    });
    const dispatched = await resp.json();
    assert.equal(resp.status, 202, `esperado 202, recebeu ${resp.status}: ${JSON.stringify(dispatched)}`);
    assert.equal(dispatched.async, true);
    assert.ok(dispatched.jobId);
    assert.equal(dispatched.status, 'queued');

    await jobs.flushQueue();

    const statusResp = await fetch(base + `/jobs/${dispatched.jobId}`, { headers: { Authorization: `Bearer ${token}` } });
    const status = await statusResp.json();
    assert.equal(status.status, 'succeeded', JSON.stringify(status));
    assert.equal(status.resultado.ok, true);
    assert.ok(status.resultado.file);

    const after = fs.readdirSync(dir()).filter((n) => n.endsWith('.tar.gz'));
    assert.equal(after.length, before + 1, 'deve ter criado exatamente um novo arquivo de backup');
  } finally {
    await new Promise((r) => server.close(r));
    await closeDatabase();
  }
});
