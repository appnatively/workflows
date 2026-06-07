const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadAppConfig, downloadFile, log, fail } = require('./utils');

const apiUrl = process.env.API_URL;
const buildId = process.env.BUILD_ID;
const token = process.env.BUILD_ACCESS_TOKEN;

if (!buildId) {
  fail("BUILD_ID not found in environment.");
}

if (!apiUrl || !token) {
  fail("API_URL or BUILD_ACCESS_TOKEN not found in environment.");
}

// Read app_config.json robustly using utils helper
const { config } = loadAppConfig();

async function run() {
  const isConfigured = config.android_store_key_configured === true;
  const deployAction = config.deploy_action || 'build-only';

  if (!isConfigured || deployAction !== 'build-deploy') {
    log.info(`ℹ️ Google Play Console submission is not triggered (configured: ${isConfigured}, deployAction: ${deployAction}). Skipping setup.`);
    return;
  }

  const tempDir = process.env.RUNNER_TEMP || os.tmpdir();
  const playStoreKeyPath = path.join(tempDir, 'play_config.json');

  function cleanupFiles() {
    try {
      if (fs.existsSync(playStoreKeyPath)) fs.unlinkSync(playStoreKeyPath);
    } catch (_) {}
  }

  try {
    log.info("📲 Downloading Google Play Store Service Account Key (.json)...");
    await downloadFile(`${apiUrl}/builds/${buildId}/credentials?fileType=android_store_key`, playStoreKeyPath, `Bearer ${token}`, true);
    log.success("Google Play Store Service Account Key successfully downloaded.");

    if (!fs.existsSync(playStoreKeyPath) || fs.statSync(playStoreKeyPath).size === 0) {
      fail("❌ Google Play Store Service Account Key is missing or empty after download.");
    }

    const packageName = config.package_id || '';
    const androidTrack = config.android_track || 'internal-test';
    const track = androidTrack === 'internal-test' ? 'internal' :
                  androidTrack === 'closed-testing' ? 'beta' :
                  androidTrack;
    const changelog = config.changelog || '';

    // Export variables to GitHub Actions environment
    if (process.env.GITHUB_ENV) {
      fs.appendFileSync(process.env.GITHUB_ENV, `ANDROID_PUBLISH_JSON_PATH=${playStoreKeyPath}\n`);
      fs.appendFileSync(process.env.GITHUB_ENV, `ANDROID_PACKAGE_NAME=${packageName}\n`);
      fs.appendFileSync(process.env.GITHUB_ENV, `ANDROID_TRACK=${track}\n`);
      if (changelog) {
        fs.appendFileSync(process.env.GITHUB_ENV, `APP_BUILD_CHANGELOG<<EOF\n${changelog}\nEOF\n`);
      }
      log.success(`Google Play Console configuration paths (Track: ${track}) successfully exported to GITHUB_ENV.`);
    }

  } catch (error) {
    cleanupFiles();
    fail(`Google Play Console setup failed: ${error.message}`);
  }
}

run();
