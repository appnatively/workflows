const fs = require('fs');
const path = require('path');
const { loadAppConfig, downloadFile, log, fail } = require('./utils');

log.info("Downloading app assets from Google Drive...");

// Ensure required environment variables
if (!process.env.BUILD_ID) {
  fail("BUILD_ID not found in environment.");
}

// Locate app_config.json
const { config } = loadAppConfig();

const accessToken = config.google_drive_access_token;
if (!accessToken) {
  fail("google_drive_access_token not found in configuration.");
}

// Download Helper
async function downloadAsset(key, dest) {
  const fileId = config[key];
  if (!fileId || fileId === 'null') {
    log.warn(`${key} not found or invalid in configuration.`);
    return false;
  }

  log.info(`Downloading ${key} (${fileId}) to ${dest}...`);
  try {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    await downloadFile(url, dest, `Bearer ${accessToken}`, true);
    log.success(`Successfully downloaded ${key}`);
    return true;
  } catch (err) {
    log.warn(`Error downloading ${key} (ID: ${fileId}): ${err.message}`);
    return false;
  }
}

async function run() {
  // 1. Download App Icon
  const iconSuccess = await downloadAsset("asset_icon_id", "assets/images/icon.png");
  if (!iconSuccess) {
    fail("Failed to download App Icon (asset_icon_id). Stopping workflow.");
  }

  // 2. Download Splash Icon (with fallback to App Icon if missing or failed)
  const splashSuccess = await downloadAsset("asset_splash_id", "assets/images/splash-icon.png");
  if (!splashSuccess) {
    if (fs.existsSync("assets/images/icon.png")) {
      log.info("Falling back to assets/images/icon.png for splash-icon.png...");
      fs.copyFileSync("assets/images/icon.png", "assets/images/splash-icon.png");
      log.success("Successfully copied icon.png to splash-icon.png as fallback.");
    } else {
      log.warn("Fallback icon (assets/images/icon.png) not found. Splash icon will be missing.");
    }
  }

  // 3. Download Android Adaptive Icons (Optional)
  await downloadAsset("asset_adaptive_foreground_id", "assets/images/android-icon-foreground.png");
  await downloadAsset("asset_adaptive_background_id", "assets/images/android-icon-background.png");
  await downloadAsset("asset_adaptive_monochrome_id", "assets/images/android-icon-monochrome.png");

  // 4. Inject Android Adaptive Icon config to app.config.ts if all files exist
  const foregroundExists = fs.existsSync("assets/images/android-icon-foreground.png");
  const backgroundExists = fs.existsSync("assets/images/android-icon-background.png");
  const monochromeExists = fs.existsSync("assets/images/android-icon-monochrome.png");

  if (foregroundExists && backgroundExists && monochromeExists) {
    log.success("All adaptive icon assets exist. Injecting adaptive icon config into app.config.ts...");
    
    let adaptiveBgColor = config.adaptive_icon_background_color || "#E6F4FE";

    const appConfigPath = path.resolve('app.config.ts');
    if (fs.existsSync(appConfigPath)) {
      let content = fs.readFileSync(appConfigPath, 'utf8');
      const replacement = `finalConfig.android = {
    ...finalConfig.android,
    adaptiveIcon: {
      backgroundColor: "${adaptiveBgColor}",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png"
    }
  };

  return {
    ...finalConfig,
    plugins
  };`;
      const regex = /return\s*\{\s*\.\.\.finalConfig,\s*plugins\s*\};/;
      if (regex.test(content) && !content.includes('adaptiveIcon')) {
        content = content.replace(regex, replacement);
        fs.writeFileSync(appConfigPath, content, 'utf8');
        log.success('Successfully injected adaptiveIcon config into app.config.ts');
      } else {
        log.warn('Could not inject adaptiveIcon config (target not found or already injected)');
      }
    }
  } else {
    log.info("Adaptive icon assets are not fully present. Skipping injection.");
  }

  log.success("Asset setup completed.");
}

run().catch((err) => {
  fail(`Asset setup failed: ${err.message}`);
});
