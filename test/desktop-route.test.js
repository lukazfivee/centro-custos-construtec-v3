const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('rota /d/ entrega o desktop novo e os arquivos que ele usa', async (context) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'centro-custos-desktop-'));
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
  const base = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const semBarra = await fetch(`${base}/d`, { redirect: 'manual' });
  assert.equal(semBarra.status, 301);
  assert.equal(semBarra.headers.get('location'), '/d/');

  const pagina = await fetch(`${base}/d/`);
  assert.equal(pagina.status, 200);
  assert.equal(pagina.headers.get('cache-control'), 'no-cache');
  const html = await pagina.text();
  assert.match(html, /<script src="app\.js"><\/script>/);

  // O app novo usa o nucleo e as fontes do /m/ sem copiar.
  for (const arquivo of ['/d/app.js', '/d/css/tokens.css', '/d/vendor/phosphor/regular/style.css', '/m/core.js', '/m/fonts/plex-400.woff2', '/d/simbolo.png']) {
    const resposta = await fetch(`${base}${arquivo}`);
    assert.equal(resposta.status, 200, arquivo);
  }

  // A raiz abre o desktop novo; celular vai para /m/; a pagina antiga so com ?entrar=1 ou ?antiga=1.
  const raiz = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(raiz.status, 302);
  assert.equal(raiz.headers.get('location'), '/d/');
  const celular = await fetch(`${base}/`, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14; SM-A175F) Mobile Safari/537.36' } });
  assert.equal(celular.headers.get('location'), '/m/');
  for (const consulta of ['?entrar=1', '?antiga=1']) {
    const entrada = await fetch(`${base}/${consulta}`, { redirect: 'manual' });
    assert.equal(entrada.status, 200, consulta);
    assert.doesNotMatch(await entrada.text(), /d-core\.js/);
  }
  // Sem sessao o desktop novo manda para a tela de entrada, e depois de entrar a pagina antiga volta para /d/.
  const appD = fs.readFileSync(path.join(__dirname, '..', 'public', 'd', 'app.js'), 'utf8');
  assert.match(appD, /location\.replace\('\/\?entrar=1'\)/);
  const appAntigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(appAntigo, /irParaDesktopNovo\(\)/);
});

test('menu Suite do Centro nao lista o Portal Hub (desktop novo e pagina antiga)', () => {
  const novo = fs.readFileSync(path.join(__dirname, '..', 'public', 'd', 'suite.js'), 'utf8');
  const antigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  for (const texto of [novo, antigo]) assert.doesNotMatch(texto, /Portal Hub|hub-sistemas-construtec/i);
});
