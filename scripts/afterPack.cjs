const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Keep only Simplified Chinese and English Chromium locales. The default
// Electron package ships ~40 MB of locale pak files that the app never uses.
module.exports = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') {
    // Apply to both local and CI NSIS builds. Low integrity one-file executables
    // cannot create their extraction directory in a normal Windows Temp folder.
    for (const relative of ['ClientHub.exe', 'resources/ai-sidecar/clienthub-ai.exe', 'resources/ffmpeg/ffmpeg.exe', 'resources/wechat-engine/wechat-backend.exe', 'resources/wechat-engine/native/wechatdb_broker.exe']) {
      execFileSync('icacls', [path.join(context.appOutDir, relative), '/setintegritylevel', 'Medium'], { stdio: 'pipe', windowsHide: true });
    }
  }
  const localesDir = path.join(context.appOutDir, 'locales');
  if (!fs.existsSync(localesDir)) return;
  const keep = new Set(['zh-CN.pak', 'en-US.pak']);
  for (const entry of fs.readdirSync(localesDir)) {
    if (!keep.has(entry)) {
      try { fs.unlinkSync(path.join(localesDir, entry)); } catch { /* ignore */ }
    }
  }
};
