#!/usr/bin/env node
/**
 * report-ota-failure.js
 * Called from `if: failure()` step to mark the OTA record as failed in D1.
 * Best-effort: exits 0 always so it doesn't obscure the real failure.
 *
 * Args: <error message string>
 */
const https = require('https');
const http  = require('http');
const { log } = require('./utils');

const [,, errorMsg = 'Unknown error'] = process.argv;
const OTA_UPDATE_ID      = process.env.OTA_UPDATE_ID;
const API_URL            = process.env.API_URL;
const BUILD_ACCESS_TOKEN = process.env.BUILD_ACCESS_TOKEN;

if (!OTA_UPDATE_ID || !API_URL || !BUILD_ACCESS_TOKEN) {
  log.warn('Cannot report failure: missing env vars.');
  process.exit(0);
}

const body = JSON.stringify({ otaUpdateId: OTA_UPDATE_ID, error: errorMsg });
const parsedUrl = new URL(`${API_URL}/ota/report-failure`);
const client = parsedUrl.protocol === 'https:' ? https : http;

log.info(`Reporting OTA failure to ${parsedUrl.toString()}...`);
const req = client.request(parsedUrl, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${BUILD_ACCESS_TOKEN}`,
    'Content-Type':  'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
}, (res) => {
  log.info(`Failure reported → ${res.statusCode}`);
  process.exit(0);
});

req.on('error', err => {
  log.warn(`Could not report failure: ${err.message}`);
  process.exit(0);
});

req.write(body);
req.end();
