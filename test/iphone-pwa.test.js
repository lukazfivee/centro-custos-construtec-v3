const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('JavaScript da PWA possui sintaxe valida', () => {
  for (const file of ['cloudflare-sync-worker/public/app-v2.js', 'cloudflare-sync-worker/public/sw.js']) {
    const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stderr || result.stdout}`);
  }
});

test('manifesto da PWA usa modo standalone', () => {
  const manifest = JSON.parse(read('cloudflare-sync-worker/public/manifest.webmanifest'));
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
});

test('service worker nao intercepta dados autenticados', () => {
  const sw = read('cloudflare-sync-worker/public/sw.js');
  assert.match(sw, /pathname\.startsWith\('\/v1\/'\)/);
  assert.match(sw, /pathname==='\/health'/);
});

test('PWA usa login corporativo e sincronizacao V3', () => {
  const app = read('cloudflare-sync-worker/public/app-v2.js');
  assert.match(app, /\/v1\/auth\/login/);
  assert.match(app, /\/v1\/sync\/snapshot/);
  assert.match(app, /formatVersion:3/);
  assert.match(app, /payloadHash/);
  assert.doesNotMatch(app, /SYNC_SHARED_KEY|CLOUDFLARE_API_TOKEN/);
});

test('configuracao do Worker serve assets e preserva rotas de API', () => {
  const wrangler = read('cloudflare-sync-worker/wrangler.toml.example');
  assert.match(wrangler, /directory = "\.\/public"/);
  assert.match(wrangler, /not_found_handling = "single-page-application"/);
  assert.match(wrangler, /"\/v1\/\*"/);
  assert.match(wrangler, /database_name = "centro-custos-producao"/);
});
