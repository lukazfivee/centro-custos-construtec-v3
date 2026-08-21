const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stableHash, FORMAT_VERSION } = require('../services/smartSync');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('P3 usa formato versionado e hash SHA-256 determinístico', () => {
  assert.equal(FORMAT_VERSION, 3);
  const a = stableHash({ exemplo: [1,2,3] });
  const b = stableHash({ exemplo: [1,2,3] });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('P3 registra pacotes e conflitos no banco', () => {
  const migration = read('migrations/012_smart_sync_packages.sql');
  assert.match(migration, /sync_package_imports/);
  assert.match(migration, /package_id UUID NOT NULL UNIQUE/);
  assert.match(migration, /sync_package_conflicts/);
});

test('P3 expõe API para exportar importar histórico e conflitos', () => {
  const server = read('server.js');
  const route = read('routes/smartSync.js');
  assert.match(server, /sincronizacao-inteligente/);
  assert.match(route, /\/exportar/);
  assert.match(route, /\/importar/);
  assert.match(route, /\/historico/);
  assert.match(route, /\/conflitos/);
});

test('P3 inclui estornos e cadastros no pacote completo', () => {
  const service = read('services/smartSync.js');
  assert.match(service, /accounting_sign/);
  assert.match(service, /reversal_of/);
  assert.match(service, /categories/);
  assert.match(service, /costCenters/);
  assert.match(service, /suppliers/);
  assert.match(service, /transactions/);
});

test('interface P3 oferece pacote ccsync e validação de duplicidade', () => {
  const script = read('public/chatgpt-p3.js');
  const html = read('public/teste-chatgpt.html');
  assert.match(script, /\.ccsync/);
  assert.match(script, /sincronizacao-inteligente\/exportar/);
  assert.match(script, /sincronizacao-inteligente\/importar/);
  assert.match(html, /chatgpt-p3\.js/);
});
