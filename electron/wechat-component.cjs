const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const manifest = require('./wechat-component.json');

const execFileAsync = promisify(execFile);
let activeDownload = null;

function validComponent(directory) {
  try {
    return fs.statSync(path.join(directory, 'wechat-backend.exe')).size > 100_000_000
      && fs.statSync(path.join(directory, 'native', 'wechatdb_broker.exe')).size > 1_000_000
      && fs.statSync(path.join(directory, 'native', 'weflow_wasm', 'wasm_video_decode.wasm')).size > 1_000_000;
  } catch {
    return false;
  }
}

function componentPath(userData, resourcesPath) {
  const installed = path.join(userData, 'components', 'wechat-engine');
  if (validComponent(installed)) return installed;
  const legacy = path.join(resourcesPath, 'wechat-engine');
  return validComponent(legacy) ? legacy : null;
}

function download(url, target, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4 || !['github.com', 'release-assets.githubusercontent.com'].includes(new URL(url).hostname)) {
      reject(new Error('组件下载地址无效'));
      return;
    }
    https.get(url, { timeout: 30000 }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(new URL(response.headers.location, url).toString(), target, onProgress, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`组件下载失败：HTTP ${response.statusCode}`));
        return;
      }
      const size = Number(response.headers['content-length'] || 0);
      let received = 0;
      const hash = crypto.createHash('sha256');
      const output = fs.createWriteStream(target);
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > manifest.maxBytes) response.destroy(new Error('组件文件超过预期大小'));
        else {
          hash.update(chunk);
          if (size) onProgress(Math.min(95, Math.floor(received * 95 / size)));
        }
      });
      response.on('error', reject);
      output.on('error', reject);
      output.on('finish', () => {
        if (hash.digest('hex') !== manifest.sha256) reject(new Error('组件校验失败，请重试下载'));
        else resolve();
      });
      response.pipe(output);
    }).on('error', reject);
  });
}

async function installComponent(userData, resourcesPath, onProgress) {
  if (componentPath(userData, resourcesPath)) return { installed: true };
  if (activeDownload) return activeDownload;
  activeDownload = (async () => {
    const componentsDir = path.join(userData, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });
    const staging = fs.mkdtempSync(path.join(componentsDir, 'wechat-download-'));
    try {
      const archive = path.join(staging, 'component.zip');
      const extracted = path.join(staging, 'extracted');
      await download(manifest.url, archive, onProgress);
      onProgress(96);
      const quote = (value) => `'${value.replace(/'/g, "''")}'`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(extracted)} -Force`],
      { windowsHide: true, timeout: 120000 });
      if (!validComponent(extracted)) throw new Error('组件内容不完整');
      const destination = path.join(componentsDir, 'wechat-engine');
      if (fs.existsSync(destination) && !validComponent(destination)) {
        fs.rmSync(destination, { recursive: true, force: true });
      }
      fs.renameSync(extracted, destination);
      onProgress(100);
      return { installed: true };
    } catch (error) {
      return { installed: false, error: error.message || '组件安装失败' };
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
      activeDownload = null;
    }
  })();
  return activeDownload;
}

module.exports = { componentPath, installComponent, validComponent };
