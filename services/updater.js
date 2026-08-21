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
      info: { version: info.version, releaseNotes: info.releaseNotes || '' },
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
  check: () => getAutoUpdater().checkForUpdates(),
  download: () => getAutoUpdater().downloadUpdate(),
  install: () => getAutoUpdater().quitAndInstall(false, true),
};
