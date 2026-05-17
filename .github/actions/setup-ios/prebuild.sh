#!/bin/bash
set -e

# Define directories
IOS_DIR="ios"
TEMP_ASSETS="temp-assets-ios-$$"

# Ensure dummy GoogleService-Info.plist exists for Expo prebuild
if [ ! -f "GoogleService-Info.plist" ]; then
  echo "🔥 Creating dummy GoogleService-Info.plist for Expo prebuild..."
  echo '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>GOOGLE_APP_ID</key><string>1:1:ios:1</string></dict></plist>' > GoogleService-Info.plist
fi

# Check if there are any xcodeproj directories in the ios folder
XCODEPROJ_EXISTS=0
if [ -d "$IOS_DIR" ]; then
  if ls "$IOS_DIR"/*.xcodeproj >/dev/null 2>&1; then
    XCODEPROJ_EXISTS=1
  fi
fi

# Check if the ios folder exists and is complete
if [ -d "$IOS_DIR" ] && [ "$XCODEPROJ_EXISTS" -eq 0 ]; then
  # Scenario 1: The ios folder exists but is incomplete (created only by bundle:ios)
  echo "⚠️ Incomplete iOS project detected (contains assets but no Xcode project files)."
  echo "📦 Backing up bundle and assets..."
  
  # Create temp backup directories
  mkdir -p "$TEMP_ASSETS/assets"
  
  # Copy bundle and assets if they exist
  if [ -f "$IOS_DIR/main.jsbundle" ]; then
    cp "$IOS_DIR/main.jsbundle" "$TEMP_ASSETS/" 2>/dev/null || true
  fi
  if [ -d "$IOS_DIR/assets" ]; then
    cp -r "$IOS_DIR/assets/"* "$TEMP_ASSETS/assets/" 2>/dev/null || true
  fi
  
  echo "🧹 Removing incomplete ios directory to prevent Expo prompt..."
  rm -rf "$IOS_DIR"
  
  echo "🏗️ Running prebuild to generate clean native project..."
  npx expo prebuild --platform ios
  
  echo "🔄 Restoring bundle and assets into the complete native project..."
  mkdir -p "$IOS_DIR"
  if [ -f "$TEMP_ASSETS/main.jsbundle" ]; then
    cp "$TEMP_ASSETS/main.jsbundle" "$IOS_DIR/" 2>/dev/null || true
  fi
  if [ -d "$TEMP_ASSETS/assets" ]; then
    mkdir -p "$IOS_DIR/assets"
    cp -r "$TEMP_ASSETS/assets/"* "$IOS_DIR/assets/" 2>/dev/null || true
  fi
  
  echo "🧹 Cleaning up temp backup files..."
  rm -rf "$TEMP_ASSETS"
  echo "✅ iOS Prebuild completed and all assets successfully merged!"

elif [ -d "$IOS_DIR" ] && [ "$XCODEPROJ_EXISTS" -eq 1 ]; then
  # Scenario 2: The ios folder is already fully scaffolded and complete
  echo "✅ Complete iOS project detected."
  echo "🏗️ Running incremental prebuild without clearing anything..."
  npx expo prebuild --platform ios

else
  # Scenario 3: The ios folder does not exist at all
  echo "🆕 iOS project does not exist."
  echo "🏗️ Running prebuild to create native project..."
  npx expo prebuild --platform ios
fi
