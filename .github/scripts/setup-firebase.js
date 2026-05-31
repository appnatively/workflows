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

console.log(`🔥 Setting up Firebase configuration in ${process.cwd()}...`);

function downloadCredential(fileType, dest) {
  const url = `${apiUrl}/builds/${buildId}/credentials?fileType=${fileType}`;
  console.log(`📡 Fetching ${fileType} configuration...`);

  return new Promise((resolve) => {
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
        }).on('error', handleError);
        return;
      }

      handleResponse(response);

      function handleResponse(res) {
        if (res.statusCode === 200) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          const fileStream = fs.createWriteStream(dest);
          res.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            console.log(`✅ Successfully downloaded ${fileType} to ${dest}`);
            resolve(true);
          });
        } else {
          console.log(`ℹ️ No ${fileType} configuration found or configured (Status: ${res.statusCode}).`);
          resolve(false);
        }
      }

      function handleError(err) {
        console.warn(`⚠️ Error downloading ${fileType}:`, err.message);
        resolve(false);
      }
    }).on('error', (err) => {
      console.warn(`⚠️ Error connecting to server for ${fileType}:`, err.message);
      resolve(false);
    });
  });
}

async function run() {
  // 1. Download Android Firebase configuration (google-services.json)
  const androidDownloaded = await downloadCredential('firebase_android', 'google-services.json');
  if (androidDownloaded) {
    // Copy to native paths if they exist
    if (fs.existsSync('android/app') && fs.lstatSync('android/app').isDirectory()) {
      fs.copyFileSync('google-services.json', 'android/app/google-services.json');
      console.log('✅ Copied google-services.json to android/app/');
    } else if (path.basename(process.cwd()) === 'android' && fs.existsSync('app') && fs.lstatSync('app').isDirectory()) {
      fs.copyFileSync('google-services.json', 'app/google-services.json');
      console.log('✅ Copied google-services.json to app/');
    }
  }

  // 2. Download iOS Firebase configuration (GoogleService-Info.plist)
  const iosDownloaded = await downloadCredential('firebase_ios', 'GoogleService-Info.plist');
  if (iosDownloaded) {
    // Copy to native paths if they exist
    if (fs.existsSync('ios/app') && fs.lstatSync('ios/app').isDirectory()) {
      fs.copyFileSync('GoogleService-Info.plist', 'ios/app/GoogleService-Info.plist');
      console.log('✅ Copied GoogleService-Info.plist to ios/app/');
    } else if (path.basename(process.cwd()) === 'ios' && fs.existsSync('app') && fs.lstatSync('app').isDirectory()) {
      fs.copyFileSync('GoogleService-Info.plist', 'app/GoogleService-Info.plist');
      console.log('✅ Copied GoogleService-Info.plist to app/');
    }
  }

  console.log("🎉 Firebase configuration complete.");
}

run().catch((err) => {
  console.error("❌ Firebase setup failed:", err);
  process.exit(1);
});
