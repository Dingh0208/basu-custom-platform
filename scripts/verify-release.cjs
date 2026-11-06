const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const yaml = createRequire(require.resolve('electron-updater'))('js-yaml');
const { version } = require('../package.json');
const root = path.resolve(__dirname, '../release');

async function verify(file, expectedHash, expectedSize) {
  if (expectedSize != null) assert.equal(fs.statSync(file).size, expectedSize, file);
  const hash = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  assert.equal(hash.digest('base64'), expectedHash, file);
}

(async () => {
  const offline = yaml.load(fs.readFileSync(path.join(root, 'latest.yml'), 'utf8'));
  const web = yaml.load(fs.readFileSync(path.join(root, 'nsis-web/latest.yml'), 'utf8'));
  assert.equal(offline.version, version);
  assert.equal(web.version, version);
  assert.equal(offline.path, `ClientHub-Setup-${version}.exe`);
  assert.equal(offline.packages, undefined, 'Existing installations must keep offline differential updates');
  assert.equal(web.path, `ClientHub-Web-Setup-${version}.exe`);
  await verify(path.join(root, offline.path), offline.sha512, offline.files[0].size);
  const blockmap = JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(root, offline.path + '.blockmap'))));
  assert.equal(blockmap.version, '2');
  assert(blockmap.files[0].checksums.length > 0);
  await verify(path.join(root, 'nsis-web', web.path), web.sha512);
  await verify(path.join(root, 'nsis-web', web.packages.x64.path), web.packages.x64.sha512, web.packages.x64.size);
  console.log(`PASS v${version}: offline update channel, web installer, payload and SHA512`);
})().catch(error => { console.error(error); process.exitCode = 1; });
