#!/usr/bin/env node
/**
 * setup-ota-config.js
 * Fetches OTA build configuration from AppNatively and writes app_config.json.
 * Same file format as native builds → inject-env.js and download-r2.js work unchanged.
 */
const fs = require('fs');
const { request, log, fail } = require('./utils');

const BUILD_ACCESS_TOKEN = process.env.BUILD_ACCESS_TOKEN;
const OTA_UPDATE_ID      = process.env.OTA_UPDATE_ID;
const API_URL            = process.env.API_URL;

if (!BUILD_ACCESS_TOKEN) fail('BUILD_ACCESS_TOKEN is missing.');
if (!OTA_UPDATE_ID || !API_URL) fail('OTA_UPDATE_ID or API_URL is missing.');

const url = `${API_URL}/ota/build-config?otaUpdateId=${OTA_UPDATE_ID}`;
log.info(`Fetching OTA config from ${url}...`);

async function run() {
  const data = await request(url, {
    headers: { Authorization: `Bearer ${BUILD_ACCESS_TOKEN}` }
  });

  if (!data?.trim()) fail('OTA config response is empty.');

  fs.writeFileSync('app_config.json', data, 'utf8');

  const config = JSON.parse(data);
  // Mask sensitive values in GH Actions logs
  for (const key of ['r2_access_key_id', 'r2_secret_access_key']) {
    if (config[key]) process.stdout.write(`::add-mask::${config[key]}\n`);
  }
  log.success('OTA config ready.');
}
run().catch(err => fail(err.message));
