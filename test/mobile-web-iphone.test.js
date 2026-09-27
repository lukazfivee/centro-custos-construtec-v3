const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('iPhone: site do celular instalável na tela de início', () => {
  const html = read('public/m/index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icon-180\.png">/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /viewport-fit=cover/);
  const manifest = JSON.parse(read('public/m/manifest.webmanifest'));
  assert.equal(manifest.start_url, '/m/');
  assert.equal(manifest.scope, '/m/');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const png = fs.readFileSync(path.join(ROOT, 'public', 'm', icon.src));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', `${icon.src} não é PNG`);
    const [w, h] = icon.sizes.split('x').map(Number);
    assert.equal(png.readUInt32BE(16), w, `${icon.src} largura`);
    assert.equal(png.readUInt32BE(20), h, `${icon.src} altura`);
  }
  assert.equal(fs.readFileSync(path.join(ROOT, 'public/m/icon-180.png')).readUInt32BE(16), 180);
});

test('iPhone: tela de entrar própria no /m/ (o app da tela de início não divide o login com o Safari)', () => {
  const app = read('public/m/app.js');
  const entrar = read('public/m/screen-entrar.js');
  assert.match(app, /CC\.loginScreen\(message, \(\) => start\(\)\)/);
  assert.match(app, /suite:\/\/entrar/); // no app Android continua voltando para a tela do app
  assert.match(entrar, /post\('\/api\/auth\/login', \{ email: value, senha: senha\.value \}\)/);
  assert.match(entrar, /CC\.session\.save\(data\)/);
  assert.match(entrar, /autocomplete="current-password"/);
  assert.match(entrar, /autocomplete="username"/);
  assert.match(entrar, /\/v1\/auth\/password-reset\/request/);
  assert.match(entrar, /Adicionar à Tela de Início/);
  assert.doesNotMatch(entrar, /localStorage\.setItem\('cc_(?:token|senha)/);
  assert.match(read('public/m/screen-misc.js'), /location\.replace\('\/m\/'\)/);
});

test('iPhone: login no navegador não chama o esquema suite:// do app', () => {
  const app = read('public/m/app.js');
  const signedOut = app.slice(app.indexOf('function signedOut'), app.indexOf('CC.onUnauthorized'));
  assert.ok(signedOut.indexOf('CC.loginScreen') < signedOut.indexOf('suite://entrar'));
});
