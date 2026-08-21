const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDarkMode: () => ipcRenderer.sendSync('get-dark-mode'),
  setDarkMode: (value) => ipcRenderer.sendSync('set-dark-mode', value),
});
