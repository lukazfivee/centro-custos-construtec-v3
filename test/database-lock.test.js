const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { once } = require('events');

test('lock local distingue processo ativo de PID reutilizado', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-lock-'));
  const dataDir = path.join(root, 'pglite');
  const lockPath = `${dataDir}.centro-custos.lock`;
  const envNames = ['PGLITE_DATA_DIR', 'RESTORE_ROOT_DIR', 'ADMIN_INITIAL_NAME', 'ADMIN_INITIAL_EMAIL', 'ADMIN_INITIAL_PASSWORD'];
  const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.PGLITE_DATA_DIR = dataDir;
  process.env.RESTORE_ROOT_DIR = path.join(root, 'dados');
  process.env.ADMIN_INITIAL_NAME = 'Administrador';
  process.env.ADMIN_INITIAL_EMAIL = 'admin-lock@teste.local';
  process.env.ADMIN_INITIAL_PASSWORD = 'SenhaSegura123!';

  const db = require('../db');
  const unrelated = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/q', '/c', 'pause >nul'], { stdio:['pipe', 'ignore', 'ignore'], windowsHide:true })
    : spawn('sh', ['-c', 'read value'], { stdio:['pipe', 'ignore', 'ignore'] });
  await once(unrelated, 'spawn');
  t.after(async () => {
    unrelated.kill();
    await db.closeDatabase();
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(root, { recursive:true, force:true });
  });

  fs.writeFileSync(lockPath, JSON.stringify({ pid:unrelated.pid, startedAt:'2000-01-01T00:00:00.000Z' }));
  const info = await db.initializeDatabase();
  assert.equal(info.mode, 'pglite');
  await db.closeDatabase();

  fs.writeFileSync(lockPath, JSON.stringify({
    pid:process.pid,
    executable:path.basename(process.execPath),
    processStartedAt:new Date(Date.now() - process.uptime() * 1000).toISOString(),
    startedAt:new Date().toISOString(),
  }));
  await assert.rejects(db.initializeDatabase(), /banco local já está em uso/i);
});
