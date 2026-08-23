let autoUpdater = null;
let loadError = null;
let configured = false;

let state = {
  status: 'idle',
  info: null,
  progress: { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 },
  error: null,
};

function unavailableError(cause) {
  const error = new Error('Atualizações automáticas estão disponíveis apenas no aplicativo desktop instalado.');
  error.code = 'UPDATER_UNAVAILABLE';
  error.cause = cause;
  return error;
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
  updater.forceDevUpdateConfig = false;
  updater.logger = null;

  updater.on('checking-for-update', () => {
    state = { ...state, status: 'checking', error: null };
  });
  updater.on('update-available', (info) => {
    state = {
      ...state,
      status: 'available',
      info: { version: info.version, releaseNotes:formatReleaseNotes(info.releaseNotes) },
      error: null,
    };
  });
  updater.on('update-not-available', () => {
    state = { ...state, status: 'not-available', info: null, error: null };
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
    state = { ...state, status: 'downloaded' };
  });
  updater.on('error', (error) => {
    state = { ...state, status: 'error', error: error.message };
  });
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

function getState() {
  return {
    ...state,
    info: state.info ? { ...state.info } : null,
    progress: { ...state.progress },
  };
}

module.exports = {
  get autoUpdater() { return getAutoUpdater(); },
  getState,
  formatReleaseNotes,
  check: () => getAutoUpdater().checkForUpdates(),
  download: () => getAutoUpdater().downloadUpdate(),
  install: () => getAutoUpdater().quitAndInstall(false, true),
};
