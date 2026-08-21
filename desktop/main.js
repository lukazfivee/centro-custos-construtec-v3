const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let mainWindow = null;
let tray = null;
let server = null;
let isQuitting = false;
let firstAccessCredentials = null;
let runtimeEnvPath = null;

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

  function readEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const values = {};
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
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
      values[key] = value;
      if (!process.env[key]) process.env[key] = value;
    }
    return values;
  }

  function writeRuntimeEnv(values) {
    if (!runtimeEnvPath) return;
    const safeValues = { ...values };
    delete safeValues.ADMIN_INITIAL_PASSWORD;
    const lines = [
      '# Configuração automática do aplicativo desktop. Não compartilhe este arquivo.',
      ...Object.entries(safeValues).map(([key, value]) => `${key}=${String(value).replace(/[\r\n]/g, '')}`),
      '',
    ];
    fs.mkdirSync(path.dirname(runtimeEnvPath), { recursive: true });
    fs.writeFileSync(runtimeEnvPath, lines.join('\n'), 'utf8');
  }

  function generateInitialPassword() {
    return `Cc-${crypto.randomBytes(9).toString('base64url')}-26`;
  }

  function loadEnv() {
    const appData = app.getPath('appData');
    const dataRoot = path.join(appData, 'Construtec', 'CentroCustosV3');
    fs.mkdirSync(dataRoot, { recursive: true });

    if (!process.env.PGLITE_DATA_DIR) process.env.PGLITE_DATA_DIR = path.join(dataRoot, 'pglite');
    if (!process.env.RESTORE_ROOT_DIR) process.env.RESTORE_ROOT_DIR = path.join(dataRoot, 'dados');

    // Configuração opcional para ambiente de desenvolvimento. O .env não é empacotado no instalador.
    readEnvFile(path.join(getAppDir(), '.env'));

    // Configuração persistente exclusiva desta instalação V3.
    runtimeEnvPath = path.join(dataRoot, 'desktop.env');
    const runtime = readEnvFile(runtimeEnvPath);
    let changed = false;

    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      runtime.JWT_SECRET = crypto.randomBytes(48).toString('hex');
      process.env.JWT_SECRET = runtime.JWT_SECRET;
      changed = true;
    }

    if (!process.env.ADMIN_INITIAL_NAME) {
      runtime.ADMIN_INITIAL_NAME = runtime.ADMIN_INITIAL_NAME || 'Administrador';
      process.env.ADMIN_INITIAL_NAME = runtime.ADMIN_INITIAL_NAME;
      changed = true;
    }

    if (!process.env.ADMIN_INITIAL_EMAIL) {
      runtime.ADMIN_INITIAL_EMAIL = runtime.ADMIN_INITIAL_EMAIL || 'admin@construtec.local';
      process.env.ADMIN_INITIAL_EMAIL = runtime.ADMIN_INITIAL_EMAIL;
      changed = true;
    }

    if (!process.env.ADMIN_INITIAL_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD.length < 10) {
      const temporaryPassword = generateInitialPassword();
      process.env.ADMIN_INITIAL_PASSWORD = temporaryPassword;
      firstAccessCredentials = {
        email: process.env.ADMIN_INITIAL_EMAIL,
        password: temporaryPassword,
      };
    }

    if (!process.env.NODE_ENV) {
      runtime.NODE_ENV = runtime.NODE_ENV || 'production';
      process.env.NODE_ENV = runtime.NODE_ENV;
      changed = true;
    }

    if (runtime.ADMIN_INITIAL_PASSWORD) {
      delete runtime.ADMIN_INITIAL_PASSWORD;
      changed = true;
    }

    if (changed || !fs.existsSync(runtimeEnvPath)) writeRuntimeEnv(runtime);
  }

  async function showFirstAccessInfo() {
    if (!firstAccessCredentials) return;
    clipboard.writeText(`Usuário: ${firstAccessCredentials.email}\nSenha: ${firstAccessCredentials.password}`);
    await dialog.showMessageBox({
      type: 'info',
      title: 'Primeiro acesso',
      message: 'O Centro de Custos V3 foi configurado automaticamente.',
      detail: `Usuário: ${firstAccessCredentials.email}\nSenha temporária: ${firstAccessCredentials.password}\n\nAs credenciais foram copiadas para a área de transferência. Altere a senha após entrar no sistema. A senha temporária não é gravada em arquivo.`,
      buttons: ['Entendi'],
      defaultId: 0,
      noLink: true,
    });
    firstAccessCredentials = null;
  }

  function getIcon() {
    if (fs.existsSync(TRAY_ICON)) return nativeImage.createFromPath(TRAY_ICON);
    return nativeImage.createEmpty();
  }

  function getPrefsPath() {
    const dataRoot = process.env.RESTORE_ROOT_DIR || path.join(app.getPath('appData'), 'Construtec', 'CentroCustosV3', 'dados');
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
      await showFirstAccessInfo();
    } catch (error) {
      dialog.showErrorBox('Erro ao iniciar', `Não foi possível iniciar: ${error.message}`);
      app.quit();
    }
  });

  app.on('window-all-closed', () => { app.quit(); });
  app.on('activate', () => { if (mainWindow) mainWindow.show(); });
  app.on('before-quit', () => { isQuitting = true; });
}
