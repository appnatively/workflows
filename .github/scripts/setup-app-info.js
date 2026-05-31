const fs = require('fs');
const path = require('path');

console.log(`🚀 Setting up dynamic App Info (Package ID, App Name, Version & Slug) in ${process.cwd()}...`);

// 1. Ensure required configuration exists in app_config.json
let configPath = 'app_config.json';
if (!fs.existsSync(configPath) && fs.existsSync('../app_config.json')) {
  configPath = '../app_config.json';
}

if (!fs.existsSync(configPath)) {
  console.error("❌ Error: app_config.json not found.");
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
  console.error("❌ Error: Failed to parse app_config.json:", err.message);
  process.exit(1);
}

// Extract keys matching the original jq pass: package_id, app_name, app_slug, app_version
const { package_id, app_name, app_slug, app_version } = config;

// Clean up values (keep only safe characters)
const sanitize = (val, regex) => {
  if (val === null || val === undefined) return '';
  return String(val).replace(regex, '');
};

const packageIdClean = sanitize(package_id, /[^a-zA-Z0-9._-]/g);
const appNameClean = sanitize(app_name, /[^a-zA-Z0-9 ._-]/g);
const slugClean = sanitize(app_slug, /[^a-zA-Z0-9._-]/g);
const appVersionClean = sanitize(app_version, /[^a-zA-Z0-9._-]/g);

// Enforce that all items are present and valid after sanitization
const variables = {
  PACKAGE_ID: packageIdClean,
  APP_NAME: appNameClean,
  SLUG: slugClean,
  APP_VERSION: appVersionClean
};

for (const [key, val] of Object.entries(variables)) {
  if (!val || val === 'null') {
    console.error(`❌ Error: Required configuration key '${key}' is missing, empty, or null in ${configPath}.`);
    process.exit(1);
  }
}

console.log(`✅ Target Package ID: ${variables.PACKAGE_ID}`);
console.log(`✅ Target App Name: ${variables.APP_NAME}`);
console.log(`✅ Target Slug: ${variables.SLUG}`);
console.log(`✅ Target App Version: ${variables.APP_VERSION}`);

// --- 2. Update app.config.ts ---
const appConfigPath = 'app.config.ts';
if (fs.existsSync(appConfigPath) && fs.lstatSync(appConfigPath).isFile()) {
  console.log("📝 Updating app.config.ts with clean regex replacements...");
  
  let content = fs.readFileSync(appConfigPath, 'utf8');
  
  content = content.replace(/name:\s*"[^"]*"/g, `name: "${variables.APP_NAME}"`);
  content = content.replace(/slug:\s*"[^"]*"/g, `slug: "${variables.SLUG}"`);
  content = content.replace(/version:\s*"[^"]*"/g, `version: "${variables.APP_VERSION}"`);
  content = content.replace(/bundleIdentifier:\s*"[^"]*"/g, `bundleIdentifier: "${variables.PACKAGE_ID}"`);
  content = content.replace(/package:\s*"[^"]*"/g, `package: "${variables.PACKAGE_ID}"`);
  content = content.replace(/scheme:\s*"[^"]*"/g, `scheme: "${variables.SLUG}"`);
  
  fs.writeFileSync(appConfigPath, content, 'utf8');
}

console.log("🎉 App Info dynamic setup complete.");
