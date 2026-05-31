const fs = require('fs');
const path = require('path');
const { runCommand, log, fail } = require('./utils');

// Helper to inject CocoaPods signing exemptions and trigger pod install
function applySigningExemptionsAndInstall() {
  const podfilePath = path.join(IOS_DIR, 'Podfile');
  if (fs.existsSync(podfilePath)) {
    log.process("💉 Injecting CocoaPods target signing exemptions into Podfile...");
    
    try {
      let podfileContent = fs.readFileSync(podfilePath, 'utf8');
      
      const patch = `post_install do |installer|
  # ==========================================
  # Dynamic SaaS Builder Code Signing Patch
  # ==========================================
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
      config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
    end
  end`;
      
      // Inject inside the existing post_install hook robustly
      if (podfileContent.includes('post_install do |installer|')) {
        podfileContent = podfileContent.replace('post_install do |installer|', patch);
        fs.writeFileSync(podfilePath, podfileContent, 'utf8');
        log.success("Signing exemptions successfully injected inside existing post_install block.");
      } else {
        // Fallback: If no existing post_install block, append a new one
        const fallbackHook = `
post_install do |installer|
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
      config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
    end
  end
end
`;
        fs.appendFileSync(podfilePath, fallbackHook);
        log.success("No existing post_install block found. Appended new hook to Podfile.");
      }
    } catch (err) {
      fail(`Failed to write signing exemptions to Podfile: ${err.message}`);
    }
  } else {
    fail("Podfile not found after Expo prebuild!");
  }

  log.process("📦 Executing manual pod install...");
  try {
    runCommand('pod install', { cwd: IOS_DIR });
    log.success("CocoaPods dependencies installed successfully!");
  } catch (err) {
    fail(`Manual pod install failed: ${err.message}`);
  }
}

// Define directories
const IOS_DIR = 'ios';
const TEMP_ASSETS = `temp-assets-ios-${process.pid}`;

// Ensure GoogleService-Info.plist exists for Expo prebuild
if (!fs.existsSync('GoogleService-Info.plist')) {
  fail("Required Firebase configuration file 'GoogleService-Info.plist' is missing. Firebase setup must run and succeed first.");
}

// Check if there are any xcodeproj directories in the ios folder
let xcodeProjExists = false;
if (fs.existsSync(IOS_DIR) && fs.lstatSync(IOS_DIR).isDirectory()) {
  try {
    const files = fs.readdirSync(IOS_DIR);
    xcodeProjExists = files.some(file => file.endsWith('.xcodeproj') && fs.lstatSync(path.join(IOS_DIR, file)).isDirectory());
  } catch (err) {
    log.warn(`Warning checking Xcode project files: ${err.message}`);
  }
}

const iosExists = fs.existsSync(IOS_DIR) && fs.lstatSync(IOS_DIR).isDirectory();

// Check if the ios folder exists and is complete
if (iosExists && !xcodeProjExists) {
  // Scenario 1: The ios folder exists but is incomplete (created only by bundle:ios)
  log.warn("Incomplete iOS project detected (contains assets but no Xcode project files).");
  log.info("📦 Backing up bundle and assets...");
  
  // Create temp backup directories
  fs.mkdirSync(path.join(TEMP_ASSETS, 'assets'), { recursive: true });
  
  // Copy bundle and assets if they exist
  const srcBundle = path.join(IOS_DIR, 'main.jsbundle');
  if (fs.existsSync(srcBundle) && fs.lstatSync(srcBundle).isFile()) {
    try {
      fs.copyFileSync(srcBundle, path.join(TEMP_ASSETS, 'main.jsbundle'));
    } catch (err) {
      log.warn(`Warning backing up main.jsbundle: ${err.message}`);
    }
  }
  
  const srcAssets = path.join(IOS_DIR, 'assets');
  if (fs.existsSync(srcAssets) && fs.lstatSync(srcAssets).isDirectory()) {
    try {
      fs.cpSync(srcAssets, path.join(TEMP_ASSETS, 'assets'), { recursive: true });
    } catch (err) {
      log.warn(`Warning backing up assets: ${err.message}`);
    }
  }
  
  log.info("Cleaning up incomplete ios directory to prevent Expo prompt...");
  fs.rmSync(IOS_DIR, { recursive: true, force: true });
  
  log.process("Running prebuild to generate clean native project (skipping install)...");
  runCommand('npx expo prebuild --platform ios --no-install');
  
  log.info("Restoring bundle and assets into the complete native project...");
  fs.mkdirSync(IOS_DIR, { recursive: true });
  
  const tempBundle = path.join(TEMP_ASSETS, 'main.jsbundle');
  if (fs.existsSync(tempBundle) && fs.lstatSync(tempBundle).isFile()) {
    try {
      fs.copyFileSync(tempBundle, path.join(IOS_DIR, 'main.jsbundle'));
    } catch (err) {
      log.warn(`Warning restoring main.jsbundle: ${err.message}`);
    }
  }
  
  const tempAssets = path.join(TEMP_ASSETS, 'assets');
  if (fs.existsSync(tempAssets) && fs.readdirSync(tempAssets).length > 0) {
    try {
      fs.mkdirSync(path.join(IOS_DIR, 'assets'), { recursive: true });
      fs.cpSync(tempAssets, path.join(IOS_DIR, 'assets'), { recursive: true });
    } catch (err) {
      log.warn(`Warning restoring assets: ${err.message}`);
    }
  }
  
  log.info("Cleaning up temp backup files...");
  fs.rmSync(TEMP_ASSETS, { recursive: true, force: true });
  log.success("iOS Prebuild completed and all assets successfully merged!");
  applySigningExemptionsAndInstall();

} else if (iosExists && xcodeProjExists) {
  // Scenario 2: The ios folder is already fully scaffolded and complete
  log.success("Complete iOS project detected.");
  log.process("Running incremental prebuild (skipping install)...");
  runCommand('npx expo prebuild --platform ios --no-install');
  applySigningExemptionsAndInstall();

} else {
  // Scenario 3: The ios folder does not exist at all
  log.info("iOS project does not exist.");
  log.process("Running prebuild to create native project (skipping install)...");
  runCommand('npx expo prebuild --platform ios --no-install');
  applySigningExemptionsAndInstall();
}
