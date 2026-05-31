#!/usr/bin/env node
/**
 * setup-config.js — Fetch build configuration from the AppNatively API.
 *
 * Reads API_URL, BUILD_ID, BUILD_ACCESS_TOKEN from environment.
 * Downloads app_config.json and emits ::add-mask:: commands for sensitive keys.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');

const BUILD_ACCESS_TOKEN = process.env.BUILD_ACCESS_TOKEN;
const BUILD_ID = process.env.BUILD_ID;
const API_URL = process.env.API_URL;

if (!BUILD_ACCESS_TOKEN) {
  console.error('❌ BUILD_ACCESS_TOKEN is missing.');
  process.exit(1);
}
if (!BUILD_ID || !API_URL) {
  console.error('❌ BUILD_ID or API_URL is missing.');
  process.exit(1);
}

const url = `${API_URL}/builds/${BUILD_ID}/config`;
console.log(`📡 Fetching build configuration from ${API_URL}/builds/${BUILD_ID}/config...`);

function fetchUrl(targetUrl, callback) {
  const parsedUrl = new URL(targetUrl);
  const client = parsedUrl.protocol === 'https:' ? https : http;
  const options = {
    headers: { Authorization: `Bearer ${BUILD_ACCESS_TOKEN}` }
  };
  client.get(targetUrl, options, (res) => {
    if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
      return fetchUrl(res.headers.location, callback);
    }
    callback(res);
  }).on('error', (err) => {
    console.error('❌ Failed to connect to API:', err.message);
    process.exit(1);
  });
}

fetchUrl(url, (res) => {
  if (res.statusCode !== 200) {
    console.error(`❌ Failed to fetch configuration from API. Status: ${res.statusCode}`);
    process.exit(1);
  }

  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    if (!data || data.trim() === '') {
      console.error('❌ Configuration file is empty.');
      process.exit(1);
    }

    fs.writeFileSync('app_config.json', data, 'utf8');

    let config;
    try {
      config = JSON.parse(data);
    } catch (err) {
      console.error('❌ Failed to parse configuration JSON:', err.message);
      process.exit(1);
    }

    console.log('🔐 Masking sensitive configuration data...');
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

    console.log('✅ Configuration fetched and runtime masking complete.');
  });
});
