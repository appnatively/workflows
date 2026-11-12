const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

for (const schemaVersion of [undefined, '9']) {
  test(`downloads a layout without connector metadata (app schema ${schemaVersion || 'default'})`, async () => {
    const writes = new Map();
    const requests = [];
    const requestOptions = [];
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
      request: async (url, options) => {
        requests.push(url);
        requestOptions.push(options);
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
    assert.equal(requestOptions[0].includeErrorDetails, true);
    assert.equal(requestOptions[1].includeErrorDetails, undefined);
    assert.ok(writes.has('assets/images/icon.png'));
    assert.ok(writes.has('assets/images/splash-icon.png'));
  });
}

for (const statusCode of [409, 404, 500]) {
  test(`stops asset setup on HTTP ${statusCode} without overwriting the embedded layout`, async () => {
    const existingLayout = '{"previous":"layout"}';
    const writes = new Map([['src/assets/default-app-config.json', existingLayout]]);
    const requests = [];
    const serverMessage = statusCode === 409
      ? 'Published content must be regenerated for the compiled runtime'
      : 'Layout request failed';
    const config = {
      expo_public_api_url: 'https://api.example.test/mobile-app/',
      expo_public_app_id: 'synthetic-app',
      expo_public_schema_version: '2',
      asset_icon_url: 'https://assets.example.test/icon.png',
    };
    const modules = {
      fs: {
        mkdirSync() {},
        writeFileSync: (file, data) => writes.set(file, data),
      },
      path,
      child_process: { execSync() { throw new Error('Unexpected process execution'); } },
      './utils': {
        loadAppConfig: () => ({ config }),
        log: { info() {}, warn() {}, success() {} },
        fail: message => { throw new Error(message); },
        request: async url => {
          requests.push(url);
          throw Object.assign(new Error(`Server returned status ${statusCode}: ${serverMessage}`), { statusCode });
        },
      },
    };
    await assert.rejects(vm.runInNewContext(readFileSync(path.join(__dirname, 'setup-assets.js'), 'utf8'), {
      require: name => {
        assert.ok(Object.hasOwn(modules, name), `Unexpected module ${name}`);
        return modules[name];
      },
      process: { env: { BUILD_ID: 'synthetic-build' } },
      URL,
    }), error => {
      assert.ok(error.message.includes(serverMessage));
      assert.equal(error.message.includes('click Publish, then rerun the build'), statusCode === 409);
      return true;
    });
    assert.equal(requests.length, 1, 'must not retry another schema or start image downloads');
    assert.equal(new URL(requests[0]).searchParams.get('schemaVersion'), '2');
    assert.deepEqual([...writes], [['src/assets/default-app-config.json', existingLayout]]);
  });
}
