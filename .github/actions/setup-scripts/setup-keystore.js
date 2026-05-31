const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const apiUrl = process.env.API_URL;
const buildId = process.env.BUILD_ID;
const token = process.env.BUILD_ACCESS_TOKEN;

if (!buildId) {
  console.error("❌ BUILD_ID not found in environment.");
  process.exit(1);
}

if (!apiUrl || !token) {
  console.error("❌ API_URL or BUILD_ACCESS_TOKEN not found in environment.");
  process.exit(1);
}

const gradlePath = 'android/app/build.gradle';
const keystoreDest = 'android/app/release.jks';

console.log(`🔑 Configuring Keystore & Signing in ${process.cwd()}...`);

// 1. Idempotency Check
if (!fs.existsSync(gradlePath)) {
  console.error(`❌ Gradle file not found at ${gradlePath}. Ensure you are in the Expo/Android workspace directory.`);
  process.exit(1);
}

let gradleContent = fs.readFileSync(gradlePath, 'utf8');
if (gradleContent.includes("signingConfigs.release")) {
  console.log("✅ Signing configurations already applied to build.gradle. Skipping setup.");
  process.exit(0);
}

// Helper to make authorized GET requests
function makeGetRequest(urlPath, isBinary = false) {
  const url = `${apiUrl}${urlPath}`;
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    client.get(url, options, (response) => {
      // Handle redirects
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        const redirectUrl = response.headers.location;
        const redirectClient = redirectUrl.startsWith('https:') ? https : http;
        redirectClient.get(redirectUrl, options, (res) => {
          handleResponse(res);
        }).on('error', reject);
        return;
      }

      handleResponse(response);

      function handleResponse(res) {
        if (res.statusCode !== 200) {
          reject(new Error(`Server returned HTTP status ${res.statusCode}`));
          return;
        }

        if (isBinary) {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        } else {
          let body = '';
          res.on('data', (chunk) => body += chunk);
          res.on('end', () => resolve(body));
        }
      }
    }).on('error', reject);
  });
}

async function run() {
  try {
    // 2. Fetch binary keystore file
    console.log("📥 Downloading Keystore binary from Credentials API...");
    const keystoreBuffer = await makeGetRequest(`/builds/${buildId}/credentials?fileType=android_keystore`, true);
    
    fs.mkdirSync(path.dirname(keystoreDest), { recursive: true });
    fs.writeFileSync(keystoreDest, keystoreBuffer);
    console.log("✅ Keystore binary successfully written to android/app/release.jks");

    // 3. Fetch keystore credentials
    console.log("📡 Downloading keystore secrets from Keystore API...");
    const credsJsonString = await makeGetRequest(`/builds/${buildId}/keystore`, false);
    const keystoreCreds = JSON.parse(credsJsonString);

    if (!keystoreCreds.storePassword || !keystoreCreds.keyAlias || !keystoreCreds.keyPassword) {
      throw new Error("Invalid or incomplete keystore credentials returned from API.");
    }
    console.log("✅ Keystore secrets successfully retrieved and decrypted.");

    // 4. Inject signing configs in build.gradle
    console.log("💉 Injecting signing configurations into build.gradle...");
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
    console.log("🎉 Successfully configured Android signing in build.gradle.");
  } catch (error) {
    console.error("❌ Keystore configuration failed:", error.message);
    process.exit(1);
  }
}

run();
