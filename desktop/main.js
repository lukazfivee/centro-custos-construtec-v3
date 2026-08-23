const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, clipboard, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let mainWindow = null;
let tray = null;
let server = null;
let isQuitting = false;
let firstAccessCredentials = null;
let runtimeEnvPath = null;
let bootstrapCredentialsPath = null;
let firstAccessFilePath = null;
let shouldPersistBootstrap = false;

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

  function readBootstrapCredentials() {
    if (!bootstrapCredentialsPath || !fs.existsSync(bootstrapCredentialsPath)) return null;
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const encrypted = Buffer.from(fs.readFileSync(bootstrapCredentialsPath, 'utf8'), 'base64');
      const parsed = JSON.parse(safeStorage.decryptString(encrypted));
      if (!parsed?.email || !parsed?.password || String(parsed.password).length < 10) return null;
      return { email: String(parsed.email), password: String(parsed.password) };
    } catch {
      return null;
    }
  }

  function persistBootstrapCredentials(credentials) {
    if (!bootstrapCredentialsPath || !credentials) return false;
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      const encrypted = safeStorage.encryptString(JSON.stringify(credentials));
      fs.mkdirSync(path.dirname(bootstrapCredentialsPath), { recursive: true });
      fs.writeFileSync(bootstrapCredentialsPath, encrypted.toString('base64'), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  function localDatabaseAlreadyExists(dataDir) {
    try {
      return fs.existsSync(dataDir) && fs.readdirSync(dataDir).length > 0;
    } catch {
      return false;
    }
  }

  function loadEnv() {
    const appData = app.getPath('appData');
    const dataRoot = path.join(appData, 'Construtec', 'CentroCustosV3');
    fs.mkdirSync(dataRoot, { recursive: true });

    if (!process.env.PGLITE_DATA_DIR) process.env.PGLITE_DATA_DIR = path.join(dataRoot, 'pglite');
    if (!process.env.RESTORE_ROOT_DIR) process.env.RESTORE_ROOT_DIR = path.join(dataRoot, 'dados');

    bootstrapCredentialsPath = path.join(dataRoot, 'bootstrap-credentials.dat');
    firstAccessFilePath = path.join(app.getPath('desktop'), 'PRIMEIRO-ACESSO-CENTRO-CUSTOS.txt');
    process.env.BOOTSTRAP_CREDENTIAL_PATH = bootstrapCredentialsPath;
    process.env.FIRST_ACCESS_FILE_PATH = firstAccessFilePath;
    const existingBootstrap = readBootstrapCredentials();
    const databaseAlreadyExists = localDatabaseAlreadyExists(process.env.PGLITE_DATA_DIR);

    readEnvFile(path.join(getAppDir(), '.env'));

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
      if (existingBootstrap) {
        process.env.ADMIN_INITIAL_PASSWORD = existingBootstrap.password;
        firstAccessCredentials = existingBootstrap;
      } else if (!databaseAlreadyExists) {
        const temporaryPassword = generateInitialPassword();
        process.env.ADMIN_INITIAL_PASSWORD = temporaryPassword;
        firstAccessCredentials = {
          email: process.env.ADMIN_INITIAL_EMAIL,
          password: temporaryPassword,
        };
        shouldPersistBootstrap = true;
      }
    }

    if (!process.env.NODE_ENV) {
      runtime.NODE_ENV = runtime.NODE_ENV || 'production';
      process.env.NODE_ENV = runtime.NODE_ENV;
      changed = true;
    }

    process.env.HOST = loadPrefs().mobileAccess === true ? '0.0.0.0' : '127.0.0.1';

    if (runtime.ADMIN_INITIAL_PASSWORD) {
      delete runtime.ADMIN_INITIAL_PASSWORD;
      changed = true;
    }

    if (changed || !fs.existsSync(runtimeEnvPath)) writeRuntimeEnv(runtime);
  }

  function writeFirstAccessDesktopFile() {
    if (!firstAccessCredentials || !firstAccessFilePath) return;
    const content = [
      'CENTRO DE CUSTOS CONSTRUTEC - PRIMEIRO ACESSO',
      '',
      `Login: ${firstAccessCredentials.email}`,
      `Senha temporária: ${firstAccessCredentials.password}`,
      '',
      'Altere esta senha depois de entrar no sistema.',
      'Após a troca da senha, este arquivo será removido automaticamente.',
      '',
    ].join('\r\n');
    try { fs.writeFileSync(firstAccessFilePath, content, 'utf8'); } catch {}
  }

  async function showFirstAccessInfo() {
    if (!firstAccessCredentials) return;
    writeFirstAccessDesktopFile();
    clipboard.writeText(`Usuário: ${firstAccessCredentials.email}\nSenha: ${firstAccessCredentials.password}`);
    await dialog.showMessageBox({
      type: 'info',
      title: 'Primeiro acesso',
      message: 'Credenciais de primeiro acesso do Centro de Custos V3.',
      detail: `Usuário: ${firstAccessCredentials.email}\nSenha temporária: ${firstAccessCredentials.password}\n\nAs credenciais foram copiadas para a área de transferência e também salvas na Área de Trabalho em:\n${firstAccessFilePath}\n\nO arquivo será removido quando a senha for alterada.`,
      buttons: ['Entendi'],
      defaultId: 0,
      noLink: true,
    });
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
    ipcMain.on('get-mobile-access', (event) => {
      event.returnValue = loadPrefs().mobileAccess === true;
    });
    ipcMain.handle('set-mobile-access', async (_event, value) => {
      const prefs = loadPrefs();
      prefs.mobileAccess = value === true;
      savePrefs(prefs);
      setTimeout(() => { app.relaunch(); app.exit(0); }, 200);
      return true;
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
        if (prefs.darkMode) mainWindow.webContents.executeJavaScript('document.documentElement.classList.add("dark")');
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
        if (owner && repoName) updater.autoUpdater.setFeedURL({ provider:'github', owner, repo:repoName });
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
      if (shouldPersistBootstrap && firstAccessCredentials) {
        persistBootstrapCredentials(firstAccessCredentials);
        shouldPersistBootstrap = false;
      }
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
