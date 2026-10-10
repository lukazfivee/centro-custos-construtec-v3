const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('o app Suíte do Windows junta Centro e Orçamentos numa janela só', () => {
  const main = read('desktop/main-unified.js');
  assert.match(main, /new WebContentsView/, 'cada tela é uma view da mesma janela');
  assert.match(main, /ipcMain\.handle\('suite:switch'/);
  assert.match(main, /\/api\/auth\/suite-handoff/, 'o Orçamentos recebe a sessão do Centro');
  assert.match(main, /'x-suite-internal': process\.env\.CONSTRUTEC_SUITE_INTERNAL_KEY/, 'o pedido da sessão leva a chave interna da execução');
  assert.match(main, /sessao=\$\{encodeURIComponent\(session\)\}/, 'a sessão vai ao Orçamentos em #sessao=, sem a chave de serviço do servidor');
  assert.doesNotMatch(main, /CONSTRUTEC_IDENTITY_KEY/, 'o segredo do servidor não é usado nem embutido no app');
  assert.match(main, /buttons: \['Tentar de novo', 'Cancelar'\]/, 'o Orçamentos que não subiu pode ser tentado de novo sem reiniciar a Suíte');
  assert.doesNotMatch(main, /chamadopro|start-construtec|spawn\(/, 'nenhum processo filho nem pasta de fora do app');
  const modules = require('../desktop/suite-modules')(ROOT);
  assert.equal(modules.centro.port, 3333, 'porta do firewall do acesso móvel');
  for (const file of [modules.orcamentos.entry, modules.orcamentos.preload, modules.orcamentos.renderer]) {
    assert.ok(file.startsWith(path.join(ROOT, 'modules')), `${file} fica em modules/ (gerado, fora do Git)`);
  }
});

test('a Suíte tem barra de título própria com as telas abaixo dela', () => {
  const main = read('desktop/main-unified.js');
  assert.match(main, /titleBarStyle: 'hidden'/);
  assert.match(main, /titleBarOverlay: \{ color: BAR_COLOR, symbolColor: BAR_SYMBOLS, height: BAR_HEIGHT \}/);
  assert.match(main, /y: BAR_HEIGHT, width, height: Math\.max\(0, height - BAR_HEIGHT\)/, 'Centro e Orçamentos começam abaixo da barra');
  assert.match(main, /page-title-updated/, 'o título da janela é o da tela ativa');
  assert.match(main, /send\('suite:active', target\)/);
  const html = read('desktop/titlebar.html');
  assert.match(html, /-webkit-app-region: drag/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /--nav: #031f29/, 'mesma cor do menu do Orçamentos');
  const pkg = JSON.parse(read('package.json'));
  for (const file of ['desktop/titlebar.html', 'desktop/titlebar.js', 'desktop/titlebar-preload.js']) assert.ok(pkg.build.files.includes(file), `${file} entra no pacote`);
});

test('o preload e o menu Suíte do Centro trocam de tela pelo app', () => {
  assert.match(read('desktop/preload.js'), /suiteSwitch:\s*\(target, hash\)\s*=>\s*ipcRenderer\.invoke\('suite:switch'/);
  const menu = read('public/d/suite.js');
  assert.match(menu, /window\.electronAPI\.suiteSwitch\('orcamentos'\)/);
  assert.match(menu, /link\.href === ORCAMENTOS/);
});

test('o instalador leva a configuração do app e prepara o Orçamentos antes de empacotar', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const file of ['desktop/main-unified.js', 'desktop/centro-runtime.js', 'desktop/suite-modules.js', 'desktop/preload.js', 'modules/**/*']) {
    assert.ok(pkg.build.files.includes(file), `${file} entra no pacote`);
  }
  for (const script of ['prebuild', 'prebuild:portable', 'prebuild:dir']) {
    assert.equal(pkg.scripts[script], 'npm run suite:prepare', `${script} gera modules/ antes do electron-builder`);
  }
  for (const workflow of ['build-windows.yml', 'publish-v3-1.yml']) {
    const yml = read(`.github/workflows/${workflow}`);
    assert.match(yml, /repository: lukazfivee\/construtec-orcamentos/, `${workflow} baixa o Orçamentos`);
    assert.ok(yml.indexOf('construtec-orcamentos') < yml.indexOf('npm run build'), `${workflow} baixa o Orçamentos antes do build`);
  }
});

test('POST /auth/suite-handoff só serve conta corporativa e só para o Orçamentos', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-suite-handoff-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
  delete process.env.DATABASE_URL;

  const { initializeDatabase, closeDatabase } = require('../db');
  const { createApp } = require('../server');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  context.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const post = (token, body) => fetch(`${base}/auth/suite-handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@teste.local', senha: 'senha-teste-123' }) });
  const token = (await login.json()).token;

  assert.equal((await post(null, { target: 'orcamentos' })).status, 401, 'sem sessão');
  assert.equal((await post(token, { target: 'chamados' })).status, 400, 'destino que não existe');
  assert.equal((await post(token, { target: 'orcamentos' })).status, 409, 'conta local não tem sessão central');
});

test('POST /auth/suite-handoff entrega a sessão corporativa só ao processo principal da Suíte', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-suite-session-'));
  process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'database');
  process.env.RESTORE_ROOT_DIR = path.join(tempRoot, 'restore');
  process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.ADMIN_INITIAL_PASSWORD = 'senha-teste-123';
  process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
  process.env.CONSTRUTEC_SUITE_INTERNAL_KEY = 'k'.repeat(64);
  process.env.SYNC_API_URL = 'http://127.0.0.1:9';
  delete process.env.DATABASE_URL;

  const jwt = require('jsonwebtoken');
  const { initializeDatabase, closeDatabase, getDb } = require('../db');
  const { mirrorCloudUser } = require('../services/cloudUserMirror');
  const { createApp } = require('../server');
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  context.after(async () => {
    delete process.env.CONSTRUTEC_SUITE_INTERNAL_KEY;
    delete process.env.SYNC_API_URL;
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const user = await mirrorCloudUser(getDb(), { id: 'cloud-9', name: 'Corporativa', email: 'conta@rcconstrutec.com.br', role: 'gestor' }, { sessionToken: 'sessao+central/de+teste' });
  const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(user.id), expiresIn: '1h' });
  const post = (internal) => fetch(`${base}/auth/suite-handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(internal ? { 'x-suite-internal': internal } : {}) },
    body: JSON.stringify({ target: 'orcamentos' }),
  });

  const ok = await post('k'.repeat(64));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { sessionToken: 'sessao+central/de+teste' });
  for (const wrong of [undefined, '', 'k'.repeat(63), 'x'.repeat(64)]) {
    const response = await post(wrong);
    const body = await response.json();
    assert.notEqual(response.status, 200, `chave ${JSON.stringify(wrong)} não entrega a sessão`);
    assert.equal(body.sessionToken, undefined);
  }
});
