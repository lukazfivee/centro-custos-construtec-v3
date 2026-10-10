// Suíte Construtec para Windows: uma janela, um instalador, duas telas.
// - Centro de Custos: o servidor Express local (server.js) em 127.0.0.1:3333, aberto em /d/.
// - Orçamentos: API local e IPC do pacote modules/orcamentos-main (gerado a partir do repositório do
//   Orçamentos por scripts/build-suite-modules.js) e o renderer em modules/orcamentos, aberto por arquivo.
// Cada tela é uma WebContentsView com o seu preload; o menu Suíte de cada uma chama `suite:switch`.
// A conta entra uma vez no Centro e vai para o Orçamentos por um código de uso único (handoff).
const { app, BrowserWindow, WebContentsView, nativeImage, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const suiteModules = require('./suite-modules');
const createCentroRuntime = require('./centro-runtime');

let mainWindow = null;
let isQuitting = false;
let centroView = null;
let orcView = null;
let activeTarget = 'centro';
let orcamentosMain = null;
let orcamentosStart = null;
let centroServer = null;
let encerrado = false;
let handoffToken;

const ICON = path.join(__dirname, 'icon.png');
const CENTRO_PRELOAD = path.join(__dirname, 'preload.js');
// Só para testes e QA: aponta todos os dados (Centro e Orçamentos) para outra pasta em vez de %APPDATA%.
if (process.env.CONSTRUTEC_DATA_ROOT) app.setPath('appData', process.env.CONSTRUTEC_DATA_ROOT);
const gotLock = app.requestSingleInstanceLock();

const APP_ROOT = path.join(__dirname, '..');
const MODULES = suiteModules(APP_ROOT);
const CENTRO_URL = `http://127.0.0.1:${MODULES.centro.port}/d/`;
const TARGETS = ['centro', 'orcamentos'];
// Barra de título própria (Windows): faixa fixa no topo; as duas telas ocupam o que sobra abaixo dela.
const BAR_HEIGHT = 36;
const BAR_COLOR = '#031f29';
const BAR_SYMBOLS = '#b9d4dd';
const runtime = createCentroRuntime({ appRoot: APP_ROOT, port: MODULES.centro.port });
const { loadEnv, loadPrefs, savePrefs, configureLocalFirewall, afterServerStart } = runtime;

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  function orcamentosAvailable() {
    return fs.existsSync(MODULES.orcamentos.entry) && fs.existsSync(MODULES.orcamentos.renderer);
  }

  function liveView(view) {
    return view && !view.webContents.isDestroyed() ? view : null;
  }

  // ---- Troca de tela -------------------------------------------------------------------------------

  function fitViews() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [width, height] = mainWindow.getContentSize();
    for (const view of [centroView, orcView]) liveView(view)?.setBounds({ x: 0, y: BAR_HEIGHT, width, height: Math.max(0, height - BAR_HEIGHT) });
  }

  function showTarget(target) {
    activeTarget = target;
    const active = target === 'orcamentos' ? orcView : centroView;
    const other = target === 'orcamentos' ? centroView : orcView;
    liveView(other)?.setVisible(false);
    if (liveView(active)) {
      active.setVisible(true);
      active.webContents.focus();
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('suite:active', target);
    mainWindow?.setTitle(target === 'orcamentos' ? 'Suíte Construtec — Orçamentos' : 'Suíte Construtec — Centro de Custos');
  }

  async function readCentroToken() {
    const centro = liveView(centroView);
    if (!centro) return null;
    try { return (await centro.webContents.executeJavaScript("localStorage.getItem('cc_token')")) || null; } catch { return null; }
  }

  // Sessão corporativa do usuário, pedida ao servidor do Centro com o token da tela do Centro. A troca de um
  // código de uso único no Centro exige a chave de serviço (segredo do servidor, fora do instalador); aqui os
  // dois servidores rodam no mesmo processo e o Centro só entrega a sessão a quem tem a chave interna da execução.
  async function requestOrcamentosSession(token) {
    try {
      const response = await fetch(`http://127.0.0.1:${MODULES.centro.port}/api/auth/suite-handoff`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-suite-internal': process.env.CONSTRUTEC_SUITE_INTERNAL_KEY },
        body: JSON.stringify({ target: 'orcamentos' }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return typeof data.sessionToken === 'string' && data.sessionToken ? data.sessionToken : null;
    } catch {
      return null;
    }
  }

  // Com a tela já aberta, trocar só o # é navegação no mesmo documento: o app não reinicia e a sessão nova
  // não entra. Por isso, nesse caso, recarrega depois de pôr o # novo.
  async function loadOrcamentos(hash) {
    const web = orcView.webContents;
    const reload = web.getURL().startsWith('file:');
    await web.loadFile(MODULES.orcamentos.renderer, hash ? { hash } : undefined);
    if (reload && !web.isDestroyed()) web.reload();
  }

  // Encerra a sessão que o Orçamentos recebeu do Centro (o Centro saiu ou entrou outra conta).
  async function resetOrcamentosSession() {
    await orcView.webContents.executeJavaScript(
      "sessionStorage.removeItem('construtec.auth.session'); localStorage.removeItem('construtec.auth.session')",
    ).catch(() => {});
  }

  // A conta entra uma vez no Centro. Ao ir para o Orçamentos, se o token do Centro mudou desde a última
  // entrega (primeira vez, outra conta, saída), o Orçamentos recebe um handoff novo; fora isso a tela é mantida.
  async function prepareOrcamentos(safeHash) {
    const loaded = orcView.webContents.getURL().startsWith('file:');
    const centroToken = await readCentroToken();
    if (centroToken === handoffToken && loaded) {
      if (safeHash) await orcView.webContents.executeJavaScript(`location.hash = ${JSON.stringify(safeHash)}`).catch(() => {});
      return;
    }
    handoffToken = centroToken;
    const session = centroToken ? await requestOrcamentosSession(centroToken) : null;
    if (loaded && !session) await resetOrcamentosSession();
    await loadOrcamentos([session ? `sessao=${encodeURIComponent(session)}` : '', safeHash].filter(Boolean).join('&'));
  }

  async function switchTo(target, hash) {
    if (!TARGETS.includes(target)) return { switched: false };
    if (target === 'orcamentos') {
      if (!orcamentosAvailable() || !orcamentosStart) {
        dialog.showErrorBox('Orçamentos indisponível', 'Os arquivos do Orçamentos não foram encontrados nesta instalação.');
        return { switched: false };
      }
      // Se o Orçamentos não subiu (ex.: o app avulso está aberto), a pessoa fecha o que atrapalha e tenta de novo
      // aqui mesmo, sem reiniciar a Suíte.
      for (;;) {
        try {
          await orcamentosStart;
          break;
        } catch (error) {
          const resposta = await dialog.showMessageBox(mainWindow, {
            type: 'warning', title: 'Orçamentos não iniciou', message: 'Não foi possível abrir o Orçamentos.', detail: error.message,
            buttons: ['Tentar de novo', 'Cancelar'], defaultId: 0, cancelId: 1, noLink: true,
          });
          if (resposta.response !== 0) return { switched: false };
          orcamentosStart = startOrcamentos();
          orcamentosStart.catch(() => {});
        }
      }
      if (!liveView(orcView)) return { switched: false };
      const safeHash = typeof hash === 'string' && /^[A-Za-z0-9_=&-]{1,200}$/.test(hash) ? hash : '';
      await prepareOrcamentos(safeHash);
    }
    showTarget(target);
    return { switched: true };
  }

  // ---- IPC -----------------------------------------------------------------------------------------

  function senderIsSuiteView(event) {
    return [centroView, orcView].some((view) => liveView(view) && view.webContents === event.sender);
  }

  function initIPC() {
    ipcMain.on('get-dark-mode', (event) => { event.returnValue = loadPrefs().darkMode === true; });
    ipcMain.on('set-dark-mode', (event, value) => { const p = loadPrefs(); p.darkMode = value === true; savePrefs(p); event.returnValue = true; });
    ipcMain.on('get-mobile-access', (event) => { event.returnValue = loadPrefs().mobileAccess === true; });
    ipcMain.handle('set-mobile-access', async (_event, value) => {
      const enabled = value === true;
      await configureLocalFirewall(enabled);
      const prefs = loadPrefs();
      prefs.mobileAccess = enabled;
      savePrefs(prefs);
      setTimeout(() => { app.relaunch(); app.exit(0); }, 200);
      return true;
    });
    ipcMain.handle('open-webmail', () => shell.openExternal('https://webmailpro.uol.com.br/'));
    ipcMain.handle('suite:switch', async (event, target, hash) => {
      if (!senderIsSuiteView(event)) return { switched: false };
      return switchTo(target === 'centro' ? 'centro' : 'orcamentos', hash);
    });
  }

  // O renderer do Orçamentos conversa com `updater:*`; aqui as respostas vêm do atualizador do app inteiro.
  const PHASES = { idle: 'idle', checking: 'checking', available: 'available', 'not-available': 'upToDate', downloading: 'downloading', downloaded: 'downloaded', installing: 'downloaded', error: 'error', unavailable: 'unsupported' };
  function mapUpdaterState(state) {
    return {
      phase: state.supported === false ? 'unsupported' : (PHASES[state.status] || 'idle'),
      currentVersion: state.currentVersion,
      availableVersion: state.info?.version,
      notes: state.info?.releaseNotes || undefined,
      checkedAt: state.lastCheckedAt || undefined,
      error: state.error || undefined,
    };
  }

  function initUpdater() {
    let updater;
    try {
      updater = require(path.join(APP_ROOT, 'services', 'updater'));
      updater.setBeforeInstall(encerrarServicos);
    } catch (error) {
      console.error('[updater]', error.message);
      return;
    }
    const current = () => mapUpdaterState(updater.getState());
    let watching = null;
    const broadcast = () => liveView(orcView)?.webContents.send('updater:changed', current());
    const watch = () => {
      if (watching) return;
      watching = setInterval(() => {
        broadcast();
        if (!['checking', 'downloading'].includes(updater.getState().status)) { clearInterval(watching); watching = null; }
      }, 1000);
      watching.unref?.();
    };
    ipcMain.handle('updater:state', () => current());
    ipcMain.handle('updater:check', async () => { watch(); await updater.check(); broadcast(); return current(); });
    ipcMain.handle('updater:download', async () => { try { watch(); await updater.download(); } catch { /* o erro vai para o estado */ } broadcast(); return current(); });
    ipcMain.handle('updater:install', async () => { await updater.install(); return current(); });
  }

  // ---- Janela --------------------------------------------------------------------------------------

  function attachCommon(view) {
    const contents = view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      if (/^(https?|mailto):/i.test(url) && !url.startsWith(`http://127.0.0.1:${MODULES.centro.port}/`)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const inspect = (input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12';
      if (inspect) {
        event.preventDefault();
        if (contents.isDevToolsOpened()) contents.closeDevTools();
        else contents.openDevTools({ mode: 'detach' });
      }
      if (input.control && !input.shift && !input.alt && (input.key === '1' || input.key === '2')) {
        event.preventDefault();
        void switchTo(input.key === '1' ? 'centro' : 'orcamentos');
      }
    });
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1400, height: 900, minWidth: 1000, minHeight: 600,
      title: 'Suíte Construtec — Centro de Custos',
      icon: fs.existsSync(ICON) ? nativeImage.createFromPath(ICON) : nativeImage.createEmpty(),
      show: true, backgroundColor: BAR_COLOR,
      autoHideMenuBar: true,
      // Barra própria (desktop/titlebar.html); os botões do Windows ficam por cima, na cor dela.
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: BAR_COLOR, symbolColor: BAR_SYMBOLS, height: BAR_HEIGHT },
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'titlebar-preload.js') },
    });
    mainWindow.loadFile(path.join(__dirname, 'titlebar.html')).catch(() => {});
    // O título da janela (barra de tarefas) é o da tela ativa, não o <title> da página da barra.
    mainWindow.on('page-title-updated', (event) => event.preventDefault());
    mainWindow.on('focus', () => mainWindow?.webContents.send('suite:focus', true));
    mainWindow.on('blur', () => mainWindow?.webContents.send('suite:focus', false));
    mainWindow.webContents.once('did-finish-load', () => mainWindow?.webContents.send('suite:active', activeTarget));

    centroView = new WebContentsView({
      webPreferences: { nodeIntegration: false, contextIsolation: true, preload: CENTRO_PRELOAD },
    });
    centroView.setBackgroundColor('#021D26');
    mainWindow.contentView.addChildView(centroView);
    attachCommon(centroView);
    centroView.webContents.loadFile(path.join(APP_ROOT, 'public', 'loading.html')).catch(() => {});
    centroView.webContents.on('did-finish-load', () => {
      try {
        if (loadPrefs().darkMode && centroView.webContents.getURL().startsWith('http')) {
          centroView.webContents.executeJavaScript('document.documentElement.classList.add("dark")');
        }
      } catch {}
    });

    if (orcamentosAvailable()) {
      orcView = new WebContentsView({
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: MODULES.orcamentos.preload },
      });
      orcView.setBackgroundColor('#fefefe');
      orcView.setVisible(false);
      mainWindow.contentView.addChildView(orcView);
      attachCommon(orcView);
      orcView.webContents.on('did-fail-load', (_event, code, description) => console.error(`[orcamentos] falha ao carregar (${code}): ${description}`));
    }

    mainWindow.on('resize', fitViews);
    mainWindow.on('maximize', fitViews);
    mainWindow.on('unmaximize', fitViews);
    mainWindow.on('close', (event) => {
      if (isQuitting) return;
      event.preventDefault();
      app.quit();
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    fitViews();
    showTarget('centro');
  }

  // O Orçamentos grava no mesmo banco do app avulso; dois processos no mesmo banco o corromperiam.
  function portInUse(port) {
    return new Promise((resolve) => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.setTimeout(800, () => { socket.destroy(); resolve(false); });
    });
  }

  async function startOrcamentos() {
    if (!orcamentosAvailable()) throw new Error('Os arquivos do Orçamentos não estão nesta instalação.');
    if (await portInUse(MODULES.orcamentos.apiPort)) {
      throw new Error('O aplicativo Construtec Orçamentos avulso está aberto. Feche-o e clique em Tentar de novo para usar o Orçamentos aqui.');
    }
    const { startOrcamentosMain } = require(MODULES.orcamentos.entry);
    const userDataPath = path.join(app.getPath('appData'), 'Construtec Orçamentos');
    orcamentosMain = await startOrcamentosMain({ userDataPath, runtimeExtras: { suite: true } });
  }

  // Encerra tudo o que o app abriu (Express do Centro, banco, Orçamentos) antes de sair ou de rodar o
  // instalador de uma atualização. Idempotente; não mata o processo.
  async function encerrarServicos() {
    if (encerrado) return;
    encerrado = true;
    await Promise.allSettled([
      Promise.resolve(orcamentosMain?.close()),
      Promise.resolve(centroServer?.shutdownGracefully?.('desktop_quit')),
    ]);
  }

  async function startCentro() {
    // Chave só desta execução, em memória: autoriza o processo principal a pedir a sessão do Orçamentos.
    process.env.CONSTRUTEC_SUITE_INTERNAL_KEY = crypto.randomBytes(32).toString('hex');
    process.env.PORT = String(MODULES.centro.port);
    const { start } = require(path.join(APP_ROOT, 'server.js'));
    centroServer = await start();
  }

  app.whenReady().then(async () => {
    try {
      loadEnv();
      initIPC();
      initUpdater();
      createWindow();
      // O Orçamentos só sobe depois que o Centro apareceu: na primeira abertura os dois bancos nascem e,
      // juntos, deixavam a tela do Centro parada por minutos. Se ele falhar, só a tela dele fica indisponível
      // (o erro aparece ao trocar).
      let centroPronto;
      const centroApareceu = new Promise((resolve) => { centroPronto = resolve; });
      orcamentosStart = centroApareceu.then(() => new Promise((resolve) => setTimeout(resolve, 1500))).then(startOrcamentos);
      orcamentosStart.catch((error) => console.error('[orcamentos]', error.message));
      await startCentro();
      if (liveView(centroView)) {
        // A página pode redirecionar sozinha (para a entrada, sem sessão): isso interrompe o loadURL, não é falha.
        await centroView.webContents.loadURL(CENTRO_URL).catch((error) => console.error('[suite] carga do Centro:', error.message));
      }
      centroPronto();
      await afterServerStart();
    } catch (error) {
      console.error('[suite] erro ao iniciar:', error.stack || error.message);
      dialog.showErrorBox('Erro ao iniciar', `Não foi possível iniciar a suíte: ${error.message}`);
      app.quit();
    }
  });

  app.on('window-all-closed', () => { app.quit(); });
  app.on('activate', () => { if (mainWindow) mainWindow.show(); });
  app.on('before-quit', (event) => {
    isQuitting = true;
    if (encerrado) return;
    event.preventDefault();
    Promise.race([encerrarServicos(), new Promise((resolve) => setTimeout(resolve, 9000))]).finally(() => { encerrado = true; app.quit(); });
  });
}
