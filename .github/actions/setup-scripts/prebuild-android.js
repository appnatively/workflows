const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Define directories
const ANDROID_DIR = 'android';
const BUILD_GRADLE = path.join(ANDROID_DIR, 'app', 'build.gradle');
const TEMP_ASSETS = `temp-assets-${process.pid}`;

// Ensure dummy google-services.json exists for Expo prebuild
if (!fs.existsSync('google-services.json')) {
  console.log("🔥 Creating dummy google-services.json for Expo prebuild...");
  const dummyGoogleServices = {
    project_info: {
      project_number: "1",
      project_id: "d"
    },
    client: [
      {
        client_info: {
          mobilesdk_app_id: "1:1:android:1",
          android_client_info: {
            package_name: "com.d"
          }
        }
      }
    ],
    configuration_version: "1"
  };
  fs.writeFileSync('google-services.json', JSON.stringify(dummyGoogleServices, null, 2), 'utf8');
}

const androidExists = fs.existsSync(ANDROID_DIR) && fs.lstatSync(ANDROID_DIR).isDirectory();
const gradleExists = fs.existsSync(BUILD_GRADLE) && fs.lstatSync(BUILD_GRADLE).isFile();

// Check if the android folder exists and is complete
if (androidExists && !gradleExists) {
  // Scenario 1: The android folder exists but is incomplete (created only by bundle:android)
  console.log("⚠️ Incomplete Android project detected (contains assets but no Gradle files).");
  console.log("📦 Backing up bundle and assets...");
  
  // Create temp backup directories
  fs.mkdirSync(path.join(TEMP_ASSETS, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(TEMP_ASSETS, 'res'), { recursive: true });
  
  // Copy bundle and assets if they exist
  const srcAssets = path.join(ANDROID_DIR, 'app', 'src', 'main', 'assets');
  if (fs.existsSync(srcAssets) && fs.lstatSync(srcAssets).isDirectory()) {
    try {
      fs.cpSync(srcAssets, path.join(TEMP_ASSETS, 'assets'), { recursive: true });
    } catch (err) {
      console.warn("⚠️ Warning backing up assets:", err.message);
    }
  }
  
  const srcRes = path.join(ANDROID_DIR, 'app', 'src', 'main', 'res');
  if (fs.existsSync(srcRes) && fs.lstatSync(srcRes).isDirectory()) {
    try {
      fs.cpSync(srcRes, path.join(TEMP_ASSETS, 'res'), { recursive: true });
    } catch (err) {
      console.warn("⚠️ Warning backing up res:", err.message);
    }
  }
  
  console.log("🧹 Removing incomplete android directory to prevent Expo prompt...");
  fs.rmSync(ANDROID_DIR, { recursive: true, force: true });
  
  console.log("🏗️ Running prebuild to generate clean native project...");
  execSync('npx expo prebuild --platform android', { stdio: 'inherit' });
  
  console.log("🔄 Restoring bundle and assets into the complete native project...");
  const destAssets = path.join(ANDROID_DIR, 'app', 'src', 'main', 'assets');
  const destRes = path.join(ANDROID_DIR, 'app', 'src', 'main', 'res');
  
  fs.mkdirSync(destAssets, { recursive: true });
  fs.mkdirSync(destRes, { recursive: true });
  
  if (fs.existsSync(path.join(TEMP_ASSETS, 'assets')) && fs.readdirSync(path.join(TEMP_ASSETS, 'assets')).length > 0) {
    try {
      fs.cpSync(path.join(TEMP_ASSETS, 'assets'), destAssets, { recursive: true });
    } catch (err) {
      console.warn("⚠️ Warning restoring assets:", err.message);
    }
  }
  
  if (fs.existsSync(path.join(TEMP_ASSETS, 'res')) && fs.readdirSync(path.join(TEMP_ASSETS, 'res')).length > 0) {
    try {
      fs.cpSync(path.join(TEMP_ASSETS, 'res'), destRes, { recursive: true });
    } catch (err) {
      console.warn("⚠️ Warning restoring res:", err.message);
    }
  }
  
  console.log("🧹 Cleaning up temp backup files...");
  fs.rmSync(TEMP_ASSETS, { recursive: true, force: true });
  console.log("✅ Prebuild completed and all assets successfully merged!");

} else if (androidExists && gradleExists) {
  // Scenario 2: The android folder is already fully scaffolded and complete
  console.log("✅ Complete Android project detected.");
  console.log("🏗️ Running incremental prebuild without clearing anything...");
  execSync('npx expo prebuild --platform android', { stdio: 'inherit' });

} else {
  // Scenario 3: The android folder does not exist at all
  console.log("🆕 Android project does not exist.");
  console.log("🏗️ Running prebuild to create native project...");
  execSync('npx expo prebuild --platform android', { stdio: 'inherit' });
}
