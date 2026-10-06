// Atualizador do app Windows (electron-updater). So existe no aplicativo instalado: no navegador,
// em desenvolvimento e na versao portatil o estado fica "unavailable". O servidor Express roda no
// mesmo processo do Electron, entao as rotas /api/update/* controlam o atualizador diretamente.
const { resolverFeed, mensagemAmigavel } = require('./updater-feed');

const VERSAO = (() => { try { return require('../package.json').version; } catch { return ''; } })();
const ESPERA_ENCERRAR_MS = 8000;

let autoUpdater = null;
let loadError = null;
let configured = false;
let modoTeste = false;
let antesDeInstalar = null;
let resolver = resolverFeed;

const novoEstado = () => ({
  status: 'idle',
  info: null,
  progress: { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 },
  error: null,
  errorDetail: null,
  lastCheckedAt: null,
});
let state = novoEstado();

function unavailableError(cause, mensagem) {
  const error = new Error(mensagem || 'Atualizações automáticas estão disponíveis apenas no aplicativo desktop instalado.');
  error.code = 'UPDATER_UNAVAILABLE';
  error.cause = cause;
  return error;
}

function estadoErro(error) {
  state = { ...state, status: 'error', error: mensagemAmigavel(error), errorDetail: String((error && error.message) || error || '').slice(0, 400) };
}

function decodeEntities(value) {
  const named = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ' };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
    const hexadecimal = entity[1].toLowerCase() === 'x';
    const code = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

function formatReleaseNotes(input) {
  const raw = (Array.isArray(input) ? input.map((item) => typeof item === 'string' ? item : item?.note || item?.releaseNotes || '').join('\n') : String(input || ''))
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(?:li|p|div|h[1-6])>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0,2000);
}

function configure(updater) {
  if (configured) return;
  configured = true;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.autoRunAppAfterInstall = true;
  updater.allowDowngrade = false;
  updater.allowPrerelease = true;
  updater.forceDevUpdateConfig = false;
  updater.logger = null;

  updater.on('checking-for-update', () => {
    state = { ...state, status: 'checking', error: null, errorDetail: null };
  });
  updater.on('update-available', (info) => {
    const arquivo = Array.isArray(info.files) ? info.files[0] : null;
    state = {
      ...state,
      status: 'available',
      info: { version: info.version, releaseNotes: formatReleaseNotes(info.releaseNotes), releaseDate: info.releaseDate || null, size: arquivo && arquivo.size ? Number(arquivo.size) : null },
      error: null,
      errorDetail: null,
    };
  });
  updater.on('update-not-available', () => {
    state = { ...state, status: 'not-available', info: null, error: null, errorDetail: null };
  });
  updater.on('download-progress', (progress) => {
    state = {
      ...state,
      status: 'downloading',
      progress: {
        percent: Math.round(progress.percent),
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      },
    };
  });
  updater.on('update-downloaded', () => {
    state = { ...state, status: 'downloaded', progress: { ...state.progress, percent: 100 } };
  });
  updater.on('error', (error) => estadoErro(error));
}

function getAutoUpdater() {
  if (autoUpdater) return autoUpdater;
  if (loadError) throw loadError;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    configure(autoUpdater);
    return autoUpdater;
  } catch (cause) {
    loadError = unavailableError(cause);
    state = { ...state, status: 'unavailable', error: loadError.message };
    throw loadError;
  }
}

// Onde o atualizador pode funcionar: app do Windows instalado (NSIS), nao a versao portatil.
function suporte() {
  if (modoTeste) return { supported: true, reason: null };
  if (!process.versions.electron) return { supported: false, reason: 'A atualização pelo app só existe no aplicativo instalado no Windows.' };
  if (process.platform !== 'win32') return { supported: false, reason: 'A atualização pelo app só existe no Windows.' };
  if (process.env.PORTABLE_EXECUTABLE_FILE) return { supported: false, reason: 'A versão portátil não se atualiza sozinha. Baixe o instalador da nova versão.' };
  try {
    const u = getAutoUpdater();
    if (typeof u.isUpdaterActive === 'function' && !u.isUpdaterActive()) return { supported: false, reason: 'O app está em modo de desenvolvimento. A atualização só funciona na versão instalada.' };
  } catch (error) { return { supported: false, reason: error.message }; }
  return { supported: true, reason: null };
}

function getState() {
  const s = suporte();
  return {
    ...state,
    info: state.info ? { ...state.info } : null,
    progress: { ...state.progress },
    currentVersion: VERSAO,
    supported: s.supported,
    unsupportedReason: s.reason,
  };
}

function conflito(mensagem) {
  const error = new Error(mensagem);
  error.code = 'UPDATER_STATE';
  error.statusCode = 409;
  return error;
}

async function check() {
  const s = suporte();
  if (!s.supported) { state = { ...state, status: 'unavailable', error: s.reason }; return getState(); }
  if (['checking', 'downloading', 'downloaded', 'installing'].includes(state.status)) return getState();
  state = { ...state, status: 'checking', error: null, errorDetail: null };
  try {
    const updater = getAutoUpdater();
    const feed = await resolver();
    updater.setFeedURL({ provider: feed.provider, url: feed.url });
    await updater.checkForUpdates();
  } catch (error) { estadoErro(error); }
  state = { ...state, lastCheckedAt: new Date().toISOString() };
  return getState();
}

// Valida de forma sincrona e devolve a promessa do download (que nunca rejeita: o erro vai para o estado).
function download() {
  if (state.status !== 'available') throw conflito('Não há atualização disponível para baixar. Verifique de novo.');
  const updater = getAutoUpdater();
  state = { ...state, status: 'downloading', progress: { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 }, error: null, errorDetail: null };
  return Promise.resolve()
    .then(() => updater.downloadUpdate())
    .then(() => getState(), (error) => { estadoErro(error); return getState(); });
}

// O app registra aqui como encerrar o servidor, o banco e os modulos antes do instalador rodar.
function setBeforeInstall(fn) { antesDeInstalar = typeof fn === 'function' ? fn : null; }

async function install() {
  if (state.status !== 'downloaded') throw conflito('A atualização ainda não foi baixada.');
  const updater = getAutoUpdater();
  state = { ...state, status: 'installing' };
  try {
    if (antesDeInstalar) {
      await Promise.race([Promise.resolve().then(antesDeInstalar), new Promise((r) => setTimeout(r, ESPERA_ENCERRAR_MS).unref())]);
    }
    updater.quitAndInstall(true, true);
  } catch (error) { estadoErro(error); throw error; }
  return getState();
}

// Somente para testes: troca o modulo do electron-updater por um falso e zera o estado.
function __usarModulo(fake, opcoes = {}) {
  autoUpdater = fake || null;
  loadError = null;
  configured = false;
  modoTeste = !!fake;
  antesDeInstalar = null;
  resolver = fake ? (opcoes.feed || (async () => ({ provider: 'generic', url: 'https://exemplo.test/releases' }))) : resolverFeed;
  state = novoEstado();
  if (fake) configure(fake);
}

module.exports = {
  get autoUpdater() { return getAutoUpdater(); },
  getState,
  formatReleaseNotes,
  check,
  download,
  install,
  setBeforeInstall,
  __usarModulo,
};
