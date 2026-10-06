const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const java = (name) => read(`android/app/src/main/java/br/com/rcconstrutec/centrocustos/${name}.java`);

test('workflow: versao e codigo saem do numero da RC, com hash e resumo publicados', () => {
  const workflow = read('.github/workflows/publish-v3-1.yml');
  assert.match(workflow, /APP_VERSION_CODE=\$\(31000 \+ \[int\]\$env:RC_NUMBER\)/);
  assert.match(workflow, /-PappVersionName=\$env:APP_VERSION/);
  assert.match(workflow, /-PappVersionCode=\$env:APP_VERSION_CODE/);
  assert.match(workflow, /Get-FileHash \$apk -Algorithm SHA256/);
  assert.match(workflow, /dist\/latest-android\.json/);
  assert.match(workflow, /dist\/\*\.apk\.sha256/);
  assert.match(workflow, /UTF8Encoding \$false/, 'json sem BOM');
  assert.doesNotMatch(workflow, /rc\.19/);
});

test('app: permissao, provider so de leitura e confinado a pasta de atualizacao', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
  assert.match(manifest, /android:name="\.UpdateFileProvider"[\s\S]*?android:authorities="\$\{applicationId\}\.update"[\s\S]*?android:exported="false"[\s\S]*?android:grantUriPermissions="true"/);
  const provider = java('UpdateFileProvider');
  assert.match(provider, /Somente leitura/);
  assert.match(provider, /getCanonicalFile\(\)/);
  assert.match(provider, /name\.endsWith\("\.apk"\)/);
});

test('app: fluxo consulta, confere o hash e instala so com permissao', () => {
  const api = java('UpdateApi');
  const updater = java('AppUpdater');
  const policy = java('UpdatePolicy');
  assert.match(api, /\/v1\/app\/android\/latest/);
  assert.match(api, /MessageDigest\.getInstance\("SHA-256"\)/);
  assert.match(api, /não passou na verificação de segurança/);
  assert.match(api, /Accept-Encoding", "identity"/);
  assert.match(api, /setInstanceFollowRedirects\(false\)/);
  assert.match(policy, /6L \* 60L \* 60L \* 1000L/, 'no maximo 1 vez a cada 6 h');
  assert.match(policy, /startsWith\(api \+ "\/"\)/, 'APK so do mesmo servidor da API');
  assert.match(updater, /canRequestPackageInstalls\(\)/);
  assert.match(updater, /Settings\.ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
  assert.match(updater, /Intent\.ACTION_VIEW/);
  assert.match(updater, /UpdateFileProvider\.MIME/);
  assert.match(updater, /FLAG_GRANT_READ_URI_PERMISSION/);
  assert.match(updater, /Atualizar agora/);
  assert.match(updater, /"Depois"/);
  assert.match(updater, /Tentar de novo/);
  assert.match(updater, /Sem conexão com a internet/);
  assert.doesNotMatch(updater + api, /GITHUB_RELEASES_TOKEN|ghp_|Bearer/, 'o app nunca conhece o token');
  for (const name of ['AppUpdater', 'UpdateApi', 'UpdateDialogs', 'UpdateFileProvider', 'UpdatePolicy', 'MainActivity']) {
    assert.ok(java(name).split('\n').length <= 350, `${name} passa de 350 linhas`);
  }
});

test('app: aviso espera o PIN e o Menu fala com o app por suite://atualizacao', () => {
  const main = java('MainActivity');
  assert.match(main, /canShowDialog\(\) \{ return auth\.unlocked\(\) && !authVisible\(\); \}/);
  assert.match(main, /updater\.autoCheck\(\)/);
  assert.match(main, /hideAuth\(\); updater\.flush\(\)/);
  assert.match(main, /updater\.handleLink\(action, central && auth\.unlocked\(\)\)/);
  assert.match(main, /SuiteBuild\/" \+ BuildConfig\.VERSION_CODE/);
  assert.match(main, /updater\.resume\(\)/);
  assert.match(main, /updater\.destroy\(\)/);
  assert.match(java('AppUpdater'), /"atualizacao\/"/);
});

test('/m/: item do Menu e tela de atualizacao so no app, com versao instalada e Atualizar agora', () => {
  const menu = read('public/m/screen-misc.js');
  assert.match(menu, /\$\{inApp && CC\.screens\.atualizacao \? `<button[^`]*id="m-upd"[^`]*Atualização do aplicativo/);
  assert.match(menu, /CC\.go\('atualizacao'\)/);
  const screen = read('public/m/screen-atualizacao.js');
  assert.match(screen, /\/v1\/app\/android\/latest/);
  assert.match(screen, /suite:\/\/atualizacao\/instalar/);
  assert.match(screen, /Verificar atualização/);
  assert.match(screen, /Atualizar agora/);
  assert.match(read('public/m/index.html'), /screen-atualizacao\.js/);
  assert.match(read('public/m/sw.js'), /'screen-atualizacao\.js'/);
  assert.match(read('public/m/app.js'), /'descartada', 'atualizacao'\]/);
});

test('/m/: le versao do navegador embutido e compara codigos', () => {
  const CC = { screens: {}, esc: (v) => String(v), icon: () => '' };
  const sandbox = { window: { CC }, navigator: { userAgent: 'Mozilla/5.0 SuiteConstrutec/3.1.0-rc.20 SuiteBuild/31020' } };
  vm.runInNewContext(read('public/m/screen-atualizacao.js'), sandbox);
  assert.deepEqual({ ...CC.appBuild() }, { inApp: true, name: '3.1.0-rc.20', code: 31020 });
  assert.equal(CC.hasNewerBuild(31020, 31021), true);
  assert.equal(CC.hasNewerBuild(31020, 31020), false);
  assert.equal(CC.hasNewerBuild(31020, 31019), false);
  assert.equal(CC.hasNewerBuild(0, 31021), false, 'app antigo sem codigo nao compara');
  sandbox.navigator.userAgent = 'Mozilla/5.0 (iPhone) Safari';
  assert.equal(CC.appBuild().inApp, false);
});
