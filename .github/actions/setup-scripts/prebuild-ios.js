const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Define directories
const IOS_DIR = 'ios';
const TEMP_ASSETS = `temp-assets-ios-${process.pid}`;

// Ensure dummy GoogleService-Info.plist exists for Expo prebuild
if (!fs.existsSync('GoogleService-Info.plist')) {
  console.log("🔥 Creating dummy GoogleService-Info.plist for Expo prebuild...");
  const dummyPlist = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>GOOGLE_APP_ID</key><string>1:1:ios:1</string></dict></plist>';
  fs.writeFileSync('GoogleService-Info.plist', dummyPlist, 'utf8');
}

// Check if there are any xcodeproj directories in the ios folder
let xcodeProjExists = false;
if (fs.existsSync(IOS_DIR) && fs.lstatSync(IOS_DIR).isDirectory()) {
  try {
    const files = fs.readdirSync(IOS_DIR);
    xcodeProjExists = files.some(file => file.endsWith('.xcodeproj') && fs.lstatSync(path.join(IOS_DIR, file)).isDirectory());
  } catch (err) {
    console.warn("⚠️ Warning checking Xcode project files:", err.message);
  }
}

const iosExists = fs.existsSync(IOS_DIR) && fs.lstatSync(IOS_DIR).isDirectory();

// Check if the ios folder exists and is complete
if (iosExists && !xcodeProjExists) {
  // Scenario 1: The ios folder exists but is incomplete (created only by bundle:ios)
  console.log("⚠️ Incomplete iOS project detected (contains assets but no Xcode project files).");
  console.log("📦 Backing up bundle and assets...");
  
  // Create temp backup directories
  fs.mkdirSync(path.join(TEMP_ASSETS, 'assets'), { recursive: true });
  
  // Copy bundle and assets if they exist
  const srcBundle = path.join(IOS_DIR, 'main.jsbundle');
  if (fs.existsSync(srcBundle) && fs.lstatSync(srcBundle).isFile()) {
    try {
      fs.copyFileSync(srcBundle, path.join(TEMP_ASSETS, 'main.jsbundle'));
    } catch (err) {
      console.warn("⚠️ Warning backing up main.jsbundle:", err.message);
    }
  }
  
  const srcAssets = path.join(IOS_DIR, 'assets');
  if (fs.existsSync(srcAssets) && fs.lstatSync(srcAssets).isDirectory()) {
    try {
      fs.cpSync(srcAssets, path.join(TEMP_ASSETS, 'assets'), { recursive: true });
    } catch (err) {
      console.warn("⚠️ Warning backing up assets:", err.message);
    }
  }
  
  console.log("🧹 Removing incomplete ios directory to prevent Expo prompt...");
  fs.rmSync(IOS_DIR, { recursive: true, force: true });
  
  console.log("🏗️ Running prebuild to generate clean native project...");
  execSync('npx expo prebuild --platform ios', { stdio: 'inherit' });
  
  console.log("🔄 Restoring bundle and assets into the complete native project...");
  fs.mkdirSync(IOS_DIR, { recursive: true });
  
  const tempBundle = path.join(TEMP_ASSETS, 'main.jsbundle');
  if (fs.existsSync(tempBundle) && fs.lstatSync(tempBundle).isFile()) {
    try {
      fs.copyFileSync(tempBundle, path.join(IOS_DIR, 'main.jsbundle'));
    } catch (err) {
      console.warn("⚠️ Warning restoring main.jsbundle:", err.message);
    }
  }
  
  const tempAssets = path.join(TEMP_ASSETS, 'assets');
  if (fs.existsSync(tempAssets) && fs.readdirSync(tempAssets).length > 0) {
    try {
      fs.mkdirSync(path.join(IOS_DIR, 'assets'), { recursive: true });
      fs.cpSync(tempAssets, path.join(IOS_DIR, 'assets'), { recursive: true });
    } catch (err) {
      console.warn("⚠️ Warning restoring assets:", err.message);
    }
  }
  
  console.log("🧹 Cleaning up temp backup files...");
  fs.rmSync(TEMP_ASSETS, { recursive: true, force: true });
  console.log("✅ iOS Prebuild completed and all assets successfully merged!");

} else if (iosExists && xcodeProjExists) {
  // Scenario 2: The ios folder is already fully scaffolded and complete
  console.log("✅ Complete iOS project detected.");
  console.log("🏗️ Running incremental prebuild without clearing anything...");
  execSync('npx expo prebuild --platform ios', { stdio: 'inherit' });

} else {
  // Scenario 3: The ios folder does not exist at all
  console.log("🆕 iOS project does not exist.");
  console.log("🏗️ Running prebuild to create native project...");
  execSync('npx expo prebuild --platform ios', { stdio: 'inherit' });
}
