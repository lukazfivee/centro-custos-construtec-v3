const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const updater = require('../services/updater');
const { resolverFeed, mensagemAmigavel, repositorio } = require('../services/updater-feed');

// Modulo falso do electron-updater: emite os mesmos eventos do real.
function falso(roteiro = {}) {
  const f = new EventEmitter();
  f.chamadas = [];
  f.setFeedURL = (feed) => f.chamadas.push(['setFeedURL', feed]);
  f.checkForUpdates = async () => {
    f.chamadas.push(['check']);
    f.emit('checking-for-update');
    if (roteiro.checkErro) { const e = roteiro.checkErro; f.emit('error', e); throw e; }
    if (roteiro.semNovidade) { f.emit('update-not-available', { version: '3.1.0-rc.19' }); return null; }
    f.emit('update-available', { version: '3.1.0-rc.20', releaseDate: '2026-10-01T10:00:00.000Z', releaseNotes: '<p>Atualização pelo app</p><ul><li>Aviso no topo</li></ul>', files: [{ url: 'x.exe', size: 106184749 }] });
    return {};
  };
  f.downloadUpdate = async () => {
    f.chamadas.push(['download']);
    if (roteiro.downloadErro) { f.emit('error', roteiro.downloadErro); throw roteiro.downloadErro; }
    f.emit('download-progress', { percent: 41.6, bytesPerSecond: 1000, transferred: 40, total: 100 });
    f.emit('update-downloaded', { version: '3.1.0-rc.20' });
  };
  f.quitAndInstall = (silencioso, rodar) => f.chamadas.push(['quitAndInstall', silencioso, rodar]);
  return f;
}

test('atualizador configura o electron-updater para pré-lançamento e instalação ao sair', () => {
  const f = falso();
  updater.__usarModulo(f);
  assert.equal(f.autoDownload, false);
  assert.equal(f.allowPrerelease, true);
  assert.equal(f.allowDowngrade, false);
  assert.equal(f.autoInstallOnAppQuit, true);
  assert.equal(updater.getState().status, 'idle');
  assert.equal(updater.getState().supported, true);
});

test('fluxo completo: verificar, disponível, baixando, baixado e instalar', async () => {
  const f = falso();
  updater.__usarModulo(f);
  const ordem = [];
  updater.setBeforeInstall(async () => { ordem.push('encerrou servicos'); });

  const estado = await updater.check();
  assert.equal(estado.status, 'available');
  assert.equal(estado.info.version, '3.1.0-rc.20');
  assert.equal(estado.info.releaseNotes, 'Atualização pelo app\n• Aviso no topo');
  assert.equal(estado.info.size, 106184749);
  assert.ok(estado.lastCheckedAt);
  assert.deepEqual(f.chamadas[0], ['setFeedURL', { provider: 'generic', url: 'https://exemplo.test/releases' }]);

  const baixado = updater.download();
  assert.equal(updater.getState().status, 'downloading');
  assert.equal((await baixado).status, 'downloaded');
  assert.equal(updater.getState().progress.percent, 100);

  f.quitAndInstall = (...args) => { ordem.push('quitAndInstall'); f.chamadas.push(['quitAndInstall', ...args]); };
  await updater.install();
  assert.deepEqual(ordem, ['encerrou servicos', 'quitAndInstall']);
  assert.deepEqual(f.chamadas.at(-1), ['quitAndInstall', true, true]);
  assert.equal(updater.getState().status, 'installing');
});

test('estado de progresso, sem novidade e erros em português', async () => {
  const sem = falso({ semNovidade: true });
  updater.__usarModulo(sem);
  assert.equal((await updater.check()).status, 'not-available');

  const rede = Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' });
  updater.__usarModulo(falso({ checkErro: rede }));
  const erro = await updater.check();
  assert.equal(erro.status, 'error');
  assert.match(erro.error, /Sem conexão com a internet/);
  assert.match(erro.errorDetail, /ENOTFOUND/);

  const f = falso({ downloadErro: new Error('EACCES: permission denied') });
  updater.__usarModulo(f);
  await updater.check();
  const aposFalha = await updater.download();
  assert.equal(aposFalha.status, 'error');
  assert.match(aposFalha.error, /Sem permissão/);
});

test('baixar e instalar só funcionam no estado certo, e verificar não reinicia download', async () => {
  updater.__usarModulo(falso());
  assert.throws(() => updater.download(), (e) => e.statusCode === 409);
  await assert.rejects(updater.install(), (e) => e.statusCode === 409);
  await updater.check();
  updater.download();
  const durante = await updater.check();
  assert.equal(durante.status, 'downloading');
});

test('fora do Electron o atualizador fica indisponível, sem lançar erro', async () => {
  updater.__usarModulo(null);
  const antes = updater.getState();
  assert.equal(antes.supported, false);
  assert.match(antes.unsupportedReason, /aplicativo instalado/);
  const depois = await updater.check();
  assert.equal(depois.status, 'unavailable');
  assert.match(depois.error, /instalado no Windows/);
});

test('mensagens amigáveis para os erros mais comuns', () => {
  assert.match(mensagemAmigavel(new Error('net::ERR_INTERNET_DISCONNECTED')), /Sem conexão/);
  assert.match(mensagemAmigavel(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })), /Sem conexão/);
  assert.match(mensagemAmigavel(Object.assign(new Error('x'), { code: 'NO_RELEASE' })), /instalador publicada/);
  assert.match(mensagemAmigavel(new Error('Cannot find latest.yml: HttpError: 404')), /instalador publicada/);
  assert.match(mensagemAmigavel(new Error('HttpError: 403 rate limit exceeded')), /recusou o acesso/);
  assert.match(mensagemAmigavel(new Error('sha512 checksum mismatch')), /corrompido/);
  assert.match(mensagemAmigavel(new Error('EPERM: operation not permitted')), /Sem permissão/);
  assert.match(mensagemAmigavel(new Error('algo estranho')), /Tente de novo/);
});

test('feed: escolhe a release mais recente que tem latest.yml, inclusive pré-lançamento', async () => {
  const atom = '<feed><entry><link href="https://github.com/o/r/releases/tag/v3.1.0-rc.21"/></entry><entry><link href="https://github.com/o/r/releases/tag/v3.1.0-rc.20"/></entry></feed>';
  const pedidos = [];
  const fetchImpl = async (url, opcoes = {}) => {
    pedidos.push(`${opcoes.method || 'GET'} ${url}`);
    if (url.endsWith('releases.atom')) return { ok: true, status: 200, text: async () => atom };
    return { ok: !url.includes('rc.21'), status: url.includes('rc.21') ? 404 : 200 };
  };
  const feed = await resolverFeed({ env: { GITHUB_REPO: 'o/r' }, fetchImpl });
  assert.deepEqual(feed, { provider: 'generic', url: 'https://github.com/o/r/releases/download/v3.1.0-rc.20', tag: 'v3.1.0-rc.20' });
  assert.ok(pedidos.includes('HEAD https://github.com/o/r/releases/download/v3.1.0-rc.21/latest.yml'));
});

test('feed: sem release com instalador, UPDATE_FEED_URL e repositório do package.json', async () => {
  const vazio = async (url) => (url.endsWith('.atom') ? { ok: true, text: async () => '<feed></feed>' } : { ok: false });
  await assert.rejects(resolverFeed({ env: { GITHUB_REPO: 'o/r' }, fetchImpl: vazio }), (e) => e.code === 'NO_RELEASE');
  const fixo = await resolverFeed({ env: { UPDATE_FEED_URL: 'https://exemplo.test/app/windows/' }, fetchImpl: vazio });
  assert.equal(fixo.url, 'https://exemplo.test/app/windows');
  assert.equal((await resolverFeed({ env: { UPDATE_FEED_URL: 'http://inseguro.test' }, fetchImpl: vazio }).catch((e) => e.code)), 'NO_RELEASE');
  assert.equal(repositorio({}), 'lukazfivee/centro-custos-construtec-v3');
  assert.equal(repositorio({ GITHUB_REPO: 'invalido' }), 'lukazfivee/centro-custos-construtec-v3');
});

test('rotas /api/update exigem estado correto e respondem em português', async (context) => {
  const resolvido = (modulo) => require.resolve(modulo);
  const original = {};
  for (const m of ['../middleware/auth', '../services/permissions']) original[m] = require.cache[resolvido(m)];
  require.cache[resolvido('../middleware/auth')] = { id: resolvido('../middleware/auth'), filename: resolvido('../middleware/auth'), loaded: true, exports: { autenticar: (req, res, next) => next() } };
  const permissions = require('../services/permissions');
  require.cache[resolvido('../services/permissions')] = { id: resolvido('../services/permissions'), filename: resolvido('../services/permissions'), loaded: true, exports: { ...permissions, exigirPermissao: () => (req, res, next) => next() } };
  delete require.cache[resolvido('../routes/update')];
  const express = require('express');
  const app = express();
  app.use('/api/update', require('../routes/update'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  context.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    delete require.cache[resolvido('../routes/update')];
    for (const [m, e] of Object.entries(original)) { if (e) require.cache[resolvido(m)] = e; else delete require.cache[resolvido(m)]; }
  });
  const base = `http://127.0.0.1:${server.address().port}/api/update`;
  const chamar = async (metodo, rota) => { const r = await fetch(base + rota, { method: metodo }); return [r.status, await r.json()]; };
  const esperar = async (status) => { for (let i = 0; i < 50; i += 1) { if (updater.getState().status === status) return; await new Promise((r) => setTimeout(r, 20)); } assert.fail(`não chegou em ${status}`); };

  const f = falso();
  updater.__usarModulo(f);
  assert.equal((await chamar('GET', '/status'))[1].status, 'idle');
  assert.equal((await chamar('POST', '/download'))[0], 409);
  assert.equal((await chamar('POST', '/install'))[0], 409);
  assert.equal((await chamar('GET', '/check'))[1].ok, true);
  await esperar('available');
  assert.equal((await chamar('GET', '/status'))[1].info.version, '3.1.0-rc.20');
  assert.equal((await chamar('POST', '/download'))[1].ok, true);
  await esperar('downloaded');
  const [status, corpo] = await chamar('POST', '/install');
  assert.equal(status, 200);
  assert.match(corpo.mensagem, /Instalando/);
  for (let i = 0; i < 50 && !f.chamadas.some((c) => c[0] === 'quitAndInstall'); i += 1) await new Promise((r) => setTimeout(r, 40));
  assert.ok(f.chamadas.some((c) => c[0] === 'quitAndInstall'));
});

test('app desktop encerra servidor e módulos antes de instalar e ao sair', () => {
  const main = read('desktop/main-unified.js');
  assert.match(main, /setBeforeInstall\(encerrarServicos\)/);
  assert.match(main, /centroServer = await start\(/);
  assert.match(main, /shutdownGracefully/);
  assert.match(main, /app\.on\('before-quit', \(event\)/);
  assert.match(read('server.js'), /server\.shutdownGracefully = /);
});

test('release publica latest.yml e blockmap do instalador NSIS, sem assinatura obrigatória', () => {
  const flow = read('.github/workflows/publish-v3-1.yml');
  assert.match(flow, /dist\/latest\.yml/);
  assert.match(flow, /dist\/\*\.blockmap/);
  assert.match(flow, /dist\/\*\.exe/);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.build.publish.provider, 'github');
  assert.ok(pkg.build.win.target.some((t) => t.target === 'nsis'));
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.ok(pkg.dependencies['electron-updater']);
  assert.equal(pkg.build.win.publisherName, undefined, 'sem publisherName o electron-updater não exige assinatura');
});

test('desktop novo: aviso, painel e cartão de atualização existem só para o Electron', () => {
  const html = read('public/d/index.html');
  for (const f of ['atualizacao.js', 'atualizacao-painel.js', 'telas/config-atualizacao.js', 'css/atualizacao.css']) {
    assert.ok(html.includes(f), `${f} não está no index.html`);
    assert.ok(read(`public/d/${f}`).split('\n').length <= 350);
  }
  assert.match(read('public/d/shell.js'), /data-upd-aviso/);
  assert.match(read('public/d/app.js'), /D\.upd\.iniciar\(\)/);
  const nucleo = read('public/d/atualizacao.js');
  assert.match(nucleo, /window\.electronAPI && D\.tem\('p9'\)/);
  assert.match(nucleo, /6 \* 60 \* 60 \* 1000/);
  const painel = read('public/d/atualizacao-painel.js');
  for (const t of ['Baixar e instalar', 'Reiniciar e instalar', 'O que mudou', 'role="progressbar"']) assert.ok(painel.includes(t), t);
  assert.doesNotMatch(painel, /innerHTML\s*=\s*[^;]*\binfo\.releaseNotes/);
  assert.match(read('public/d/telas/config-sistema.js'), /window\.electronAPI && C\.atualizacaoCartao/);
  assert.match(read('public/d/telas/config-atualizacao.js'), /Verificar atualização/);
});

// Comportamento do nucleo do front com um CC falso.
function carregarNucleo({ electron = true, pode = true, respostas = [] }) {
  const armazenamento = new Map();
  const D = { tem: () => pode, ic: () => '', data: () => '01/10/2026' };
  const bt = { hidden: true, innerHTML: '', addEventListener() {}, setAttribute() {} };
  let i = 0;
  const CC = {
    d: D, esc: (t) => String(t), $: () => bt,
    api: async (rota) => { if (rota === '/update/check') return { data: { ok: true } }; const r = respostas[Math.min(i, respostas.length - 1)]; i += 1; return { data: r }; },
  };
  const contexto = { window: { CC, electronAPI: electron ? {} : undefined }, localStorage: { getItem: (k) => armazenamento.get(k) ?? null, setItem: (k, v) => armazenamento.set(k, v) }, setTimeout: (fn) => { fn(); return 0; }, setInterval() {}, Date, Number, Promise };
  vm.runInNewContext(read('public/d/atualizacao.js'), contexto);
  return { D, bt, armazenamento };
}

test('núcleo do front: só no Electron e para admin; espera a verificação e guarda a hora', async () => {
  assert.equal(carregarNucleo({ electron: false }).D.upd.disponivel(), false);
  assert.equal(carregarNucleo({ pode: false }).D.upd.disponivel(), false);

  const { D, bt, armazenamento } = carregarNucleo({ respostas: [{ status: 'checking' }, { status: 'checking' }, { status: 'available', info: { version: '3.1.0-rc.20' }, progress: { percent: 0 } }] });
  assert.equal(D.upd.venceu(), true);
  const e = await D.upd.verificar();
  assert.equal(e.status, 'available');
  assert.equal(bt.hidden, false);
  assert.match(bt.innerHTML, /Nova versão 3\.1\.0-rc\.20 disponível/);
  assert.ok(armazenamento.get('cc_d_upd_ultima'));
  assert.equal(D.upd.venceu(), false);

  const erro = carregarNucleo({ respostas: [{ status: 'error', error: 'Sem conexão' }] });
  await erro.D.upd.verificar();
  assert.equal(erro.armazenamento.has('cc_d_upd_ultima'), false, 'erro não conta como verificação feita');
  assert.equal(erro.bt.hidden, true);
});
