const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('migration D1 de clientes contém os campos usados pelo Worker', () => {
  const migration = read('cloudflare-sync-worker/migrations/004-clientes.sql');
  for (const field of ['id','org_id','company','name','email','active','created_by_email','updated_by_email','created_at','updated_at']) {
    assert.match(migration, new RegExp(`\\b${field}\\b`));
  }
  assert.match(migration, /CREATE TABLE IF NOT EXISTS clients/);
  assert.match(migration, /clients_org_email_unique/);
});
