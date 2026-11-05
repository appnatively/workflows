const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadAppConfig, request, log, fail } = require('./utils');

log.info("Downloading app assets...");

// Ensure required environment variables
if (!process.env.BUILD_ID) {
  fail("BUILD_ID not found in environment.");
}

// Locate app_config.json
const { config } = loadAppConfig();

// Assets are dispatched by the backend as absolute download URLs under `asset_*_url`
// keys (see GithubController.getConfig). The `/studio/app/{id}/files/{id}` route is
// public (no auth), resolves R2-or-Drive per file record, and returns the raw stored
// bytes — WebP in the common case, occasionally already PNG. No Google Drive token or
// provider branching is needed here anymore.

/**
 * Converts an image to PNG, trying the converters preinstalled on GitHub-hosted
 * ubuntu/macOS runners in turn (ImageMagick v7 `magick`, v6 `convert`, libwebp `dwebp`).
 * Returns true on the first one that produces a non-empty file.
 */
function convertToPng(src, dest) {
  const candidates = [
    { bin: 'magick', cmd: (s, d) => `magick "${s}" "${d}"` },
    { bin: 'convert', cmd: (s, d) => `convert "${s}" "${d}"` },
    { bin: 'dwebp', cmd: (s, d) => `dwebp "${s}" -o "${d}"` },
  ];
  for (const c of candidates) {
    try {
      execSync(c.cmd(src, dest), { stdio: 'inherit' });
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
        return true;
      }
    } catch (_) {
      // Converter missing or failed — try the next one.
    }
  }
  return false;
}

function isPng(buf) {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  );
}

// Download Helper
async function downloadAsset(key, dest) {
  const url = config[key];
  if (!url || url === 'null') {
    log.warn(`${key} not found or invalid in configuration.`);
    return false;
  }

  log.info(`Downloading ${key} (${url}) to ${dest}...`);
  try {
    const buffer = await request(url, { isBinary: true });
    if (!buffer || buffer.length === 0) {
      log.warn(`${key} download returned an empty body.`);
      return false;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });

    // Native builds need PNG. Skip conversion when the backend already stored a PNG.
    if (isPng(buffer)) {
      fs.writeFileSync(dest, buffer);
      log.success(`Successfully downloaded ${key} (already PNG)`);
      return true;
    }

    const tmp = `${dest}.download`;
    fs.writeFileSync(tmp, buffer);
    try {
      if (!convertToPng(tmp, dest)) {
        log.warn(`Failed to convert ${key} to PNG (no working converter on runner).`);
        return false;
      }
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }

    log.success(`Successfully downloaded and converted ${key}`);
    return true;
  } catch (err) {
    log.warn(`Error downloading ${key} (${url}): ${err.message}`);
    return false;
  }
}

async function run() {
  // 0. Fetch and minify default-app-config.json from AppNatively API
  const apiUrl = config.expo_public_api_url;
  const appId = config.expo_public_app_id;
  const schemaVersion = config.expo_public_schema_version || '1';
  // Tells the server this build's JS can run a Custom API connector (it refuses `custom` otherwise).
  const connectorLevel = config.expo_public_connector_level || '0';
  if (apiUrl && appId) {
    const layoutUrl = new URL(`${apiUrl.replace(/\/$/, '')}/${appId}/config`);
    layoutUrl.searchParams.set('schemaVersion', schemaVersion);
    layoutUrl.searchParams.set('connector', connectorLevel);
    layoutUrl.searchParams.set('connectorProtocol', 'appnatively.rest.direct');
    const configUrl = layoutUrl.href;
    log.info(`Fetching default app layout configuration from ${configUrl}...`);
    try {
      const layoutData = await request(configUrl);
      const parsedLayout = JSON.parse(layoutData);
      const destPath = 'src/assets/default-app-config.json';
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, JSON.stringify(parsedLayout), 'utf8');
      log.success("Successfully downloaded and minified default-app-config.json to src/assets/");
    } catch (err) {
      fail(`Failed to fetch default-app-config.json: ${err.message}`);
    }
  } else {
    log.warn("expo_public_api_url or expo_public_app_id missing in config. Skipping fetching default-app-config.json");
  }

  // 1. Download App Icon
  const iconSuccess = await downloadAsset("asset_icon_url", "assets/images/icon.png");
  if (!iconSuccess) {
    fail("Failed to download App Icon (asset_icon_url). Stopping workflow.");
  }

  // 2. Download Splash Icon (with fallback to App Icon if missing or failed)
  const splashSuccess = await downloadAsset("asset_splash_url", "assets/images/splash-icon.png");
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
  await downloadAsset("asset_adaptive_foreground_url", "assets/images/android-icon-foreground.png");
  await downloadAsset("asset_adaptive_background_url", "assets/images/android-icon-background.png");
  await downloadAsset("asset_adaptive_monochrome_url", "assets/images/android-icon-monochrome.png");

  // 4. Inject Android Adaptive Icon config to app.config.ts if all files exist
  const foregroundExists = fs.existsSync("assets/images/android-icon-foreground.png");
  const backgroundExists = fs.existsSync("assets/images/android-icon-background.png");
  const monochromeExists = fs.existsSync("assets/images/android-icon-monochrome.png");

  if (foregroundExists && backgroundExists && monochromeExists) {
    log.success("All adaptive icon assets exist. Injecting adaptive icon config into app.config.ts...");

    // android.adaptiveIcon.backgroundColor only accepts a plain 6-digit hex string (Expo core
    // config, not a plugin) — no rgba()/hsla()/named colors, no alpha. Studio's color picker
    // disables alpha for this field, but this guard also protects against any already-saved
    // non-hex value (e.g. from before that fix shipped) breaking aapt resource compilation.
    const HEX_COLOR_ONLY_RE = /^#[0-9a-fA-F]{6}$/;
    const rawAdaptiveBgColor = config.adaptive_icon_background_color;
    let adaptiveBgColor = HEX_COLOR_ONLY_RE.test(rawAdaptiveBgColor) ? rawAdaptiveBgColor : "#E6F4FE";
    if (rawAdaptiveBgColor && adaptiveBgColor !== rawAdaptiveBgColor) {
      log.warn(`adaptive_icon_background_color ("${rawAdaptiveBgColor}") is not a valid 6-digit hex color. Falling back to ${adaptiveBgColor}.`);
    }

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
