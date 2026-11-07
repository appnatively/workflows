const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

for (const schemaVersion of [undefined, '9']) {
  test(`downloads a layout without connector metadata (app schema ${schemaVersion || 'default'})`, async () => {
    const writes = new Map();
    const requests = [];
    const config = {
      expo_public_api_url: 'https://api.example.test/mobile-app/',
      expo_public_app_id: 'synthetic-app',
      expo_public_schema_version: schemaVersion,
      asset_icon_url: 'https://assets.example.test/icon.png',
    };
    const layout = { platform: 'custom', customConnector: { specVersion: 1, contractVersion: 1, protocol: 'appnatively.rest.direct' } };
    const utils = {
      loadAppConfig: () => ({ config }),
      log: { info() {}, warn() {}, success() {} },
      fail: message => { throw new Error(message); },
      request: async url => {
        requests.push(url);
        if (url === config.asset_icon_url) return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
        return JSON.stringify(layout);
      },
    };
    const modules = {
      fs: {
        mkdirSync() {},
        writeFileSync: (file, data) => writes.set(file, data),
        existsSync: file => writes.has(file),
        copyFileSync: (from, to) => writes.set(to, writes.get(from)),
      },
      path,
      child_process: { execSync() { throw new Error('Unexpected process execution'); } },
      './utils': utils,
    };
    await vm.runInNewContext(readFileSync(path.join(__dirname, 'setup-assets.js'), 'utf8'), {
      require: name => {
        assert.ok(Object.hasOwn(modules, name), `Unexpected module ${name}`);
        return modules[name];
      },
      process: { env: { BUILD_ID: 'synthetic-build' } },
      URL,
    });
    const url = new URL(requests[0]);
    assert.equal(url.pathname, '/mobile-app/synthetic-app/config');
    assert.deepEqual([...url.searchParams], [['schemaVersion', schemaVersion || '1']]);
    assert.deepEqual(JSON.parse(writes.get('src/assets/default-app-config.json')), layout);
    assert.equal(requests.length, 2);
    assert.ok(writes.has('assets/images/icon.png'));
    assert.ok(writes.has('assets/images/splash-icon.png'));
  });
}
