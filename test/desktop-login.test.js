// Tela de entrar do desktop /d/ (Rodada 29): estrutura da tela, tentativas restantes e bloqueio
// informados pelo servidor, e o pedido de senha nova repassado ao diretorio quando roda local (Suite).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.PGLITE_DATA_DIR = path.join(os.tmpdir(), `centro-custos-d-login-${process.pid}`);
process.env.RESTORE_ROOT_DIR = path.join(os.tmpdir(), `centro-custos-d-login-restore-${process.pid}`);
process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.ADMIN_INITIAL_PASSWORD = 'Admin@123456';
process.env.ADMIN_INITIAL_EMAIL = 'admin@teste.local';
delete process.env.DATABASE_URL;

const { createLoginThrottle } = require('../lib/loginThrottle');
const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('tela de entrar do /d/: carregada antes do app, com os estados do desenho', () => {
  const index = ler('public/d/index.html');
  assert.ok(index.indexOf('login.js') > 0 && index.indexOf('login.js') < index.indexOf('src="app.js"'));
  assert.match(index, /css\/login\.css/);
  const tela = ler('public/d/login.js');
  for (const texto of ['Entrar', 'Manter conectado neste computador', 'Esqueci a senha', 'Criar uma senha nova', 'Recuperar a senha',
    'Confira seu e-mail', 'Reenviar link', 'Voltar para entrar', 'Falta preencher', 'E-mail ou senha não conferem', 'Sem internet',
    'Sua sessão terminou', 'Você saiu do Centro de Custos', 'Primeiro acesso?', 'Entrando…']) assert.ok(tela.includes(texto), texto);
  assert.match(tela, /postar\('\/api\/auth\/login', \{ email: valor, senha: senha\.value \}\)/);
  assert.match(tela, /'\/v1\/auth\/password-reset\/request'/);
  assert.match(tela, /autocomplete="current-password"/);
  assert.match(tela, /autocomplete="username"/);
  assert.doesNotMatch(tela, /setItem\([^)]*senha/); // a senha nunca vai para o armazenamento
  assert.doesNotMatch(tela, /\b(alert|confirm|prompt)\(/);
  for (const rel of ['public/d/login.js', 'public/d/css/login.css', 'public/d/app.js']) assert.ok(ler(rel).split('\n').length <= 350, rel);
  // Sair e sessao terminada voltam para a tela nova com o aviso.
  assert.match(ler('public/d/shell.js'), /D\.sessao\.avisar\('sair'\);\s*location\.replace\('\/d\/'\)/);
  assert.match(ler('public/d/app.js'), /D\.sessao\.avisar\('exp'\)/);
});

test('bloqueio de login devolve quantas falhas a chave ja tem', () => {
  let agora = 0;
  const trava = createLoginThrottle({ maxFailures: 3, windowMs: 1000, blockMs: 1000, clock: () => agora });
  assert.equal(trava.fail('a'), 1);
  assert.equal(trava.fail('a'), 2);
  assert.equal(trava.fail(''), 0);
  assert.equal(trava.fail('a'), 3);
  assert.equal(trava.blockedMinutes('a'), 1);
  agora = 2000;
  assert.equal(trava.fail('a'), 1);
});

test('login informa tentativas restantes, bloqueio e repassa o pedido de senha nova', async (t) => {
  const { initializeDatabase, closeDatabase } = require('../db');
  const { createApp } = require('../server');
  const cloudAuth = require('../services/cloudAuth');
  fs.rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
  await initializeDatabase();
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const original = cloudAuth.requestPasswordReset;
  t.after(async () => {
    cloudAuth.requestPasswordReset = original;
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
    fs.rmSync(process.env.PGLITE_DATA_DIR, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (rota, corpo) => {
    const r = await fetch(`${base}${rota}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    return { status: r.status, data: await r.json() };
  };
  const login = (senha) => post('/api/auth/login', { email: 'admin@teste.local', senha });

  assert.equal((await login('Admin@123456')).status, 200);
  for (const restantes of [4, 3, 2, 1]) {
    const r = await login('errada');
    assert.equal(r.status, 401);
    assert.equal(r.data.tentativasRestantes, restantes);
    assert.equal(r.data.bloqueadoMinutos, undefined);
  }
  const ultima = await login('errada');
  assert.equal(ultima.status, 401);
  assert.equal(ultima.data.tentativasRestantes, 0);
  assert.equal(ultima.data.bloqueadoMinutos, 15);
  const preso = await login('Admin@123456');
  assert.equal(preso.status, 429);
  assert.equal(preso.data.bloqueadoMinutos, 15);

  const pedidos = [];
  cloudAuth.requestPasswordReset = async (email) => { pedidos.push(email); return { ok: true }; };
  assert.deepEqual(await post('/v1/auth/password-reset/request', { email: ' Marina@RCConstrutec.com.br ' }), { status: 202, data: { ok: true } });
  assert.deepEqual(pedidos, ['marina@rcconstrutec.com.br']);
  cloudAuth.requestPasswordReset = async () => { const e = new Error('fora do ar'); e.status = 503; throw e; };
  const falhou = await post('/v1/auth/password-reset/request', { email: 'marina@rcconstrutec.com.br' });
  assert.equal(falhou.status, 503);
  assert.match(falhou.data.erro, /Verifique a internet/);
});
