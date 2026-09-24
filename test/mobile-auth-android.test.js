const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JAVA = 'android/app/src/main/java/br/com/rcconstrutec/centrocustos';
const ASSETS = 'android/app/src/main/assets/auth';
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const list = (dir, ext) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`);

test('ponte JavaScript so existe na WebView local e confere a origem', () => {
  const javaFiles = list(JAVA, '.java');
  const withBridge = javaFiles.filter((f) => /addJavascriptInterface\(/.test(read(f)));
  assert.deepEqual(withBridge, [`${JAVA}/AuthWebView.java`]);
  const authView = read(`${JAVA}/AuthWebView.java`);
  assert.match(authView, /HOST = "appassets\.androidplatform\.net"/);
  assert.match(authView, /return isLocal\(url\) \? serve\(url\) : response\(403/);
  assert.match(authView, /return !isLocal\(request\.getUrl\(\)\)/);
  assert.match(authView, /setAllowFileAccess\(false\)/);
  const bridge = read(`${JAVA}/AuthBridge.java`);
  assert.match(bridge, /if \(!host\.trusted\(\)/);
  assert.equal((bridge.match(/@JavascriptInterface/g) || []).length, 1);
  assert.doesNotMatch(read(`${JAVA}/MainActivity.java`), /addJavascriptInterface/);
});

test('cofre usa Keystore, PBKDF2 com 150 mil iteracoes e biometria com CryptoObject', () => {
  const vault = read(`${JAVA}/SessionVault.java`);
  assert.match(vault, /ITERATIONS = 150_000/);
  assert.match(vault, /PBKDF2WithHmacSHA256/);
  assert.match(vault, /"AndroidKeyStore"/);
  assert.match(vault, /AES\/GCM\/NoPadding/);
  assert.match(vault, /setUserAuthenticationRequired\(true\)/);
  assert.match(vault, /setInvalidatedByBiometricEnrollment\(true\)/);
  assert.match(vault, /writeAttempts\(failures \+ 1\);[\s\S]*derive\(pin/, 'a tentativa e contada antes de conferir o PIN');
  assert.match(vault, /if \(now >= MAX_ATTEMPTS\) wipePin\(true\)/);
  const gate = read(`${JAVA}/BiometricGate.java`);
  assert.match(gate, /new BiometricPrompt\.CryptoObject\(cipher\)/);
  assert.match(gate, /BIOMETRIC_STRONG/);
});

test('nada de log, senha guardada ou endereco fixo no codigo nativo', () => {
  for (const file of list(JAVA, '.java')) {
    const source = read(file);
    assert.doesNotMatch(source, /\bLog\.[vdiwe]\(|System\.out\.print|printStackTrace/, file);
    assert.doesNotMatch(source, /workers\.dev/, `${file}: a URL vem do build.gradle`);
  }
  const controller = read(`${JAVA}/AuthController.java`);
  assert.doesNotMatch(controller, /put\("password"/);
  const api = read(`${JAVA}/CentralApi.java`);
  for (const header of ['x-instance-id', 'x-instance-name', 'x-client']) assert.match(api, new RegExp(`"${header}"`));
  assert.match(api, /"Android · "/);
  assert.match(api, /"suite-android\/"/);
});

test('shell: FLAG_SECURE nas telas de entrada, barra transparente e App Link', () => {
  const main = read(`${JAVA}/MainActivity.java`);
  assert.match(main, /addFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/);
  assert.match(main, /#handoff=/);
  assert.doesNotMatch(main, /sessionToken/, 'o token nunca vai na URL das paginas');
  const bars = read(`${JAVA}/SystemBars.java`);
  assert.match(bars, /setStatusBarColor\(Color\.TRANSPARENT\)/);
  for (const file of ['android/app/src/main/res/values/styles.xml', 'android/app/src/main/res/values-night/styles.xml']) {
    assert.match(read(file), /statusBarColor">@android:color\/transparent/);
  }
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android\.permission\.USE_BIOMETRIC/);
  assert.match(manifest, /android:autoVerify="true"/);
  assert.match(manifest, /android:host="\$\{centralHost\}" android:pathPrefix="\/redefinir-senha"/);
  const gradle = read('android/app/build.gradle');
  assert.match(gradle, /minSdk 28/);
  assert.match(gradle, /buildConfigField 'String', 'CENTRAL_API_BASE'/);
  assert.match(gradle, /!dev-bridge\.js/);
});

test('telas locais: sem armazenamento do navegador, sem rede direta e CSP restrita', () => {
  const html = read(`${ASSETS}/index.html`);
  assert.match(html, /Content-Security-Policy[^>]*default-src 'self'[^>]*connect-src 'self'/);
  for (const file of list(ASSETS, '.js').filter((f) => !f.endsWith('dev-bridge.js'))) {
    const source = read(file);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/, file);
  }
  assert.match(read(`${ASSETS}/success.css`), /animation: ctLogo[^;]*\.80s/);
  assert.ok(fs.existsSync(path.join(ROOT, ASSETS, 'img/simbolo.png')));
});

test('arquivos da Fase 1 respeitam 350 linhas e nao tem emojis', () => {
  const files = [
    ...list(JAVA, '.java'), ...list(ASSETS, '.js'), ...list(ASSETS, '.css'), ...list(ASSETS, '.html'),
    'scripts/mock-central-auth.mjs', 'android/app/build.gradle', 'android/app/src/main/AndroidManifest.xml',
  ].filter((f) => !f.endsWith('icons.js'));
  for (const file of files) {
    const source = read(file);
    assert.ok(source.split('\n').length <= 350, `${file} passou de 350 linhas`);
    assert.doesNotMatch(source, /\p{Extended_Pictographic}/u, `${file} tem emoji`);
  }
});
