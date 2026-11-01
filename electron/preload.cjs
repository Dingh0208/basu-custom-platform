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
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('clienthub:update-status', listener);
    return () => ipcRenderer.removeListener('clienthub:update-status', listener);
  },
});
