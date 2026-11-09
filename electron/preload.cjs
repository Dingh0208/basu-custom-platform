const { contextBridge, ipcRenderer } = require('electron');

const bridge = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  checkForUpdates: () => ipcRenderer.invoke('clientatlas:check-updates'),
  getUpdateState: () => ipcRenderer.invoke('clientatlas:get-update-state'),
  downloadUpdate: () => ipcRenderer.invoke('clientatlas:download-update'),
  installUpdate: () => ipcRenderer.invoke('clientatlas:install-update'),
  configureUpdates: (settings) => ipcRenderer.invoke('clientatlas:configure-updates', settings),
  restartSidecar: () => ipcRenderer.invoke('clientatlas:restart-sidecar'),
  saveClarificationPdf: (payload) => ipcRenderer.invoke('clientatlas:save-clarification-pdf', payload),
  showReminder: (payload) => ipcRenderer.invoke('clientatlas:show-reminder', payload),
  onOpenReminder: (callback) => {
    const listener = (_event, todoId) => callback(todoId);
    ipcRenderer.on('clientatlas:open-reminder', listener);
    return () => ipcRenderer.removeListener('clientatlas:open-reminder', listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('clientatlas:update-status', listener);
    return () => ipcRenderer.removeListener('clientatlas:update-status', listener);
  },
  getWeChatComponent: () => ipcRenderer.invoke('clientatlas:wechat-component-status'),
  downloadWeChatComponent: () => ipcRenderer.invoke('clientatlas:wechat-component-download'),
  onWeChatComponentProgress: (callback) => {
    const listener = (_event, percent) => callback(percent);
    ipcRenderer.on('clientatlas:wechat-component-progress', listener);
    return () => ipcRenderer.removeListener('clientatlas:wechat-component-progress', listener);
  },
};

contextBridge.exposeInMainWorld('clientAtlas', bridge);
contextBridge.exposeInMainWorld('clientHub', bridge);
