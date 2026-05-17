#!/bin/bash
set -e

# Define directories
ANDROID_DIR="android"
BUILD_GRADLE="$ANDROID_DIR/app/build.gradle"
TEMP_ASSETS="temp-assets-$$"

# Ensure dummy google-services.json exists for Expo prebuild
if [ ! -f "google-services.json" ]; then
  echo "🔥 Creating dummy google-services.json for Expo prebuild..."
  echo '{"project_info":{"project_number":"1","project_id":"d"},"client":[{"client_info":{"mobilesdk_app_id":"1:1:android:1","android_client_info":{"package_name":"com.d"}}}],"configuration_version":"1"}' > google-services.json
fi

# Check if the android folder exists and is complete
if [ -d "$ANDROID_DIR" ] && [ ! -f "$BUILD_GRADLE" ]; then
  # Scenario 1: The android folder exists but is incomplete (created only by bundle:android)
  echo "⚠️ Incomplete Android project detected (contains assets but no Gradle files)."
  echo "📦 Backing up bundle and assets..."
  
  # Create temp backup directories
  mkdir -p "$TEMP_ASSETS/assets" "$TEMP_ASSETS/res"
  
  # Copy bundle and assets if they exist
  if [ -d "$ANDROID_DIR/app/src/main/assets" ]; then
    cp -r "$ANDROID_DIR/app/src/main/assets/"* "$TEMP_ASSETS/assets/" 2>/dev/null || true
  fi
  if [ -d "$ANDROID_DIR/app/src/main/res" ]; then
    cp -r "$ANDROID_DIR/app/src/main/res/"* "$TEMP_ASSETS/res/" 2>/dev/null || true
  fi
  
  echo "🧹 Removing incomplete android directory to prevent Expo prompt..."
  rm -rf "$ANDROID_DIR"
  
  echo "🏗️ Running prebuild to generate clean native project..."
  npx expo prebuild --platform android
  
  echo "🔄 Restoring bundle and assets into the complete native project..."
  mkdir -p "$ANDROID_DIR/app/src/main/assets" "$ANDROID_DIR/app/src/main/res"
  cp -r "$TEMP_ASSETS/assets/"* "$ANDROID_DIR/app/src/main/assets/" 2>/dev/null || true
  cp -r "$TEMP_ASSETS/res/"* "$ANDROID_DIR/app/src/main/res/" 2>/dev/null || true
  
  echo "🧹 Cleaning up temp backup files..."
  rm -rf "$TEMP_ASSETS"
  echo "✅ Prebuild completed and all assets successfully merged!"

elif [ -d "$ANDROID_DIR" ] && [ -f "$BUILD_GRADLE" ]; then
  # Scenario 2: The android folder is already fully scaffolded and complete
  echo "✅ Complete Android project detected."
  echo "🏗️ Running incremental prebuild without clearing anything..."
  npx expo prebuild --platform android

else
  # Scenario 3: The android folder does not exist at all
  echo "🆕 Android project does not exist."
  echo "🏗️ Running prebuild to create native project..."
  npx expo prebuild --platform android
fi
