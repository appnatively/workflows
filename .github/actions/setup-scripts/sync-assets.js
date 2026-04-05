const fs = require('fs');
const path = require('path');
const { generateImageAsync } = require('@expo/image-utils');

const PROJECT_ROOT = process.cwd();
const IOS_PROJECT_NAME_FILE = path.join(PROJECT_ROOT, '.ios_project_name');

async function syncAssets() {
  console.log('🔄 Starting Native Asset Synchronization...');

  const appJsonPath = path.join(PROJECT_ROOT, 'app.json');
  if (!fs.existsSync(appJsonPath)) {
    console.error('❌ app.json not found in ' + PROJECT_ROOT);
    process.exit(1);
  }

  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const expoConfig = appJson.expo || {};

  // 1. Determine iOS Project Name
  let iosProjectName = 'AppNativelyApp';
  if (fs.existsSync(IOS_PROJECT_NAME_FILE)) {
    iosProjectName = fs.readFileSync(IOS_PROJECT_NAME_FILE, 'utf8').trim();
  } else if (fs.existsSync(path.join(PROJECT_ROOT, 'ios', '.ios_project_name'))) {
    iosProjectName = fs.readFileSync(path.join(PROJECT_ROOT, 'ios', '.ios_project_name'), 'utf8').trim();
  }
  console.log(`🍎 iOS Project Name: ${iosProjectName}`);

  // 2. Helper for generating and saving images
  async function updateImage(sourceRelativePath, destRelativePath, width, height) {
    const sourcePath = path.join(PROJECT_ROOT, sourceRelativePath);
    const destPath = path.join(PROJECT_ROOT, destRelativePath);

    if (!fs.existsSync(sourcePath)) {
      console.warn(`⚠️ Source image not found: ${sourceRelativePath}`);
      return;
    }

    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      console.warn(`⚠️ Destination directory not found: ${destDir}`);
      return;
    }

    try {
      console.log(`  - Generating ${path.basename(destPath)} (${width}x${height})...`);
      
      // Remove existing .webp versions to avoid "Duplicate resources" error in Android merger
      if (destPath.endsWith('.png')) {
        const webpPath = destPath.replace(/\.png$/, '.webp');
        if (fs.existsSync(webpPath)) {
          console.log(`  - Removing duplicate resource: ${path.basename(webpPath)}`);
          fs.unlinkSync(webpPath);
        }
      }

      const { source } = await generateImageAsync(
        { projectRoot: PROJECT_ROOT, cacheType: 'branding' },
        {
          src: sourcePath,
          width,
          height,
          resizeMode: 'contain',
          backgroundColor: 'transparent',
        }
      );
      fs.writeFileSync(destPath, source);
    } catch (error) {
      console.error(`❌ Failed to generate ${destRelativePath}:`, error.message);
    }
  }

  // --- iOS SYNC ---
  if (fs.existsSync(path.join(PROJECT_ROOT, 'ios'))) {
    console.log('🍏 Syncing iOS Assets...');
    
    // App Icon (Single 1024x1024)
    const iconSource = expoConfig.icon || './assets/images/icon.png';
    await updateImage(
      iconSource,
      `ios/${iosProjectName}/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png`,
      1024,
      1024
    );

    // Splash Screen
    const splashConfig = expoConfig.plugins?.find(p => Array.isArray(p) && p[0] === 'expo-splash-screen')?.[1] || {};
    const splashSource = splashConfig.image || './assets/images/splash-icon.png';
    if (fs.existsSync(path.join(PROJECT_ROOT, splashSource))) {
      await updateImage(splashSource, `ios/${iosProjectName}/Images.xcassets/SplashScreenLogo.imageset/image.png`, 200, 200);
      await updateImage(splashSource, `ios/${iosProjectName}/Images.xcassets/SplashScreenLogo.imageset/image@2x.png`, 400, 400);
      await updateImage(splashSource, `ios/${iosProjectName}/Images.xcassets/SplashScreenLogo.imageset/image@3x.png`, 600, 600);
    }
  }

  // --- Android SYNC ---
  if (fs.existsSync(path.join(PROJECT_ROOT, 'android'))) {
    console.log('🤖 Syncing Android Assets...');

    const iconSource = expoConfig.icon || './assets/images/icon.png';
    const adaptive = expoConfig.android?.adaptiveIcon || {};
    const foregroundSource = adaptive.foregroundImage || './assets/images/android-icon-foreground.png';

    const densities = {
      mdpi: 1,
      hdpi: 1.5,
      xhdpi: 2,
      xxhdpi: 3,
      xxxhdpi: 4
    };

    for (const [density, multiplier] of Object.entries(densities)) {
      // Legacy Icon
      await updateImage(
        iconSource,
        `android/app/src/main/res/mipmap-${density}/ic_launcher.png`,
        Math.round(48 * multiplier),
        Math.round(48 * multiplier)
      );
      await updateImage(
        iconSource,
        `android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`,
        Math.round(48 * multiplier),
        Math.round(48 * multiplier)
      );

      // Adaptive Foreground
      await updateImage(
        foregroundSource,
        `android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`,
        Math.round(108 * multiplier),
        Math.round(108 * multiplier)
      );
    }
  }

  console.log('✅ Asset Synchronization Complete.');
}

syncAssets().catch(err => {
  console.error('❌ Fatal error during asset sync:', err);
  process.exit(1);
});
