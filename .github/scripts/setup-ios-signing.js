const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadAppConfig, request, downloadFile, log, fail } = require('./utils');

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

// Check if iOS custom signing config exists
const hasCertificate = config.ios_certificate_file_id && config.ios_certificate_file_id.length > 0;
const hasProvisioningProfile = config.ios_provisioning_profile_file_id && config.ios_provisioning_profile_file_id.length > 0;

if (!hasCertificate || !hasProvisioningProfile) {
  fail("❌ iOS custom signing credentials are required but not configured in app_config.json.");
}

async function run() {
  const tempDir = process.env.RUNNER_TEMP || os.tmpdir();
  const certPath = path.join(tempDir, 'ios_certificate.p12');
  const profilePath = path.join(tempDir, 'profile.mobileprovision');

  function cleanupFiles() {
    try {
      if (fs.existsSync(certPath)) fs.unlinkSync(certPath);
    } catch (_) {}
    try {
      if (fs.existsSync(profilePath)) fs.unlinkSync(profilePath);
    } catch (_) {}
  }

  try {
    log.info("📲 Fetching secure iOS credentials metadata...");
    const credsJsonString = await request(`${apiUrl}/builds/${buildId}/credentials?fileType=ios_credentials`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const iosCreds = JSON.parse(credsJsonString);

    const distributionType = iosCreds.distributionType || 'app-store';
    const certificatePassword = iosCreds.certificatePassword || '';

    if (process.env.GITHUB_ACTIONS && certificatePassword) {
      console.log(`::add-mask::${certificatePassword}`);
    }

    log.info("📲 Downloading iOS Signing Certificate (.p12)...");
    await downloadFile(`${apiUrl}/builds/${buildId}/credentials?fileType=ios_certificate`, certPath, `Bearer ${token}`, true);
    log.success("Certificate successfully downloaded.");

    log.info("📲 Downloading iOS Provisioning Profile (.mobileprovision)...");
    await downloadFile(`${apiUrl}/builds/${buildId}/credentials?fileType=ios_provisioning_profile`, profilePath, `Bearer ${token}`, true);
    log.success("Provisioning profile successfully downloaded.");

    if (!fs.existsSync(certPath) || fs.statSync(certPath).size === 0) {
      fail("❌ iOS signing certificate (.p12) is missing or empty after download.");
    }
    if (!fs.existsSync(profilePath) || fs.statSync(profilePath).size === 0) {
      fail("❌ iOS provisioning profile (.mobileprovision) is missing or empty after download.");
    }

    const bundleId = config.package_id || '';

    // Export variables to GitHub Actions environment
    if (process.env.GITHUB_ENV) {
      fs.appendFileSync(process.env.GITHUB_ENV, `IOS_CERTIFICATE_PATH=${certPath}\n`);
      fs.appendFileSync(process.env.GITHUB_ENV, `IOS_PROVISIONING_PROFILE_PATH=${profilePath}\n`);
      fs.appendFileSync(process.env.GITHUB_ENV, `IOS_CERTIFICATE_PASSWORD=${certificatePassword}\n`);
      fs.appendFileSync(process.env.GITHUB_ENV, `IOS_BUNDLE_ID=${bundleId}\n`);
      fs.appendFileSync(process.env.GITHUB_ENV, `IOS_DISTRIBUTION_METHOD=${distributionType}\n`);
      log.success("Signing paths successfully exported to GITHUB_ENV.");
    }

  } catch (error) {
    cleanupFiles();
    fail(`iOS signing setup failed: ${error.message}`);
  }
}

run();
