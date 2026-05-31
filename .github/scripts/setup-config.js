#!/usr/bin/env node
/**
 * setup-config.js — Fetch build configuration from the AppNatively API.
 *
 * Reads API_URL, BUILD_ID, BUILD_ACCESS_TOKEN from environment.
 * Downloads app_config.json and emits ::add-mask:: commands for sensitive keys.
 */

const fs = require('fs');
const { request, log, fail } = require('./utils');

const BUILD_ACCESS_TOKEN = process.env.BUILD_ACCESS_TOKEN;
const BUILD_ID = process.env.BUILD_ID;
const API_URL = process.env.API_URL;

if (!BUILD_ACCESS_TOKEN) {
  fail('BUILD_ACCESS_TOKEN is missing.');
}
if (!BUILD_ID || !API_URL) {
  fail('BUILD_ID or API_URL is missing.');
}

const url = `${API_URL}/builds/${BUILD_ID}/config`;
log.info(`Fetching build configuration from ${API_URL}/builds/${BUILD_ID}/config...`);

async function run() {
  try {
    const data = await request(url, {
      headers: { Authorization: `Bearer ${BUILD_ACCESS_TOKEN}` }
    });
    
    if (!data || data.trim() === '') {
      fail('Configuration file is empty.');
    }

    fs.writeFileSync('app_config.json', data, 'utf8');

    let config;
    try {
      config = JSON.parse(data);
    } catch (err) {
      fail(`Failed to parse configuration JSON: ${err.message}`);
    }

    log.info('Masking sensitive configuration data...');
    const sensitiveKeys = [
      'r2_access_key_id',
      'r2_secret_access_key',
      'google_drive_access_token',
      'google_drive_refresh_token',
      'google_drive_client_id',
      'google_drive_client_secret',
    ];

    for (const key of sensitiveKeys) {
      const value = config[key];
      if (value && value !== 'null') {
        // GitHub Actions masking command
        process.stdout.write(`::add-mask::${value}\n`);
      }
    }

    log.success('Configuration fetched and runtime masking complete.');
  } catch (err) {
    fail(`Failed to fetch configuration from API: ${err.message}`);
  }
}

run();
