const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let server = null;
let isQuitting = false;

const PORT = 3333;
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const TRAY_ICON = path.join(__dirname, 'icon.png');
const PRELOAD = path.join(__dirname, 'preload.js');
const gotLock = app.requestSingleInstanceLock();

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

  function getAppDir() {
    return path.join(__dirname, '..');
  }

  function loadEnv() {
    const appData = app.getPath('appData');
    const dataRoot = path.join(appData, 'Construtec', 'CentroCustos');
    if (!process.env.PGLITE_DATA_DIR) process.env.PGLITE_DATA_DIR = path.join(dataRoot, 'pglite');
    if (!process.env.RESTORE_ROOT_DIR) process.env.RESTORE_ROOT_DIR = path.join(dataRoot, 'dados');
    const envPath = path.join(getAppDir(), '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.substring(0, eqIndex).trim();
      let value = trimmed.substring(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }

  function getIcon() {
    if (fs.existsSync(TRAY_ICON)) return nativeImage.createFromPath(TRAY_ICON);
    return nativeImage.createEmpty();
  }

  function getPrefsPath() {
    const dataRoot = process.env.RESTORE_ROOT_DIR || path.join(app.getPath('appData'), 'Construtec', 'CentroCustos', 'dados');
    return path.join(dataRoot, 'preferences.json');
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
    ipcMain.on('get-dark-mode', (event) => {
      const prefs = loadPrefs();
      event.returnValue = prefs.darkMode === true;
    });
    ipcMain.on('set-dark-mode', (event, value) => {
      const prefs = loadPrefs();
      prefs.darkMode = value === true;
      savePrefs(prefs);
      event.returnValue = true;
    });
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      title: 'Centro de Custos — Construtec',
      icon: getIcon(),
      show: true,
      backgroundColor: '#021D26',
      webPreferences: { nodeIntegration: false, contextIsolation: true, preload: PRELOAD },
    });

    mainWindow.loadFile(path.join(__dirname, '..', 'public', 'loading.html'));

    mainWindow.webContents.on('did-finish-load', () => {
      try {
        const prefs = loadPrefs();
        if (prefs.darkMode) {
          mainWindow.webContents.executeJavaScript('document.documentElement.classList.add("dark")');
        }
      } catch {}
    });

    mainWindow.on('close', () => {
      isQuitting = true;
      if (server) { try { server.close(); } catch {} }
      app.quit();
    });

    mainWindow.on('closed', () => { mainWindow = null; });
  }

  function createTray() {
    const icon = getIcon();
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip('Centro de Custos — Construtec');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir Centro de Custos', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: 'Sair', click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', () => mainWindow?.show());
  }

  function initUpdater() {
    try {
      const updater = require(path.join(__dirname, '..', 'services', 'updater'));
      const repo = process.env.GITHUB_REPO || '';
      if (repo) {
        const [owner, repoName] = repo.split('/');
        if (owner && repoName) {
          updater.autoUpdater.setFeedURL({ provider: 'github', owner, repo: repoName });
        }
      }
    } catch {}
  }

  async function startServer() {
    const { start } = require(path.join(__dirname, '..', 'server.js'));
    server = await start();
  }

  app.whenReady().then(async () => {
    try {
      loadEnv();
      initIPC();
      initUpdater();
      createWindow();
      createTray();
      await startServer();
      if (mainWindow) mainWindow.loadURL(SERVER_URL);
    } catch (error) {
      dialog.showErrorBox('Erro ao iniciar', `Não foi possível iniciar: ${error.message}`);
      app.quit();
    }
  });

  app.on('window-all-closed', () => { app.quit(); });
  app.on('activate', () => { if (mainWindow) mainWindow.show(); });
  app.on('before-quit', () => { isQuitting = true; });
}
