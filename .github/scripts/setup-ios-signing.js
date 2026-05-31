const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
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
  log.warn("⚠️ iOS custom signing credentials are NOT configured for this app. Skipping code signing setup.");
  process.exit(0);
}

// Helper to make authorized GET requests
async function makeGetRequest(urlPath, isBinary = false) {
  const url = `${apiUrl}${urlPath}`;
  try {
    return await request(url, {
      isBinary,
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (err) {
    throw new Error(`Failed to request ${urlPath}: ${err.message}`);
  }
}

async function run() {
  try {
    log.info("📲 Fetching secure iOS credentials metadata...");
    const credsJsonString = await makeGetRequest(`/builds/${buildId}/credentials?fileType=ios_credentials`, false);
    const iosCreds = JSON.parse(credsJsonString);

    const distributionType = iosCreds.distributionType || 'app-store';
    const certificatePassword = iosCreds.certificatePassword || '';

    log.info("📲 Downloading iOS Signing Certificate (.p12)...");
    const certPath = path.join(process.cwd(), 'ios_certificate.p12');
    await downloadFile(`${apiUrl}/builds/${buildId}/credentials?fileType=ios_certificate`, certPath, `Bearer ${token}`, true);
    log.success("Certificate successfully downloaded.");

    log.info("📲 Downloading iOS Provisioning Profile (.mobileprovision)...");
    const profilePath = path.join(process.cwd(), 'profile.mobileprovision');
    await downloadFile(`${apiUrl}/builds/${buildId}/credentials?fileType=ios_provisioning_profile`, profilePath, `Bearer ${token}`, true);
    log.success("Provisioning profile successfully downloaded.");

    // Setup temporary keychain on macOS with an absolute path
    const keychainPath = path.join(process.cwd(), "app-signing.keychain-db");
    const keychainPass = "build-pass-" + Math.random().toString(36).substring(2);

    log.info("Creating temporary keychain...");
    // Pre-emptively clean up any existing keychain at the target path
    try {
      execSync(`security delete-keychain "${keychainPath}"`, { stdio: 'ignore' });
    } catch (_) {}

    execSync(`security create-keychain -p "${keychainPass}" "${keychainPath}"`, { stdio: 'inherit' });
    
    log.info("Merging keychain with current user search list...");
    const existingKeychains = execSync('security list-keychains -d user')
      .toString()
      .split('\n')
      .map(line => line.trim().replace(/^"/, '').replace(/"$/, ''))
      .filter(Boolean);

    const newSearchList = [keychainPath, ...existingKeychains];
    const listArgs = newSearchList.map(k => `"${k}"`).join(' ');
    execSync(`security list-keychains -d user -s ${listArgs}`, { stdio: 'inherit' });

    execSync(`security unlock-keychain -p "${keychainPass}" "${keychainPath}"`, { stdio: 'inherit' });
    execSync(`security set-keychain-settings -lut 21600 "${keychainPath}"`, { stdio: 'inherit' });

    log.info("Importing P12 certificate into keychain...");
    // Import using execSync but catch error securely to avoid password leaks
    try {
      execSync(`security import "${certPath}" -k "${keychainPath}" -P "${certificatePassword}" -A -T /usr/bin/codesign`, { stdio: 'ignore' });
    } catch (err) {
      fail("Failed to import the P12 certificate. Please verify that the password is correct.");
    }
    
    log.info("Updating keychain partition list for codesign...");
    execSync(`security set-key-partition-list -S apple-tool:,apple: -s -k "${keychainPass}" "${keychainPath}"`, { stdio: 'inherit' });
    log.success("Keychain setup and P12 import completed successfully!");

    // Parse provisioning profile using macOS native security utility
    log.info("Parsing provisioning profile...");
    const plistXml = execSync(`security cms -D -i "${profilePath}"`).toString();
    
    const uuidMatch = plistXml.match(/<key>UUID<\/key>\s*<string>([^<]+)<\/string>/);
    if (!uuidMatch) {
      fail("Failed to extract UUID from the provisioning profile.");
    }
    const uuid = uuidMatch[1];

    const teamMatch = plistXml.match(/<key>TeamIdentifier<\/key>\s*<array>\s*<string>([^<]+)<\/string>/);
    if (!teamMatch) {
      fail("Failed to extract Team ID from the provisioning profile.");
    }
    const teamId = teamMatch[1];

    const bundleIdMatch = plistXml.match(/<key>application-identifier<\/key>\s*<string>[^.]+\.([^<]+)<\/string>/);
    if (!bundleIdMatch) {
      fail("Failed to extract Bundle ID from the provisioning profile.");
    }
    const bundleId = bundleIdMatch[1];

    log.success(`Profile parsed: UUID=${uuid}, TeamId=${teamId}, BundleId=${bundleId}`);

    // Install provisioning profile to standard location
    const targetDir = path.join(process.env.HOME, 'Library/MobileDevice/Provisioning Profiles');
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, `${uuid}.mobileprovision`);
    fs.copyFileSync(profilePath, targetPath);
    log.success("Provisioning profile successfully installed.");

    // Query imported certificate to get the exact Code Sign Identity string
    log.info("Resolving exact Code Sign Identity...");
    const findIdentityOutput = execSync(`security find-identity -v -p codesigning "${keychainPath}"`).toString();
    const identityMatch = findIdentityOutput.match(/"([^"]+)"/);
    const codeSignIdentity = identityMatch ? identityMatch[1] : 'iPhone Distribution';
    log.success(`Resolved Code Sign Identity: "${codeSignIdentity}"`);

    // Clean up temporary downloaded files for security
    fs.unlinkSync(certPath);
    fs.unlinkSync(profilePath);

    // Export variables to GitHub Actions environment
    if (process.env.GITHUB_ENV) {
      fs.appendFileSync(process.env.GITHUB_ENV, `IOS_PROVISIONING_PROFILE_UUID=${uuid}\n`);
      fs.appendFileSync(process.env.GITHUB_ENV, `IOS_TEAM_ID=${teamId}\n`);
      fs.appendFileSync(process.env.GITHUB_ENV, `IOS_BUNDLE_ID=${bundleId}\n`);
      fs.appendFileSync(process.env.GITHUB_ENV, `IOS_CODE_SIGN_IDENTITY=${codeSignIdentity}\n`);
      fs.appendFileSync(process.env.GITHUB_ENV, `IOS_DISTRIBUTION_METHOD=${distributionType}\n`);
      fs.appendFileSync(process.env.GITHUB_ENV, `IOS_KEYCHAIN_PATH=${keychainPath}\n`);
      log.success("Signing environment variables successfully exported to GITHUB_ENV.");
    }

  } catch (error) {
    fail(`iOS signing setup failed: ${error.message}`);
  }
}

run();
