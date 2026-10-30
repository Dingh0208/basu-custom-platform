const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

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
      CLIENTHUB_ENV_FILE: path.join(app.getPath('userData'), 'clienthub.env'),
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

app.whenReady().then(() => {
  if (app.isPackaged) startPackagedSidecar();
  createWindow();
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
