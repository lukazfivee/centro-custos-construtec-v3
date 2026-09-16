const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const suiteModules = require('./suite-modules');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let childProcesses = [];
let budgetsRuntime = null;

const TRAY_ICON = path.join(__dirname, 'icon.png');
const PRELOAD = path.join(__dirname, 'preload.js');
const gotLock = app.requestSingleInstanceLock();

const APP_ROOT = path.join(__dirname, '..');
const MODULES = suiteModules(APP_ROOT);
const MAIN_URL = `http://127.0.0.1:${MODULES.centro.port}`;

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  function loadEnv() {
    const envPath = path.join(APP_ROOT, '.env');
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq === -1) continue;
        const k = t.substring(0, eq).trim();
        let v = t.substring(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[k]) process.env[k] = v;
      }
    }
    process.env.PORT = String(MODULES.centro.port);
    process.env.HOST = '127.0.0.1';
  }

  function getPrefsPath() {
    return path.join(app.getPath('appData'), 'Construtec', 'CentroCustosV3', 'dados', 'preferences.json');
  }

  function loadPrefs() {
    try {
      const p = getPrefsPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
    return {};
  }

  function savePrefs(prefs) {
    const dir = path.dirname(getPrefsPath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getPrefsPath(), JSON.stringify(prefs, null, 2), 'utf8');
  }

  function initIPC() {
    ipcMain.on('get-dark-mode', (event) => { event.returnValue = loadPrefs().darkMode === true; });
    ipcMain.on('set-dark-mode', (event, value) => { const p = loadPrefs(); p.darkMode = value === true; savePrefs(p); event.returnValue = true; });
    ipcMain.on('get-mobile-access', (event) => { event.returnValue = loadPrefs().mobileAccess === true; });
    ipcMain.handle('set-mobile-access', async (_event, value) => {
      const prefs = loadPrefs();
      prefs.mobileAccess = value === true;
      savePrefs(prefs);
      return true;
    });
    ipcMain.handle('open-webmail', () => shell.openExternal('https://webmailpro.uol.com.br/'));
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1400, height: 900, minWidth: 1000, minHeight: 600,
      title: 'Construtec — Suite Integrada',
      icon: fs.existsSync(TRAY_ICON) ? nativeImage.createFromPath(TRAY_ICON) : nativeImage.createEmpty(),
      show: true, backgroundColor: '#021D26',
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#122036', symbolColor: '#dbeafe', height: 38 },
      webPreferences: { nodeIntegration: false, contextIsolation: true, preload: PRELOAD },
    });
    mainWindow.loadFile(path.join(APP_ROOT, 'public', 'loading.html'));
    mainWindow.webContents.on('did-finish-load', () => {
      try { if (loadPrefs().darkMode) mainWindow.webContents.executeJavaScript('document.documentElement.classList.add("dark")'); } catch {}
    });
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const inspect = input.type === 'keyDown' && (
        (input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12'
      );
      if (!inspect) return;
      event.preventDefault();
      if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools();
      else mainWindow.webContents.openDevTools({ mode: 'detach' });
    });
    mainWindow.on('close', (event) => {
      if (isQuitting) return;
      event.preventDefault();
      isQuitting = true;
      Promise.resolve(budgetsRuntime?.close()).catch(() => {}).finally(() => {
        for (const p of childProcesses) { try { p.kill(); } catch {} }
        app.quit();
      });
    });
    mainWindow.on('closed', () => { mainWindow = null; });
  }

  function createTray() {
    const icon = fs.existsSync(TRAY_ICON) ? nativeImage.createFromPath(TRAY_ICON) : nativeImage.createEmpty();
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip('Construtec — Suite Integrada');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: 'Sair', click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', () => mainWindow?.show());
  }

  function startChild(name, scriptPath, args, cwd, env) {
    return new Promise((resolve, reject) => {
      const nodeExecutable = process.env.NODE_EXEC_PATH || (process.platform === 'win32' ? 'node.exe' : 'node');
      const child = spawn(nodeExecutable, [scriptPath, ...args], {
        cwd, env: { ...process.env, ...env },
        stdio: 'ignore', detached: false,
      });
      childProcesses.push(child);
      child.on('error', (err) => { console.error(`[${name}] error:`, err.message); reject(err); });
      child.on('exit', (code) => { console.log(`[${name}] exited code=${code}`); });
      setTimeout(resolve, 2500);
    });
  }

  async function startAllServers() {
    console.log('[suite] Starting ChamadoPro...');
    await startChild('chamados', path.join(MODULES.chamados.root, 'start-construtec.cjs'), [], MODULES.chamados.root, { PORT: String(MODULES.chamados.apiPort) });

    console.log('[suite] Starting Orçamentos API...');
    const { createSuiteApi } = require(path.join(APP_ROOT, 'modules', 'orcamentos-api', 'index.cjs'));
    const budgetsData = path.join(app.getPath('appData'), 'Construtec Orçamentos');
    budgetsRuntime = await createSuiteApi(budgetsData);

    console.log('[suite] Starting Centro de Custos...');
    process.env.PORT = String(MODULES.centro.port);
    const { start } = require(path.join(APP_ROOT, 'server.js'));
    await start({ orcamentosApp: budgetsRuntime.app });

    console.log('[suite] All servers started.');
  }

  app.whenReady().then(async () => {
    try {
      Menu.setApplicationMenu(null);
      loadEnv();
      initIPC();
      createWindow();
      createTray();
      await startAllServers();
      if (mainWindow) mainWindow.loadURL(MAIN_URL);
    } catch (error) {
      dialog.showErrorBox('Erro ao iniciar', `Não foi possível iniciar a suíte: ${error.message}`);
      app.quit();
    }
  });

  app.on('window-all-closed', () => { app.quit(); });
  app.on('activate', () => { if (mainWindow) mainWindow.show(); });
  app.on('before-quit', () => { isQuitting = true; });
}
