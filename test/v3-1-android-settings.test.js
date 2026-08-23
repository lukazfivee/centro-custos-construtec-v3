const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('configuracoes usam superficie continua e navegacao movel', () => {
  const html = read('public/index.html');
  const css = read('public/v3-1-figma.css');
  assert.match(html, /class="settings-layout"/);
  assert.match(html, /id="config-celular"/);
  assert.match(html, /class="mobile-bottom-nav"/);
  assert.match(html, /id="mobile-theme"/);
  assert.match(css, /Configurações como documento continuo|Configuracoes como documento continuo/);
  assert.match(css, /#view-config \.settings-grid>\.panel\{[^}]*border:0[^}]*border-bottom:1px/);
  assert.match(css, /\.fab-theme,\.fab-bug\{display:none!important\}/);
});

test('acesso Android exige ativacao no Windows e restringe HTTP a rede privada', () => {
  const desktop = read('desktop/main.js');
  const preload = read('desktop/preload.js');
  const server = read('server.js');
  const android = read('android/app/src/main/java/br/com/rcconstrutec/centrocustos/MainActivity.java');
  assert.match(desktop, /mobileAccess === true \? '0\.0\.0\.0' : '127\.0\.0\.1'/);
  assert.match(preload, /setMobileAccess/);
  assert.match(server, /mobileUrls/);
  assert.match(server, /QRCode\.toString/);
  assert.match(desktop, /New-NetFirewallRule/);
  assert.match(desktop, /-Profile Any -RemoteAddress LocalSubnet/);
  assert.match(android, /scheme\.equals\("https"\)/);
  assert.match(android, /isPrivateHost\(host\)/);
  assert.match(android, /setMixedContentMode\(WebSettings\.MIXED_CONTENT_NEVER_ALLOW\)/);
});

test('workflow RC12 publica instalador Windows e APK Android', () => {
  const workflow = read('.github/workflows/publish-v3-1.yml');
  assert.match(workflow, /assembleDebug/);
  assert.match(workflow, /Centro-de-Custos-Construtec-Android-3\.1\.0-rc\.12\.apk/);
  assert.match(workflow, /dist\/\*\.apk/);
});
