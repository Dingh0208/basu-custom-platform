const { app, BrowserWindow, shell, ipcMain, Notification, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { autoUpdater } = require('electron-updater');
const { version: appVersion } = require('../package.json');
const wechatComponent = require('./wechat-component.cjs');

const isDev = !app.isPackaged;
let mainWindow = null;
let sidecarProc = null;
let updateTimer = null;
let updateCheck = null;
let updateCheckPromise = null;
let latestUpdateStatus = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      // Process already exited.
    }
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Process already exited.
  }
}

function sidecarPidPath() {
  return path.join(app.getPath('userData'), 'clienthub-ai.pid');
}

const legacyUserDataDirs = ['ClientHub', 'clienthub'].map((name) => path.join(app.getPath('appData'), name));
const existingLegacyUserDataDir = legacyUserDataDirs.find((directory) => fs.existsSync(directory));
app.setPath('userData', existingLegacyUserDataDir || path.join(app.getPath('appData'), 'ClientHub'));

function readSidecarPid() {
  try {
    const pid = Number(fs.readFileSync(sidecarPidPath(), 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function removeSidecarPid(expectedPid = null) {
  try {
    const current = readSidecarPid();
    if (expectedPid === null || current === expectedPid) fs.rmSync(sidecarPidPath(), { force: true });
  } catch {
    // The user data directory may be unavailable during shutdown.
  }
}

function portListenerPid(port) {
  if (process.platform !== 'win32') return null;
  try {
    const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
    const line = output.split(/\r?\n/).find((entry) => entry.includes(`:${port}`) && entry.includes('LISTENING'));
    const pid = Number(line && line.trim().split(/\s+/).pop());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isClientAtlasSidecar(pid) {
  if (process.platform !== 'win32' || !pid) return false;
  try {
    const output = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    return /client(?:hub|atlas)-ai\.exe/i.test(output);
  } catch {
    return false;
  }
}

function killStaleSidecars() {
  if (process.platform !== 'win32') return;
  // Prefer the PID recorded by this installation. The port fallback handles
  // old builds that did not write a PID file, but only when the listener is
  // actually ClientAtlas' sidecar.
  const recordedPid = readSidecarPid();
  if (recordedPid) killProcessTree(recordedPid);
  removeSidecarPid(recordedPid);
  const listenerPid = portListenerPid(8765);
  if (listenerPid && listenerPid !== process.pid && isClientAtlasSidecar(listenerPid)) {
    killProcessTree(listenerPid);
  }
}

function startPackagedSidecar() {
  const sidecarDir = path.join(process.resourcesPath, 'ai-sidecar');
  const sidecarExe = ['clientatlas-ai.exe', 'clienthub-ai.exe']
    .map((name) => path.join(sidecarDir, name))
    .find((file) => fs.existsSync(file));
  if (!sidecarExe) return false;
  const wechatEngineDir = wechatComponent.componentPath(app.getPath('userData'), process.resourcesPath);
  killStaleSidecars();
  sidecarProc = spawn(sidecarExe, ['--host', '127.0.0.1', '--port', '8765', '--parent-pid', String(process.pid)], {
    cwd: path.dirname(sidecarExe),
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CLIENTATLAS_APP_VERSION: app.getVersion(),
      CLIENTHUB_APP_VERSION: app.getVersion(),
      CLIENTATLAS_DATA_DIR: path.join(app.getPath('userData'), 'clienthub-data'),
      CLIENTHUB_DATA_DIR: path.join(app.getPath('userData'), 'clienthub-data'),
      CLIENTATLAS_ENV_FILE: fs.existsSync(path.join(process.resourcesPath, 'ai-sidecar', '.env'))
        ? path.join(process.resourcesPath, 'ai-sidecar', '.env')
        : path.join(app.getPath('userData'), 'clienthub.env'),
      CLIENTHUB_ENV_FILE: fs.existsSync(path.join(process.resourcesPath, 'ai-sidecar', '.env'))
        ? path.join(process.resourcesPath, 'ai-sidecar', '.env')
        : path.join(app.getPath('userData'), 'clienthub.env'),
      FFMPEG_PATH: fs.existsSync(path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe'))
        ? path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe')
        : '',
      WECHAT_DATA_ANALYSIS_BACKEND: wechatEngineDir ? path.join(wechatEngineDir, 'wechat-backend.exe') : '',
      WECHAT_DATA_ANALYSIS_DATA_DIR: path.join(app.getPath('userData'), 'wechat-data'),
      WECHAT_DATA_ANALYSIS_OUTPUT_DIR: path.join(app.getPath('userData'), 'wechat-data', 'output'),
      WECHAT_DATA_ANALYSIS_PORT: '10393',
    },
  });
  try {
    fs.mkdirSync(path.dirname(sidecarPidPath()), { recursive: true });
    fs.writeFileSync(sidecarPidPath(), String(sidecarProc.pid), 'utf8');
  } catch {
    // The sidecar remains usable if the PID file cannot be written.
  }
  const spawned = sidecarProc;
  spawned.on('error', () => {
    removeSidecarPid(spawned.pid);
    if (sidecarProc === spawned) sidecarProc = null;
  });
  spawned.on('exit', () => {
    removeSidecarPid(spawned.pid);
    if (sidecarProc === spawned) sidecarProc = null;
  });
  return true;
}

function stopPackagedSidecar() {
  const proc = sidecarProc;
  sidecarProc = null;
  if (proc) killProcessTree(proc.pid);
  removeSidecarPid(proc ? proc.pid : null);
}

function readSidecarHealth(timeoutMs = 1000) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port: 8765, path: '/api/health', timeout: timeoutMs }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve(response.statusCode === 200 ? JSON.parse(body) : null);
        } catch {
          resolve(null);
        }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

async function waitForSidecarHealth(timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await readSidecarHealth();
    if (health?.status === 'ok') {
      return (health.apiRevision ?? 0) >= 7
        ? { status: 'ready', version: health.version, apiRevision: health.apiRevision }
        : { status: 'legacy', version: health.version, apiRevision: health.apiRevision };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { status: 'timeout' };
}

function stopAutoUpdaterTimer() {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
}

function configureAutoUpdater({ enabled = true, intervalHours = 3 } = {}) {
  stopAutoUpdaterTimer();
  if (!updateCheck || !enabled) return false;
  const hours = Math.max(1, Math.min(Number(intervalHours) || 3, 24));
  updateTimer = setInterval(updateCheck, hours * 60 * 60 * 1000);
  updateTimer.unref?.();
  return true;
}

function setupAutoUpdater() {
  if (isDev) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', (info) => sendUpdateStatus('available', info.version));
  autoUpdater.on('update-not-available', () => sendUpdateStatus('none'));
  autoUpdater.on('download-progress', (progress) => sendUpdateStatus('progress', '', {
    percent: progress.percent,
    transferred: progress.transferred,
    total: progress.total,
  }));
  autoUpdater.on('update-downloaded', (info) => sendUpdateStatus('downloaded', info.version));
  autoUpdater.on('error', (err) => sendUpdateStatus('error', String(err && err.message || err)));
  const check = () => runUpdateCheck(true).catch(() => {});
  updateCheck = check;
  check();
  configureAutoUpdater();
}

function runUpdateCheck(notify = false) {
  if (['progress', 'downloaded', 'installing'].includes(latestUpdateStatus?.status)) {
    return Promise.resolve(null);
  }
  if (updateCheckPromise) return updateCheckPromise;
  updateCheckPromise = (notify ? autoUpdater.checkForUpdatesAndNotify() : autoUpdater.checkForUpdates())
    .finally(() => { updateCheckPromise = null; });
  return updateCheckPromise;
}

function sendUpdateStatus(status, version = '', extra = {}) {
  if (['progress', 'downloaded', 'installing'].includes(latestUpdateStatus?.status) && ['checking', 'available', 'none'].includes(status)) {
    return latestUpdateStatus;
  }
  latestUpdateStatus = { status, version, ...extra };
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('clientatlas:update-status', latestUpdateStatus);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: '#f5f6f8',
    show: false,
    title: 'ClientAtlas · 客户信息聚合工作台',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
    mainWindow.loadURL(devUrl);
    if (process.env.ELECTRON_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('clientatlas:save-clarification-pdf', async (event, payload) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Invalid PDF sender');
  if (!payload || typeof payload.title !== 'string' || typeof payload.date !== 'string' || !Array.isArray(payload.groups) || !payload.groups.length || payload.groups.some(group => typeof group.label !== 'string' || !Array.isArray(group.questions) || group.questions.some(question => ['text', 'priority', 'category', 'source'].some(key => typeof question[key] !== 'string')))) throw new Error('Invalid PDF content');
  const filename = payload.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || '需求澄清问题';
  const destination = await dialog.showSaveDialog(mainWindow, {
    title: '保存需求澄清问题 PDF',
    defaultPath: path.join(app.getPath('documents'), `${filename}.pdf`),
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
  });
  if (destination.canceled || !destination.filePath) return { canceled: true };
  const { renderClarificationDocument } = await import('./clarification-document.mjs');
  const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderClarificationDocument(payload))}`);
    const pdf = await printWindow.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
    await fs.promises.writeFile(destination.filePath, pdf);
    return { canceled: false };
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
});

ipcMain.handle('clientatlas:check-updates', async () => {
  if (isDev) return { status: 'dev' };
  if (['progress', 'downloaded', 'installing'].includes(latestUpdateStatus?.status)) return { status: latestUpdateStatus.status };
  try {
    const result = await runUpdateCheck(false);
    return { status: 'checked', version: result && result.updateInfo && result.updateInfo.version };
  } catch (error) {
    return { status: 'error', error: String(error && error.message || error) };
  }
});

ipcMain.handle('clientatlas:get-update-state', () => latestUpdateStatus);

ipcMain.handle('clientatlas:download-update', async () => {
  if (isDev) return { status: 'dev' };
  try {
    sendUpdateStatus('progress', latestUpdateStatus?.version || '', { percent: 0, transferred: 0, total: 0 });
    await autoUpdater.downloadUpdate();
    return { status: 'started' };
  } catch (error) {
    return { status: 'error', error: String(error && error.message || error) };
  }
});

ipcMain.handle('clientatlas:install-update', () => {
  if (isDev) return false;
  sendUpdateStatus('installing', latestUpdateStatus?.version || '');
  autoUpdater.quitAndInstall();
  return true;
});

ipcMain.handle('clientatlas:configure-updates', (_event, settings = {}) => configureAutoUpdater(settings));

ipcMain.handle('clientatlas:show-reminder', (event, payload) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || !Notification.isSupported()) return false;
  if (!payload || typeof payload.title !== 'string' || typeof payload.body !== 'string') return false;
  return new Promise((resolve) => {
    const notice = new Notification({ title: payload.title.slice(0, 120), body: payload.body.slice(0, 600) });
    const timer = setTimeout(() => resolve(false), 5000);
    notice.once('show', () => { clearTimeout(timer); resolve(true); });
    notice.once('failed', () => { clearTimeout(timer); resolve(false); });
    notice.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('clientatlas:open-reminder', typeof payload.todoId === 'string' ? payload.todoId : '');
    });
    notice.show();
  });
});

ipcMain.handle('clientatlas:restart-sidecar', async () => {
  if (!app.isPackaged) return { status: 'dev' };
  stopPackagedSidecar();
  if (!startPackagedSidecar()) return { status: 'missing' };
  return waitForSidecarHealth();
});

ipcMain.handle('clientatlas:wechat-component-status', () => ({
  installed: Boolean(wechatComponent.componentPath(app.getPath('userData'), process.resourcesPath)),
}));

ipcMain.handle('clientatlas:wechat-component-download', async (event) => {
  const result = await wechatComponent.installComponent(app.getPath('userData'), process.resourcesPath, (percent) => {
    if (!event.sender.isDestroyed()) event.sender.send('clientatlas:wechat-component-progress', percent);
  });
  if (result.installed && app.isPackaged) {
    stopPackagedSidecar();
    startPackagedSidecar();
    await waitForSidecarHealth();
  }
  return result;
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  app.setAppUserModelId('com.clienthub.desktop');
  if (app.isPackaged) startPackagedSidecar();
  createWindow();
  setupAutoUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  stopAutoUpdaterTimer();
  stopPackagedSidecar();
});

app.on('will-quit', () => {
  stopAutoUpdaterTimer();
  stopPackagedSidecar();
});

app.on('window-all-closed', () => {
  stopPackagedSidecar();
  if (process.platform !== 'darwin') app.quit();
});
