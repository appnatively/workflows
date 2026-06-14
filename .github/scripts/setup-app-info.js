const fs = require('fs');
const { loadAppConfig, sanitizeString, log, fail } = require('./utils');

log.step(`Setting up dynamic App Info (Package ID, App Name, Version & Slug) in ${process.cwd()}...`);

// 1. Ensure required configuration exists in app_config.json
const { config, configPath } = loadAppConfig();

// Extract keys matching the original jq pass: package_id, app_name, app_slug, app_version
const { package_id, app_name, app_slug, app_version } = config;

const packageIdClean = sanitizeString(package_id, /[^a-zA-Z0-9._-]/g);
const appNameClean = sanitizeString(app_name, /[^a-zA-Z0-9 ._-]/g);
const slugClean = sanitizeString(app_slug, /[^a-zA-Z0-9._-]/g);
const appVersionClean = sanitizeString(app_version, /[^a-zA-Z0-9._-]/g);

// Enforce that all items are present and valid after sanitization
const variables = {
  PACKAGE_ID: packageIdClean,
  APP_NAME: appNameClean,
  SLUG: slugClean,
  APP_VERSION: appVersionClean
};

for (const [key, val] of Object.entries(variables)) {
  if (!val || val === 'null') {
    fail(`Required configuration key '${key}' is missing, empty, or null in ${configPath}.`);
  }
}

log.success(`Target Package ID: ${variables.PACKAGE_ID}`);
log.success(`Target App Name: ${variables.APP_NAME}`);
log.success(`Target Slug: ${variables.SLUG}`);
log.success(`Target App Version: ${variables.APP_VERSION}`);

// --- 2. Update app.config.ts ---
const appConfigPath = 'app.config.ts';
if (fs.existsSync(appConfigPath) && fs.lstatSync(appConfigPath).isFile()) {
  log.info("Updating app.config.ts with clean regex replacements...");
  
  let content = fs.readFileSync(appConfigPath, 'utf8');
  
  content = content.replace(/name:\s*"[^"]*"/g, `name: "${variables.APP_NAME}"`);
  content = content.replace(/slug:\s*"[^"]*"/g, `slug: "${variables.SLUG}"`);
  content = content.replace(/version:\s*"[^"]*"/g, `version: "${variables.APP_VERSION}"`);
  content = content.replace(/bundleIdentifier:\s*"[^"]*"/g, `bundleIdentifier: "${variables.PACKAGE_ID}"`);
  content = content.replace(/package:\s*"[^"]*"/g, `package: "${variables.PACKAGE_ID}"`);
  content = content.replace(/scheme:\s*"[^"]*"/g, `scheme: "${variables.SLUG}"`);
  
  fs.writeFileSync(appConfigPath, content, 'utf8');
}

// --- 3. Update app.manifest for Android and iOS ---
const androidManifestPath = 'android/app/src/main/assets/app.manifest';
const iosManifestPath = 'ios/EXUpdates.bundle/app.manifest';

function patchManifest(manifestPath) {
  if (fs.existsSync(manifestPath) && fs.lstatSync(manifestPath).isFile()) {
    log.info(`Patching manifest at ${manifestPath} with dynamic Expo config...`);
    try {
      const content = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(content);

      const isLauncher = config.app_type === 'launcher';
      const expoConfig = {
        runtimeVersion: String(config.expo_public_schema_version || '1'),
        scheme: variables.SLUG,
        extra: {
          isLauncher: isLauncher,
          apiUrl: config.expo_public_api_url,
          appId: config.app_id || config.expo_public_app_id,
          socketUrl: config.expo_public_socket_url,
        }
      };

      manifest.extra = {
        expoClient: expoConfig
      };

      fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
      log.success(`Successfully patched manifest: ${manifestPath}`);
    } catch (e) {
      log.warn(`Warning: Failed to patch manifest at ${manifestPath}: ${e.message}`);
    }
  } else {
    log.info(`Manifest file not found at ${manifestPath}, skipping.`);
  }
}

patchManifest(androidManifestPath);
patchManifest(iosManifestPath);
