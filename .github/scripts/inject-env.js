#!/usr/bin/env node
/**
 * inject-env.js — Inject dynamic environment variables into a pre-built JS bundle.
 */

const fs = require('fs');
const { loadAppConfig, log, fail } = require('./utils');

// --- Parse Arguments ---
const [bundlePath, configPathArg] = process.argv.slice(2);

if (!bundlePath) {
  fail('Usage: node inject-env.js <bundle-path> [app-config-path]');
}

// --- Load Config ---
const { config } = loadAppConfig(configPathArg);

const API_URL = config.expo_public_api_url;
const APP_ID = config.expo_public_app_id;
const SOCKET_URL = config.expo_public_socket_url;

log.info('Discovering app configuration...');
console.log(`  API_URL:    ${API_URL}`);
console.log(`  APP_ID:     ${APP_ID}`);
console.log(`  SOCKET_URL: ${SOCKET_URL}`);

// --- Validate Bundle File ---
if (!fs.existsSync(bundlePath)) {
  fail(`Bundle file not found: ${bundlePath}`);
}

// --- Inject Placeholders ---
console.log(`\n💉 Injecting dynamic environment variables into: ${bundlePath}`);

let content = fs.readFileSync(bundlePath, 'utf8');

const replacements = [
  { placeholder: '__PLACEHOLDER_EXPO_PUBLIC_APP_ID__', value: APP_ID, label: 'EXPO_PUBLIC_APP_ID' },
  { placeholder: '__PLACEHOLDER_EXPO_PUBLIC_API_URL__', value: API_URL, label: 'EXPO_PUBLIC_API_URL' },
  { placeholder: '__PLACEHOLDER_EXPO_PUBLIC_SOCKET_URL__', value: SOCKET_URL, label: 'EXPO_PUBLIC_SOCKET_URL' },
];

for (const { placeholder, value, label } of replacements) {
  if (!value || value === 'null') {
    log.warn(`${label} is missing or null in app_config.json — skipping injection.`);
    continue;
  }
  const occurrences = content.split(placeholder).length - 1;
  content = content.replaceAll(placeholder, value);
  log.success(`Injecting ${label}=${value} (${occurrences} occurrence(s) replaced)`);
}

fs.writeFileSync(bundlePath, content, 'utf8');
console.log('\n🎉 Environment variable injection complete.');
