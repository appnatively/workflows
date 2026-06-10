const fs = require('fs');
const path = require('path');
const { loadAppConfig, runCommand, log, fail } = require('./utils');

// Load App Config and construct prebuild environment variables
const { config } = loadAppConfig();
const prebuildEnv = {
  EXPO_PUBLIC_API_URL: config.expo_public_api_url,
  EXPO_PUBLIC_APP_ID: config.expo_public_app_id,
  EXPO_PUBLIC_SOCKET_URL: config.expo_public_socket_url,
  EXPO_PUBLIC_SCHEMA_VERSION: String(config.expo_public_schema_version || '1')
};

// Define directories
const ANDROID_DIR = 'android';
const BUILD_GRADLE = path.join(ANDROID_DIR, 'app', 'build.gradle');
const TEMP_ASSETS = `temp-assets-${process.pid}`;

// Ensure google-services.json exists for Expo prebuild
if (!fs.existsSync('google-services.json')) {
  fail("Required Firebase configuration file 'google-services.json' is missing. Firebase setup must run and succeed first.");
}

const androidExists = fs.existsSync(ANDROID_DIR) && fs.lstatSync(ANDROID_DIR).isDirectory();
const gradleExists = fs.existsSync(BUILD_GRADLE) && fs.lstatSync(BUILD_GRADLE).isFile();

// Check if the android folder exists and is complete
if (androidExists && !gradleExists) {
  // Scenario 1: The android folder exists but is incomplete (created only by bundle:android)
  log.warn("Incomplete Android project detected (contains assets but no Gradle files).");
  log.info("Backing up bundle and assets...");
  
  // Create temp backup directories
  fs.mkdirSync(path.join(TEMP_ASSETS, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(TEMP_ASSETS, 'res'), { recursive: true });
  
  // Copy bundle and assets if they exist
  const srcAssets = path.join(ANDROID_DIR, 'app', 'src', 'main', 'assets');
  if (fs.existsSync(srcAssets) && fs.lstatSync(srcAssets).isDirectory()) {
    try {
      fs.cpSync(srcAssets, path.join(TEMP_ASSETS, 'assets'), { recursive: true });
    } catch (err) {
      log.warn(`Warning backing up assets: ${err.message}`);
    }
  }
  
  const srcRes = path.join(ANDROID_DIR, 'app', 'src', 'main', 'res');
  if (fs.existsSync(srcRes) && fs.lstatSync(srcRes).isDirectory()) {
    try {
      fs.cpSync(srcRes, path.join(TEMP_ASSETS, 'res'), { recursive: true });
    } catch (err) {
      log.warn(`Warning backing up res: ${err.message}`);
    }
  }
  
  log.info("Cleaning up incomplete android directory to prevent Expo prompt...");
  fs.rmSync(ANDROID_DIR, { recursive: true, force: true });
  
  log.process("Running prebuild to generate clean native project...");
  runCommand('npx expo prebuild --platform android', { env: prebuildEnv });
  
  log.info("Restoring bundle and assets into the complete native project...");
  const destAssets = path.join(ANDROID_DIR, 'app', 'src', 'main', 'assets');
  const destRes = path.join(ANDROID_DIR, 'app', 'src', 'main', 'res');
  
  fs.mkdirSync(destAssets, { recursive: true });
  fs.mkdirSync(destRes, { recursive: true });
  
  if (fs.existsSync(path.join(TEMP_ASSETS, 'assets')) && fs.readdirSync(path.join(TEMP_ASSETS, 'assets')).length > 0) {
    try {
      fs.cpSync(path.join(TEMP_ASSETS, 'assets'), destAssets, { recursive: true });
    } catch (err) {
      log.warn(`Warning restoring assets: ${err.message}`);
    }
  }
  
  if (fs.existsSync(path.join(TEMP_ASSETS, 'res')) && fs.readdirSync(path.join(TEMP_ASSETS, 'res')).length > 0) {
    try {
      fs.cpSync(path.join(TEMP_ASSETS, 'res'), destRes, { recursive: true });
    } catch (err) {
      log.warn(`Warning restoring res: ${err.message}`);
    }
  }
  
  log.info("Cleaning up temp backup files...");
  fs.rmSync(TEMP_ASSETS, { recursive: true, force: true });
  log.success("Prebuild completed and all assets successfully merged!");

} else if (androidExists && gradleExists) {
  // Scenario 2: The android folder is already fully scaffolded and complete
  log.success("Complete Android project detected.");
  log.process("Running incremental prebuild without clearing anything...");
  runCommand('npx expo prebuild --platform android', { env: prebuildEnv });

} else {
  // Scenario 3: The android folder does not exist at all
  log.info("Android project does not exist.");
  log.process("Running prebuild to create native project...");
  runCommand('npx expo prebuild --platform android', { env: prebuildEnv });
}
