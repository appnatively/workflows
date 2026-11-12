const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const script = readFileSync(path.join(__dirname, 'setup-app-info.js'), 'utf8');
const targetPackage = 'com.marktplaatsaruba.app';

function fixture(source, { isFile = true, config = {} } = {}) {
  const files = new Map(source === undefined ? [] : [['app.config.ts', source]]);
  const writes = [];
  const successes = [];
  const modules = {
    fs: {
      existsSync: file => files.has(file),
      lstatSync: () => ({ isFile: () => isFile }),
      readFileSync: file => files.get(file),
      writeFileSync(file, content) {
        writes.push({ file, content });
        files.set(file, content);
      },
    },
    './utils': {
      loadAppConfig: () => ({
        config: {
          package_id: targetPackage,
          app_name: 'Synthetic App',
          app_slug: 'synthetic-app',
          app_version: '1.2.3',
          ...config,
        },
        configPath: 'synthetic-app_config.json',
      }),
      sanitizeString: (value, regex) => String(value ?? '').replace(regex, ''),
      log: { step() {}, info() {}, success: message => successes.push(message) },
      fail: message => { throw new Error(message); },
    },
  };
  return {
    files,
    writes,
    successes,
    run: () => vm.runInNewContext(script, {
      require: name => {
        assert.ok(Object.hasOwn(modules, name), `Unexpected module ${name}`);
        return modules[name];
      },
      process: { cwd: () => 'synthetic-app' },
    }),
  };
}

function template(assignment) {
  return `export default {
  name: 'Bazar',
  slug: 'bazar',
  version: '0.0.3',
  scheme: 'bazar',
  ios: {
    bundleIdentifier: 'com.crafium.bazar',
  },
  android: {
${assignment}
    googleServicesFile: './google-services.json',
  },
};
`;
}

for (const [label, assignment] of [
  ['single quotes', "    package: 'com.crafium.bazar',"],
  ['double quotes', '    package: "com.crafium.bazar",'],
  ['tabs and spaces', "\tpackage \t: \t'com.crafium.bazar' ,"],
  ['multiline whitespace', '    package:\n      "com.crafium.bazar",'],
  ['CRLF', "    package: 'com.crafium.bazar',\r"],
]) {
  test(`applies the configured Android package with ${label} without changing other fields`, () => {
    const source = template(assignment);
    const f = fixture(source);
    f.run();
    assert.equal(f.writes.length, 1);
    assert.equal(f.files.get('app.config.ts'), template(assignment.replace('com.crafium.bazar', targetPackage)));
    assert.ok(f.successes.includes(`Applied Android Package ID: ${targetPackage}`));
    const firstOutput = f.files.get('app.config.ts');
    f.run();
    assert.equal(f.files.get('app.config.ts'), firstOutput, 'repeated setup must be idempotent');
  });
}

test('uses each build configuration rather than a fixed package ID', () => {
  const f = fixture(template("    package: 'com.crafium.bazar',"), {
    config: { package_id: 'com.example.anotherapp' },
  });
  f.run();
  assert.equal(f.files.get('app.config.ts'), template("    package: 'com.example.anotherapp',"));
});

test('preserves the existing replacement behavior for other double-quoted metadata', () => {
  const source = template('    package: "com.crafium.bazar",').replaceAll("'", '"');
  const f = fixture(source);
  f.run();
  const expected = source
    .replace('name: "Bazar"', 'name: "Synthetic App"')
    .replace('slug: "bazar"', 'slug: "synthetic-app"')
    .replace('version: "0.0.3"', 'version: "1.2.3"')
    .replace('scheme: "bazar"', 'scheme: "synthetic-app"')
    .replaceAll('com.crafium.bazar', targetPackage);
  assert.equal(f.files.get('app.config.ts'), expected);
});

for (const [label, source, options, message] of [
  ['missing config', undefined, {}, /missing or is not a file/],
  ['directory instead of config', 'directory', { isFile: false }, /missing or is not a file/],
  ['absent assignment', template(''), {}, /found 0/],
  ['dynamic assignment', template('    package: process.env.PACKAGE_ID,'), {}, /found 0/],
  ['computed package expression', template("    package: 'com.example.' + suffix,"), {}, /found 0/],
  ['commented assignment', template("    // package: 'com.crafium.bazar',"), {}, /found 0/],
  ['ambiguous assignments', template("    package: 'com.crafium.bazar',\n    package: 'com.example.other',"), {}, /found 2/],
  ['empty input package', template("    package: 'com.crafium.bazar',"), { config: { package_id: '' } }, /PACKAGE_ID.*missing, empty, or null/],
]) {
  test(`fails without writing changes for ${label}`, () => {
    const f = fixture(source, options);
    assert.throws(f.run, message);
    assert.equal(f.writes.length, 0);
    assert.equal(f.files.get('app.config.ts'), source);
    assert.ok(!f.successes.some(message => message.startsWith('Applied Android Package ID:')));
  });
}
