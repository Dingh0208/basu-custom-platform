const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clientHub', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  checkForUpdates: () => ipcRenderer.invoke('clienthub:check-updates'),
  installUpdate: () => ipcRenderer.invoke('clienthub:install-update'),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('clienthub:update-status', (_event, payload) => callback(payload));
  },
});
