const fs = require('fs');
const path = require('path');
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

log.firebase(`Setting up Firebase configuration in ${process.cwd()}...`);

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
    log.info(`No ${fileType} configuration found or configured (Error: ${err.message}).`);
  }
  return false;
}

async function run() {
  // 1. Download Android Firebase configuration (google-services.json)
  const androidDownloaded = await downloadCredential('firebase_android', 'google-services.json');
  if (androidDownloaded) {
    // Copy to native paths if they exist
    if (fs.existsSync('android/app') && fs.lstatSync('android/app').isDirectory()) {
      fs.copyFileSync('google-services.json', 'android/app/google-services.json');
      log.success('Copied google-services.json to android/app/');
    } else if (path.basename(process.cwd()) === 'android' && fs.existsSync('app') && fs.lstatSync('app').isDirectory()) {
      fs.copyFileSync('google-services.json', 'app/google-services.json');
      log.success('Copied google-services.json to app/');
    }
  }

  // 2. Download iOS Firebase configuration (GoogleService-Info.plist)
  const iosDownloaded = await downloadCredential('firebase_ios', 'GoogleService-Info.plist');
  if (iosDownloaded) {
    // Copy to native paths if they exist
    if (fs.existsSync('ios/app') && fs.lstatSync('ios/app').isDirectory()) {
      fs.copyFileSync('GoogleService-Info.plist', 'ios/app/GoogleService-Info.plist');
      log.success('Copied GoogleService-Info.plist to ios/app/');
    } else if (path.basename(process.cwd()) === 'ios' && fs.existsSync('app') && fs.lstatSync('app').isDirectory()) {
      fs.copyFileSync('GoogleService-Info.plist', 'app/GoogleService-Info.plist');
      log.success('Copied GoogleService-Info.plist to app/');
    }
  }

  log.firebase("Firebase configuration complete.");
}

run().catch((err) => {
  fail(`Firebase setup failed: ${err.message}`);
});
