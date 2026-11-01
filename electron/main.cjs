const { app, BrowserWindow, shell, ipcMain, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
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

ipcMain.handle('clienthub:restart-sidecar', () => {
  if (!app.isPackaged) return { status: 'dev' };
  stopPackagedSidecar();
  return { status: startPackagedSidecar() ? 'restarted' : 'missing' };
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
