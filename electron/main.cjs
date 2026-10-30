const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
let mainWindow = null;
let sidecarProc = null;

function startPackagedSidecar() {
  const sidecarExe = path.join(process.resourcesPath, 'ai-sidecar', 'clienthub-ai.exe');
  if (!fs.existsSync(sidecarExe)) return;
  const dataDir = path.join(app.getPath('userData'), 'wechat-data');
  sidecarProc = spawn(sidecarExe, ['--host', '127.0.0.1', '--port', '8765'], {
    cwd: path.dirname(sidecarExe),
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
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
  sidecarProc.on('exit', () => { sidecarProc = null; });
}

function stopPackagedSidecar() {
  if (sidecarProc && !sidecarProc.killed) sidecarProc.kill();
  sidecarProc = null;
}

function setupAutoUpdater() {
  if (isDev) return;
  autoUpdater.autoDownload = true;
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
  autoUpdater.checkForUpdatesAndNotify();
  // Requirement: background update check every three hours.
  setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 3 * 60 * 60 * 1000);
}

function sendUpdateStatus(status, version = '', extra = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('clienthub:update-status', { status, version, ...extra });
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

ipcMain.handle('clienthub:install-update', () => {
  if (isDev) return false;
  autoUpdater.quitAndInstall();
  return true;
});

app.whenReady().then(() => {
  if (app.isPackaged) startPackagedSidecar();
  createWindow();
  setupAutoUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  stopPackagedSidecar();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
