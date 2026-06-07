const { downloadFile, log, fail } = require('./utils');

const apiUrl = process.env.API_URL;
const buildId = process.env.BUILD_ID;
const token = process.env.BUILD_ACCESS_TOKEN;

if (!buildId) {
  fail("BUILD_ID not found in environment.");
}

if (!apiUrl || !token) {
  fail("API_URL or BUILD_ACCESS_TOKEN not found in environment.");
}

const platformType = process.argv[2]; // 'android' or 'ios'

log.firebase(`Setting up Firebase configuration in ${process.cwd()} for platform: ${platformType || 'both'}...`);

async function downloadCredential(fileType, dest) {
  const url = `${apiUrl}/builds/${buildId}/credentials?fileType=${fileType}`;
  log.info(`Fetching ${fileType} configuration...`);

  try {
    const success = await downloadFile(url, dest, `Bearer ${token}`, false);
    if (success) {
      log.success(`Successfully downloaded ${fileType} to ${dest}`);
      return true;
    }
  } catch (err) {
    fail(`❌ Failed to download required ${fileType} configuration (Error: ${err.message}).`);
  }
  return false;
}

async function run() {
  if (!platformType || platformType === 'android') {
    // 1. Download Android Firebase configuration (google-services.json)
    await downloadCredential('firebase_android', 'google-services.json');
  }

  if (!platformType || platformType === 'ios') {
    // 2. Download iOS Firebase configuration (GoogleService-Info.plist)
    await downloadCredential('firebase_ios', 'GoogleService-Info.plist');
  }

  log.firebase("Firebase configuration complete.");
}

run().catch((err) => {
  fail(`Firebase setup failed: ${err.message}`);
});
