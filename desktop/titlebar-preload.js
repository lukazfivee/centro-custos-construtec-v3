const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('suiteBar', {
  onActive: (callback) => ipcRenderer.on('suite:active', (_event, target) => callback(target)),
  onFocus: (callback) => ipcRenderer.on('suite:focus', (_event, focused) => callback(focused === true)),
});
