const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { test } = require('node:test');
const vm = require('node:vm');

// Exercise real response streams without opening sockets or using build credentials.
function httpFixture(responses) {
  const requests = [];
  const client = {
    request(url, options, receive) {
      const response = responses[requests.length];
      requests.push({ url: url.href, options });
      const req = new EventEmitter();
      req.end = () => queueMicrotask(() => {
        const res = new PassThrough();
        res.statusCode = response.statusCode ?? 200;
        res.headers = response.headers || {};
        receive(res);
        if (response.event) {
          res.emit(response.event, new Error('Interrupted response'));
          res.destroy();
          return;
        }
        for (const chunk of response.chunks || [response.body || '']) res.write(chunk);
        res.end();
      });
      return req;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(path.join(__dirname, 'utils.js'), 'utf8'), {
    require: name => ['http', 'https'].includes(name) ? client : require(name),
    module,
    Buffer,
    URL,
  });
  return { request: module.exports.request, requests };
}

const configUrl = 'https://api.example.test/app/config?schemaVersion=2';

test('includes the public API error but omits unrelated fields and control characters', async () => {
  const payload = JSON.stringify({
    error: 'Published content must be regenerated\nfor the compiled runtime\u001b',
    privateField: 'must-not-be-logged',
  });
  const f = httpFixture([{ statusCode: 409, chunks: [payload.slice(0, 25), payload.slice(25)] }]);
  await assert.rejects(f.request(configUrl, { includeErrorDetails: true }), error => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.message, `Server returned status 409 for ${configUrl}: Published content must be regenerated for the compiled runtime `);
    assert.ok(!error.message.includes('must-not-be-logged'));
    return true;
  });
});

test('leaves response details out of errors unless explicitly requested', async () => {
  const f = httpFixture([{ statusCode: 403, body: '{"error":"must-not-be-logged"}' }]);
  await assert.rejects(f.request(configUrl), error => {
    assert.equal(error.statusCode, 403);
    assert.equal(error.message, `Server returned status 403 for ${configUrl}`);
    return true;
  });
});

for (const body of ['<html>Internal error</html>', '{"error":', '{"error":{"unexpected":"shape"}}', 'null', JSON.stringify({ error: 'x'.repeat(9000) })]) {
  test(`retains the HTTP error for an unsupported response (${body.length} bytes, ${body.slice(0, 15)})`, async () => {
    const f = httpFixture([{ statusCode: 409, body }]);
    await assert.rejects(f.request(configUrl, { includeErrorDetails: true }), error => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, `Server returned status 409 for ${configUrl}`);
      return true;
    });
  });
}

test('bounds the displayed error message', async () => {
  const f = httpFixture([{ statusCode: 409, body: JSON.stringify({ error: 'x'.repeat(600) }) }]);
  await assert.rejects(f.request(configUrl, { includeErrorDetails: true }), error => {
    assert.equal(error.message, `Server returned status 409 for ${configUrl}: ${'x'.repeat(500)}`);
    return true;
  });
});

for (const event of ['error', 'aborted']) {
  test(`retains the HTTP status when the error response is interrupted (${event})`, async () => {
    const f = httpFixture([{ statusCode: 409, event }]);
    await assert.rejects(f.request(configUrl, { includeErrorDetails: true }), error => {
      assert.equal(error.statusCode, 409);
      return true;
    });
  });
}

test('preserves public error details after a redirect', async () => {
  const f = httpFixture([
    { statusCode: 302, headers: { location: '/new/config?schemaVersion=2' } },
    { statusCode: 409, body: '{"error":"Open the editor and publish this app again."}' },
  ]);
  await assert.rejects(f.request(configUrl, { includeErrorDetails: true }), error => {
    assert.equal(error.statusCode, 409);
    assert.ok(error.message.endsWith(': Open the editor and publish this app again.'));
    return true;
  });
  assert.equal(f.requests[1].url, 'https://api.example.test/new/config?schemaVersion=2');
});

test('preserves successful text and binary downloads', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const f = httpFixture([{ body: '{"layout":"ready"}' }, { body: bytes }]);
  assert.equal(await f.request(configUrl, { includeErrorDetails: true }), '{"layout":"ready"}');
  assert.deepEqual(await f.request('https://assets.example.test/icon.png', { isBinary: true }), bytes);
});
