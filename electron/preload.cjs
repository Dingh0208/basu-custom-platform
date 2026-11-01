const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clientHub', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  checkForUpdates: () => ipcRenderer.invoke('clienthub:check-updates'),
  getUpdateState: () => ipcRenderer.invoke('clienthub:get-update-state'),
  downloadUpdate: () => ipcRenderer.invoke('clienthub:download-update'),
  installUpdate: () => ipcRenderer.invoke('clienthub:install-update'),
  configureUpdates: (settings) => ipcRenderer.invoke('clienthub:configure-updates', settings),
  restartSidecar: () => ipcRenderer.invoke('clienthub:restart-sidecar'),
  showReminder: (payload) => ipcRenderer.invoke('clienthub:show-reminder', payload),
  onOpenReminder: (callback) => {
    const listener = (_event, todoId) => callback(todoId);
    ipcRenderer.on('clienthub:open-reminder', listener);
    return () => ipcRenderer.removeListener('clienthub:open-reminder', listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('clienthub:update-status', listener);
    return () => ipcRenderer.removeListener('clienthub:update-status', listener);
  },
});
