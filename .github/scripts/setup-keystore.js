const fs = require('fs');
const path = require('path');
const { request, log, fail } = require('./utils');

const apiUrl = process.env.API_URL;
const buildId = process.env.BUILD_ID;
const token = process.env.BUILD_ACCESS_TOKEN;

if (!buildId) {
  fail("BUILD_ID not found in environment.");
}

if (!apiUrl || !token) {
  fail("API_URL or BUILD_ACCESS_TOKEN not found in environment.");
}

const gradlePath = 'android/app/build.gradle';
const keystoreDest = 'android/app/release.jks';

log.keystore(`Configuring Keystore & Signing in ${process.cwd()}...`);

// 1. Idempotency Check
if (!fs.existsSync(gradlePath)) {
  fail(`Gradle file not found at ${gradlePath}. Ensure you are in the Expo/Android workspace directory.`);
}

let gradleContent = fs.readFileSync(gradlePath, 'utf8');
if (gradleContent.includes("signingConfigs.release")) {
  log.success("Signing configurations already applied to build.gradle. Skipping setup.");
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
    // 2. Fetch binary keystore file
    log.info("Downloading Keystore binary from Credentials API...");
    const keystoreBuffer = await makeGetRequest(`/builds/${buildId}/credentials?fileType=android_keystore`, true);
    
    fs.mkdirSync(path.dirname(keystoreDest), { recursive: true });
    fs.writeFileSync(keystoreDest, keystoreBuffer);
    log.success("Keystore binary successfully written to android/app/release.jks");

    // 3. Fetch keystore credentials
    log.info("Downloading keystore secrets from Credentials API...");
    const credsJsonString = await makeGetRequest(`/builds/${buildId}/credentials?fileType=android_credentials`, false);
    const keystoreCreds = JSON.parse(credsJsonString);

    if (!keystoreCreds.storePassword || !keystoreCreds.keyAlias || !keystoreCreds.keyPassword) {
      throw new Error("Invalid or incomplete keystore credentials returned from API.");
    }
    log.success("Keystore secrets successfully retrieved and decrypted.");

    // 4. Inject signing configs in build.gradle
    log.info("Injecting signing configurations into build.gradle...");
    const signingConfigsRegex = /signingConfigs\s*\{([\s\S]*?debug\s*\{[\s\S]*?\}\s*)\}/;
    if (!signingConfigsRegex.test(gradleContent)) {
      throw new Error("Could not locate signingConfigs.debug block in build.gradle");
    }

    gradleContent = gradleContent.replace(signingConfigsRegex, (match, debugBlock) => {
      return `signingConfigs {${debugBlock}    release {
                storeFile file("release.jks")
                storePassword "${keystoreCreds.storePassword}"
                keyAlias "${keystoreCreds.keyAlias}"
                keyPassword "${keystoreCreds.keyPassword}"
            }
        }`;
    });

    // 5. Update release signingConfig
    const releaseSigningConfigRegex = /buildTypes\s*\{([\s\S]*?release\s*\{([\s\S]*?))signingConfig\s+signingConfigs\.debug/;
    if (!releaseSigningConfigRegex.test(gradleContent)) {
      throw new Error("Could not locate release signingConfig under buildTypes in build.gradle");
    }

    gradleContent = gradleContent.replace(releaseSigningConfigRegex, (match, before) => {
      return `buildTypes {${before}signingConfig signingConfigs.release`;
    });

    fs.writeFileSync(gradlePath, gradleContent, 'utf8');
    log.success("Successfully configured Android signing in build.gradle.");
  } catch (error) {
    fail(`Keystore configuration failed: ${error.message}`);
  }
}

run();
