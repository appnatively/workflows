#!/usr/bin/env node
/**
 * inject-env.js — Inject dynamic environment variables into a pre-built JS bundle.
 *
 * Usage:
 *   node ./scripts/inject-env.js <bundle-path> [app-config-path]
 *
 * Arguments:
 *   bundle-path      Path to the JS bundle file to inject into.
 *                    Android: android/app/src/main/assets/index.android.bundle
 *                    iOS:     ios/main.jsbundle
 *   app-config-path  (Optional) Path to app_config.json. Defaults to ../app_config.json.
 *
 * Reads from app_config.json:
 *   - expo_public_api_url
 *   - expo_public_app_id
 *   - expo_public_socket_url
 *
 * Replaces placeholders in the bundle:
 *   __PLACEHOLDER_EXPO_PUBLIC_API_URL__
 *   __PLACEHOLDER_EXPO_PUBLIC_APP_ID__
 *   __PLACEHOLDER_EXPO_PUBLIC_SOCKET_URL__
 */

const fs = require('fs');
const path = require('path');

// --- Parse Arguments ---
const [bundlePath, configPathArg] = process.argv.slice(2);

if (!bundlePath) {
  console.error('❌ Usage: node inject-env.js <bundle-path> [app-config-path]');
  process.exit(1);
}

// --- Resolve app_config.json ---
let configPath = configPathArg || '../app_config.json';
if (!fs.existsSync(configPath)) {
  // Fallback: try same directory
  const altConfigPath = 'app_config.json';
  if (fs.existsSync(altConfigPath)) {
    configPath = altConfigPath;
  } else {
    console.error(`❌ app_config.json not found at '${configPath}' or '${altConfigPath}'.`);
    process.exit(1);
  }
}

// --- Load Config ---
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
  console.error('❌ Failed to parse app_config.json:', err.message);
  process.exit(1);
}

const API_URL = config.expo_public_api_url;
const APP_ID = config.expo_public_app_id;
const SOCKET_URL = config.expo_public_socket_url;

console.log('📖 Discovering app configuration...');
console.log(`  API_URL:    ${API_URL}`);
console.log(`  APP_ID:     ${APP_ID}`);
console.log(`  SOCKET_URL: ${SOCKET_URL}`);

// --- Validate Bundle File ---
if (!fs.existsSync(bundlePath)) {
  console.error(`❌ Bundle file not found: ${bundlePath}`);
  process.exit(1);
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
    console.warn(`⚠️ ${label} is missing or null in app_config.json — skipping injection.`);
    continue;
  }
  const occurrences = content.split(placeholder).length - 1;
  content = content.replaceAll(placeholder, value);
  console.log(`✅ Injecting ${label}=${value} (${occurrences} occurrence(s) replaced)`);
}

fs.writeFileSync(bundlePath, content, 'utf8');
console.log('\n🎉 Environment variable injection complete.');
