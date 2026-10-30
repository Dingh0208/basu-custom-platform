const fs = require('node:fs');
const path = require('node:path');

// Keep only Simplified Chinese and English Chromium locales. The default
// Electron package ships ~40 MB of locale pak files that the app never uses.
module.exports = async function afterPack(context) {
  const localesDir = path.join(context.appOutDir, 'locales');
  if (!fs.existsSync(localesDir)) return;
  const keep = new Set(['zh-CN.pak', 'en-US.pak']);
  for (const entry of fs.readdirSync(localesDir)) {
    if (!keep.has(entry)) {
      try { fs.unlinkSync(path.join(localesDir, entry)); } catch { /* ignore */ }
    }
  }
};
