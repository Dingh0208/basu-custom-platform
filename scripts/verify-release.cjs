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
  assert.equal(offline.path, `ClientAtlas-Setup-${version}.exe`);
  assert.equal(offline.packages, undefined, 'Existing installations must keep offline differential updates');
  assert.equal(web.path, `ClientAtlas-Web-Setup-${version}.exe`);
  await verify(path.join(root, offline.path), offline.sha512, offline.files[0].size);
  const blockmap = JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(root, offline.path + '.blockmap'))));
  assert.equal(blockmap.version, '2');
  assert(blockmap.files[0].checksums.length > 0);
  await verify(path.join(root, 'nsis-web', web.path), web.sha512);
  await verify(path.join(root, 'nsis-web', web.packages.x64.path), web.packages.x64.sha512, web.packages.x64.size);
  const manifest = require('../electron/wechat-component.json');
  const component = path.join(root, 'components', `ClientAtlas-WeChat-Engine-${version}.zip`);
  const componentHash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(component)) componentHash.update(chunk);
  assert.equal(componentHash.digest('hex'), manifest.sha256);
  assert(!fs.existsSync(path.join(root, 'win-unpacked', 'resources', 'wechat-engine')), 'Optional engine must not be bundled');
  assert(!fs.existsSync(path.join(root, 'win-unpacked', 'resources', 'ai-sidecar', '.env')), 'Local API key must not be bundled');
  assert(!fs.existsSync(path.join(root, 'win-unpacked', 'resources', 'ai-sidecar', 'data')), 'Local database must not be bundled');
  console.log(`PASS v${version}: offline update channel, web installer, optional WeChat component and checksums`);
})().catch(error => { console.error(error); process.exitCode = 1; });
