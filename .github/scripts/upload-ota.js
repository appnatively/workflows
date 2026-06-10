#!/usr/bin/env node
/**
 * upload-ota.js
 * Zips the per-platform bundle folder + metadata files and POSTs to the backend.
 *
 * Env: OTA_UPDATE_ID, API_URL, BUILD_ACCESS_TOKEN, PLATFORM
 */
const fs           = require('fs');
const path         = require('path');
const https        = require('https');
const http         = require('http');
const { execSync } = require('child_process');
const { log, fail } = require('./utils');

const OTA_UPDATE_ID      = process.env.OTA_UPDATE_ID;
const API_URL            = process.env.API_URL;
const BUILD_ACCESS_TOKEN = process.env.BUILD_ACCESS_TOKEN;
const PLATFORM           = process.env.PLATFORM;

if (!OTA_UPDATE_ID || !API_URL || !BUILD_ACCESS_TOKEN || !PLATFORM) {
  fail('Missing required env vars: OTA_UPDATE_ID, API_URL, BUILD_ACCESS_TOKEN, PLATFORM');
}

// Zip: metadata.json + expoConfig.json + platform files (only if they exist)
const ZIP = 'ota-bundle.zip';
const candidatePaths = ['metadata.json', 'expoConfig.json'];

const platformPaths = PLATFORM === 'android'
  ? ['app/android/app/src/main/assets', 'app/android/app/src/main/res']
  : ['app/ios/main.jsbundle', 'app/ios/assets'];

for (const p of platformPaths) {
  if (fs.existsSync(p)) {
    candidatePaths.push(p);
  } else {
    log.info(`Path ${p} does not exist, skipping zipping it.`);
  }
}

const pathsString = candidatePaths.map(p => `"${p}"`).join(' ');

log.info(`Zipping files: ${pathsString}...`);
execSync(`zip -r ${ZIP} ${pathsString}`, { stdio: 'inherit' });
log.success(`Bundle zipped: ${ZIP} (${(fs.statSync(ZIP).size / 1024 / 1024).toFixed(2)} MB)`);

// POST multipart form
const boundary = `----FormBoundary${Date.now()}`;
const fileBuffer = fs.readFileSync(ZIP);

const body = Buffer.concat([
  Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="ota_update_id"\r\n\r\n${OTA_UPDATE_ID}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="platform"\r\n\r\n${PLATFORM}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="bundle"; filename="ota-bundle.zip"\r\nContent-Type: application/zip\r\n\r\n`
  ),
  fileBuffer,
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);

const parsedUrl = new URL(`${API_URL}/ota/upload`);
const client = parsedUrl.protocol === 'https:' ? https : http;

log.info(`Uploading bundle to ${parsedUrl.toString()}...`);
const req = client.request(parsedUrl, {
  method: 'POST',
  headers: {
    'Authorization':  `Bearer ${BUILD_ACCESS_TOKEN}`,
    'Content-Type':   `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
  },
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      log.success(`Upload complete → ${res.statusCode}: ${data}`);
      fs.rmSync(ZIP, { force: true });
    } else {
      fail(`Upload failed → ${res.statusCode}: ${data}`);
    }
  });
});

req.on('error', err => fail(`Upload request error: ${err.message}`));
req.write(body);
req.end();
