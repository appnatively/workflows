#!/usr/bin/env node
/**
 * generate-ota-metadata.js
 * Scans the unzipped R2 bundle folder and produces:
 *   - metadata.json   (Expo Updates protocol fileMetadata shape)
 *   - expoConfig.json (app name/slug/version snapshot)
 *
 * Env: PLATFORM ('android' | 'ios'), OTA_UPDATE_ID
 */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { loadAppConfig, log, fail } = require('./utils');

const PLATFORM = process.env.PLATFORM;
if (!PLATFORM) fail('PLATFORM env var is required (android | ios).');

const { config } = loadAppConfig();

// ── Hash Helpers ─────────────────────────────────────────────────────────────
function getSha256Base64Url(filePath) {
  const content = fs.readFileSync(filePath);
  const base64 = crypto.createHash('sha256').update(content).digest('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function getMd5Hex(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

// ── Bundle paths ────────────────────────────────────────────────────────────
const BUNDLE_PATHS = {
  android: 'app/android/app/src/main/assets/index.android.bundle',
  ios:     'app/ios/main.jsbundle',
};

// ── Asset root directories ───────────────────────────────────────────────────
const ASSET_ROOTS = {
  android: 'app/android/app/src/main/res',
  ios:     'app/ios/assets',
};

const bundlePath = BUNDLE_PATHS[PLATFORM];
const assetRoot  = ASSET_ROOTS[PLATFORM];

if (!fs.existsSync(bundlePath)) fail(`Bundle not found: ${bundlePath}`);

// ── Walk assets recursively ─────────────────────────────────────────────────
function walk(dir, base = dir) {
  const entries = [];
  if (!fs.existsSync(dir)) return entries;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walk(full, base));
    } else {
      entries.push({
        path: full,                           // absolute
        rel:  path.relative('.', full).replace(/\\/g, '/'), // relative to workspace root (POSIX style)
        ext:  path.extname(entry.name).replace('.', '') || 'bin',
      });
    }
  }
  return entries;
}

const assetFiles = walk(assetRoot);

// ── Build metadata.json ──────────────────────────────────────────────────────
const metadata = {
  version: 0,
  bundler: 'metro',
  fileMetadata: {
    [PLATFORM]: {
      bundle: path.relative('.', bundlePath).replace(/\\/g, '/'),
      bundleHash: getSha256Base64Url(bundlePath),
      bundleContentMd5: getMd5Hex(bundlePath),
      assets: assetFiles.map(f => ({
        path: f.rel,
        ext: f.ext,
        hash: getSha256Base64Url(f.path),
        contentMd5: getMd5Hex(f.path),
      })),
    },
  },
};

fs.writeFileSync('metadata.json', JSON.stringify(metadata, null, 2));
log.success(`metadata.json written (${assetFiles.length} assets)`);

// ── Build expoConfig.json ────────────────────────────────────────────────────
const expoConfig = {
  name:           config.app_name   || 'AppNatively',
  slug:           config.app_slug   || 'appnatively',
  version:        config.app_version || '0.0.1',
  runtimeVersion: String(config.schema_version || '1'),
  scheme:         config.app_scheme  || 'app',
};

fs.writeFileSync('expoConfig.json', JSON.stringify(expoConfig, null, 2));
log.success('expoConfig.json written.');
