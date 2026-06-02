const fs = require('fs');
const path = require('path');
const { runCommand, log, fail } = require('./utils');


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
  
  log.process("Running prebuild to generate clean native project...");
  runCommand('npx expo prebuild --platform ios');
  
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

} else if (iosExists && xcodeProjExists) {
  // Scenario 2: The ios folder is already fully scaffolded and complete
  log.success("Complete iOS project detected.");
  log.process("Running incremental prebuild without clearing anything...");
  runCommand('npx expo prebuild --platform ios');

} else {
  // Scenario 3: The ios folder does not exist at all
  log.info("iOS project does not exist.");
  log.process("Running prebuild to create native project...");
  runCommand('npx expo prebuild --platform ios');
}

// Patch Podfile to disable dSYM generation for Pods targets (resolves React.framework missing dSYM errors on App Store)
const podfilePath = path.join(IOS_DIR, 'Podfile');
if (fs.existsSync(podfilePath)) {
  log.info("Applying App Store Connect symbol upload validation fix to Podfile...");
  let podfileContent = fs.readFileSync(podfilePath, 'utf8');
  
  // Use regex to locate post_install hook robustly, capturing leading indentation
  const match = podfileContent.match(/(^[ \t]*)post_install\s+do\s+\|installer\|/m);
  if (match) {
    const indentation = match[1] || '';
    const matchedStr = match[0];
    
    // Build the patch maintaining file's indentation style
    const patch = `${matchedStr}
${indentation}  # App Store validation & static signing fixes: Force dwarf format and disable Pod signing
${indentation}  installer.pods_project.targets.each do |target|
${indentation}    target.build_configurations.each do |config|
${indentation}      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
${indentation}      config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
${indentation}      config.build_settings['PROVISIONING_PROFILE_SPECIFIER'] = ''
${indentation}      config.build_settings['CODE_SIGN_IDENTITY'] = ''
${indentation}    end
${indentation}  end`;

    podfileContent = podfileContent.replace(matchedStr, patch);
    fs.writeFileSync(podfilePath, podfileContent, 'utf8');
    log.success("Successfully patched Podfile with robust indentation alignment.");
    
    log.process("Running pod install again to apply the Podfile updates...");
    runCommand('pod install', { cwd: IOS_DIR });
    log.success("CocoaPods dependency configuration successfully updated.");

    // Dynamic Patch: Fix CocoaPods dSYM touch bug for all dynamic frameworks
    const targetSupportDir = path.join(IOS_DIR, 'Pods', 'Target Support Files');
    if (fs.existsSync(targetSupportDir)) {
      log.info("Checking for CocoaPods target support scripts to patch...");
      const targets = fs.readdirSync(targetSupportDir);
      targets.forEach(target => {
        const scriptPath = path.join(targetSupportDir, target, `${target}-frameworks.sh`);
        if (fs.existsSync(scriptPath)) {
          let scriptContent = fs.readFileSync(scriptPath, 'utf8');
          const targetString = 'touch "${DWARF_DSYM_FOLDER_PATH}/${basename}.dSYM"';
          if (scriptContent.includes(targetString)) {
            scriptContent = scriptContent.replaceAll(
              targetString,
              'mkdir -p "${DWARF_DSYM_FOLDER_PATH}/$(dirname "${basename}")" && touch "${DWARF_DSYM_FOLDER_PATH}/${basename}.dSYM"'
            );
            fs.writeFileSync(scriptPath, scriptContent, 'utf8');
            log.success(`Successfully patched CocoaPods dSYM touch bug in: ${target}-frameworks.sh`);
          }
        }
      });
    }
  } else {
    log.warn("Warning: post_install block not found in Podfile. Skipping patch.");
  }
}
