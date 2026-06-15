#!/usr/bin/env node
/**
 * setup-config.js — Fetch build configuration from the AppNatively API.
 *
 * Reads API_URL, BUILD_ID, BUILD_ACCESS_TOKEN from environment.
 * Downloads app_config.json and emits ::add-mask:: commands for sensitive keys.
 */

const fs = require('fs');
const path = require('path');
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

    // Write dynamic .env file for native build steps
    const dotenvDir = fs.existsSync('app') ? 'app' : '.';
    const dotenvPath = path.join(dotenvDir, '.env');
    log.info(`Generating dynamic .env file in ${dotenvPath} for Expo CLI auto-loading...`);
    try {
      const envContent = [
        `EXPO_PUBLIC_API_URL=${config.expo_public_api_url}`,
        `EXPO_PUBLIC_APP_ID=${config.expo_public_app_id || config.app_id}`,
        `EXPO_PUBLIC_SOCKET_URL=${config.expo_public_socket_url}`,
        `EXPO_PUBLIC_SCHEMA_VERSION=${config.expo_public_schema_version || '1'}`,
        `EXPO_PUBLIC_IS_LAUNCHER=${config.app_type === 'launcher'}`,
      ].join('\n');
      
      fs.writeFileSync(dotenvPath, envContent, 'utf8');
      log.success(`Dynamic .env file created successfully in ${dotenvPath}.`);
    } catch (e) {
      log.warn(`Warning: Failed to create dynamic .env file: ${e.message}`);
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
