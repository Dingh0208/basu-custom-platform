const { app, BrowserWindow, shell, ipcMain, Notification, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
let mainWindow = null;
let sidecarProc = null;
let updateTimer = null;
let updateCheck = null;
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

function isClientHubSidecar(pid) {
  if (process.platform !== 'win32' || !pid) return false;
  try {
    const output = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    return output.toLowerCase().includes('clienthub-ai.exe');
  } catch {
    return false;
  }
}

function killStaleSidecars() {
  if (process.platform !== 'win32') return;
  // Prefer the PID recorded by this installation. The port fallback handles
  // old builds that did not write a PID file, but only when the listener is
  // actually ClientHub's sidecar.
  const recordedPid = readSidecarPid();
  if (recordedPid) killProcessTree(recordedPid);
  removeSidecarPid(recordedPid);
  const listenerPid = portListenerPid(8765);
  if (listenerPid && listenerPid !== process.pid && isClientHubSidecar(listenerPid)) {
    killProcessTree(listenerPid);
  }
}

function startPackagedSidecar() {
  const sidecarExe = path.join(process.resourcesPath, 'ai-sidecar', 'clienthub-ai.exe');
  if (!fs.existsSync(sidecarExe)) return false;
  killStaleSidecars();
  const dataDir = path.join(app.getPath('userData'), 'wechat-data');
  sidecarProc = spawn(sidecarExe, ['--host', '127.0.0.1', '--port', '8765', '--parent-pid', String(process.pid)], {
    cwd: path.dirname(sidecarExe),
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CLIENTHUB_APP_VERSION: app.getVersion(),
      CLIENTHUB_DATA_DIR: path.join(app.getPath('userData'), 'clienthub-data'),
      CLIENTHUB_ENV_FILE: fs.existsSync(path.join(process.resourcesPath, 'ai-sidecar', '.env'))
        ? path.join(process.resourcesPath, 'ai-sidecar', '.env')
        : path.join(app.getPath('userData'), 'clienthub.env'),
      FFMPEG_PATH: fs.existsSync(path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe'))
        ? path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe')
        : '',
      WECHAT_DATA_ANALYSIS_BACKEND: path.join(process.resourcesPath, 'wechat-engine', 'wechat-backend.exe'),
      WECHAT_DATA_ANALYSIS_DATA_DIR: dataDir,
      WECHAT_DATA_ANALYSIS_OUTPUT_DIR: path.join(dataDir, 'output'),
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
  const check = () => autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  updateCheck = check;
  check();
  configureAutoUpdater();
}

function sendUpdateStatus(status, version = '', extra = {}) {
  latestUpdateStatus = { status, version, ...extra };
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('clienthub:update-status', latestUpdateStatus);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: '#f5f6f8',
    show: false,
    title: 'ClientHub · 客户信息聚合工作台',
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

ipcMain.handle('clienthub:save-clarification-pdf', async (event, payload) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Invalid PDF sender');
  if (!payload || typeof payload.title !== 'string' || typeof payload.text !== 'string' || !payload.text.trim()) throw new Error('Invalid PDF content');
  const filename = payload.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || '需求澄清问题';
  const destination = await dialog.showSaveDialog(mainWindow, {
    title: '保存需求澄清问题 PDF',
    defaultPath: path.join(app.getPath('documents'), `${filename}.pdf`),
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
  });
  if (destination.canceled || !destination.filePath) return { canceled: true };
  const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<html><head><meta charset="utf-8"><title>${escapeHtml(payload.title)}</title><style>body{font-family:"Microsoft YaHei",sans-serif;padding:36px;color:#1f3331;line-height:1.7}h1{font-size:22px;margin:0 0 6px}p{white-space:pre-wrap;font-size:14px}</style></head><body><h1>${escapeHtml(payload.title)}</h1><p>${escapeHtml(payload.text)}</p></body></html>`)}`);
    const pdf = await printWindow.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
    await fs.promises.writeFile(destination.filePath, pdf);
    return { canceled: false };
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
});

ipcMain.handle('clienthub:check-updates', async () => {
  if (isDev) return { status: 'dev' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: 'checked', version: result && result.updateInfo && result.updateInfo.version };
  } catch (error) {
    return { status: 'error', error: String(error && error.message || error) };
  }
});

ipcMain.handle('clienthub:get-update-state', () => latestUpdateStatus);

ipcMain.handle('clienthub:download-update', async () => {
  if (isDev) return { status: 'dev' };
  try {
    await autoUpdater.downloadUpdate();
    return { status: 'started' };
  } catch (error) {
    return { status: 'error', error: String(error && error.message || error) };
  }
});

ipcMain.handle('clienthub:install-update', () => {
  if (isDev) return false;
  autoUpdater.quitAndInstall();
  return true;
});

ipcMain.handle('clienthub:configure-updates', (_event, settings = {}) => configureAutoUpdater(settings));

ipcMain.handle('clienthub:show-reminder', (event, payload) => {
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
      mainWindow.webContents.send('clienthub:open-reminder', typeof payload.todoId === 'string' ? payload.todoId : '');
    });
    notice.show();
  });
});

ipcMain.handle('clienthub:restart-sidecar', async () => {
  if (!app.isPackaged) return { status: 'dev' };
  stopPackagedSidecar();
  if (!startPackagedSidecar()) return { status: 'missing' };
  return waitForSidecarHealth();
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
