#!/bin/bash
set -e

echo "🚀 Setting up dynamic App Info (Package ID & App Name) in $(pwd)..."

# 1. Ensure required environment variables
# If PACKAGE_ID and APP_NAME are provided as env vars, we skip fetching from config
if [ -z "$PACKAGE_ID" ] || [ -z "$APP_NAME" ]; then
  if [ -z "$BUILD_ID" ]; then
    echo "❌ BUILD_ID not found in environment."
    exit 1
  fi

  # Configuration must be provided by the preceding 'Fetch App Configuration' workflow step
  if [ ! -f "app_config.json" ]; then
    echo "❌ app_config.json not found. The 'Fetch App Configuration' step must run before this script."
    exit 1
  fi

  echo "📖 Loading build configuration..."
  CONFIG_RESPONSE=$(cat app_config.json)

  # 2. Secure & Correct Data Extraction
  # 🔗 Corrected path: Removed the non-existent .data wrapper to align with the setup-config model.
  # 🔐 Sanitization: Use sed to filter out potential injection characters from dynamic inputs.
  
  sanitize_input() {
    echo "$1" | sed 's/[^a-zA-Z0-9 .-]//g'
  }

  RAW_PACKAGE_ID=$(echo "$CONFIG_RESPONSE" | jq -r '.package_id // empty')
  RAW_APP_NAME=$(echo "$CONFIG_RESPONSE" | jq -r '.app_name // empty')
  RAW_SLUG=$(echo "$CONFIG_RESPONSE" | jq -r '.slug // empty')

  if [ -z "$RAW_PACKAGE_ID" ] || [ -z "$RAW_APP_NAME" ]; then
    echo "⚠️ package_id or app_name not found in configuration. Skipping updates."
    exit 0
  fi

  PACKAGE_ID=$(sanitize_input "$RAW_PACKAGE_ID")
  APP_NAME=$(sanitize_input "$RAW_APP_NAME")
  SLUG=$(sanitize_input "$RAW_SLUG")
fi

echo "✅ Target Package ID: $PACKAGE_ID"
echo "✅ Target App Name: $APP_NAME"
echo "✅ Target Slug: $SLUG"

OLD_PACKAGE_ID="com.appnatively.appnatively"
OLD_APP_NAME="AppNatively App"
OLD_SLUG="appnatively-app"
OLD_SCHEME="app"
OLD_IOS_NAME="AppNativelyApp"

# --- 1. Calculate Safe Names ---
# Alphanumeric only for iOS folder/project/scheme
SAFE_APP_NAME=$(echo "$APP_NAME" | sed 's/[^a-zA-Z0-9]//g')

# 🛡️ Resource Safety: Escape special XML characters in the App Name before native insertion
XML_SAFE_APP_NAME=$(echo "$RAW_APP_NAME" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')

echo "✅ Safe App Name (iOS): $SAFE_APP_NAME"
# Save for workflow use
echo "$SAFE_APP_NAME" > .ios_project_name

# Helper for macOS sed compatibility
sed_i() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$1" "$2"
  else
    sed -i "$1" "$2"
  fi
}

# --- 2. Update app.json ---
if [ -f "app.json" ]; then
  echo "📝 Updating app.json..."
  sed_i "s/\"name\": \"$OLD_APP_NAME\"/\"name\": \"$APP_NAME\"/g" app.json
  
  # Use SLUG if provided, otherwise fallback to APP_NAME
  TARGET_SLUG=${SLUG:-$APP_NAME}
  sed_i "s/\"slug\": \"$OLD_SLUG\"/\"slug\": \"$TARGET_SLUG\"/g" app.json
  sed_i "s/\"bundleIdentifier\": \"$OLD_PACKAGE_ID\"/\"bundleIdentifier\": \"$PACKAGE_ID\"/g" app.json
  sed_i "s/\"package\": \"$OLD_PACKAGE_ID\"/\"package\": \"$PACKAGE_ID\"/g" app.json
  # Update scheme
  sed_i "s/\"scheme\": \"$OLD_SCHEME\"/\"scheme\": \"$TARGET_SLUG\"/g" app.json
fi

# --- 3. Android Updates ---
if [ -d "android" ]; then
  echo "🤖 Updating Android project..."
  
  # build.gradle
  if [ -f "android/app/build.gradle" ]; then
    echo "  - Updating build.gradle"
    sed_i "s/namespace '$OLD_PACKAGE_ID'/namespace '$PACKAGE_ID'/g" android/app/build.gradle
    sed_i "s/applicationId '$OLD_PACKAGE_ID'/applicationId '$PACKAGE_ID'/g" android/app/build.gradle
  fi

  # strings.xml
  if [ -f "android/app/src/main/res/values/strings.xml" ]; then
    echo "  - Updating strings.xml"
    sed_i "s/<string name=\"app_name\">$OLD_APP_NAME<\/string>/<string name=\"app_name\">$XML_SAFE_APP_NAME<\/string>/g" android/app/src/main/res/values/strings.xml
  fi

  # settings.gradle
  if [ -f "android/settings.gradle" ]; then
    echo "  - Updating settings.gradle"
    sed_i "s/rootProject.name = '$OLD_APP_NAME'/rootProject.name = '$APP_NAME'/g" android/settings.gradle
  fi

  # AndroidManifest.xml (Deep link scheme)
  if [ -f "android/app/src/main/AndroidManifest.xml" ]; then
    echo "  - Updating AndroidManifest scheme"
    sed_i "s/android:scheme=\"$OLD_SCHEME\"/android:scheme=\"$TARGET_SLUG\"/g" android/app/src/main/AndroidManifest.xml
  fi

  # Kotlin Files & Package Structure
  OLD_PACKAGE_PATH=$(echo $OLD_PACKAGE_ID | tr '.' '/')
  NEW_PACKAGE_PATH=$(echo $PACKAGE_ID | tr '.' '/')
  
  SOURCE_DIR="android/app/src/main/java/$OLD_PACKAGE_PATH"
  TARGET_DIR="android/app/src/main/java/$NEW_PACKAGE_PATH"

  if [ -d "$SOURCE_DIR" ]; then
    echo "  - Updating package declarations in Kotlin files..."
    for file in "$SOURCE_DIR"/*.kt; do
      if [ -f "$file" ]; then
        sed_i "s/package $OLD_PACKAGE_ID/package $PACKAGE_ID/g" "$file"
      fi
    done

    echo "  - Moving Kotlin files to new package structure: $TARGET_DIR"
    mkdir -p "$TARGET_DIR"
    mv "$SOURCE_DIR"/* "$TARGET_DIR/"
    
    # Clean up old directory if empty
    rmdir -p "$SOURCE_DIR" 2>/dev/null || true
  fi
fi

# --- 4. iOS Updates ---
if [ -d "ios" ]; then
  echo "🍎 Updating iOS project..."
  
  cd ios

  # 4.1 Update Internal Data First (Using Old Paths)
  echo "  - Updating internal data in project files..."
  
  # Podfile
  if [ -f "Podfile" ]; then
    sed_i "s/target '$OLD_IOS_NAME'/target '$SAFE_APP_NAME'/g" Podfile
  fi

  # Workspace
  if [ -f "$OLD_IOS_NAME.xcworkspace/contents.xcworkspacedata" ]; then
    sed_i "s/$OLD_IOS_NAME.xcodeproj/$SAFE_APP_NAME.xcodeproj/g" "$OLD_IOS_NAME.xcworkspace/contents.xcworkspacedata"
  fi

  # project.pbxproj
  if [ -f "$OLD_IOS_NAME.xcodeproj/project.pbxproj" ]; then
    sed_i "s/$OLD_IOS_NAME/$SAFE_APP_NAME/g" "$OLD_IOS_NAME.xcodeproj/project.pbxproj"
    # Update bundle ID and product name
    sed_i "s/PRODUCT_BUNDLE_IDENTIFIER = $OLD_PACKAGE_ID/PRODUCT_BUNDLE_IDENTIFIER = $PACKAGE_ID/g" "$OLD_IOS_NAME.xcodeproj/project.pbxproj"
    sed_i "s/PRODUCT_NAME = $OLD_APP_NAME/PRODUCT_NAME = $APP_NAME/g" "$OLD_IOS_NAME.xcodeproj/project.pbxproj"
  fi

  # Scheme
  SCHEME_PATH="$OLD_IOS_NAME.xcodeproj/xcshareddata/xcschemes/$OLD_IOS_NAME.xcscheme"
  if [ -f "$SCHEME_PATH" ]; then
    sed_i "s/$OLD_IOS_NAME/$SAFE_APP_NAME/g" "$SCHEME_PATH"
  fi

  # Info.plist
  if [ -f "$OLD_IOS_NAME/Info.plist" ]; then
    # CFBundleDisplayName
    sed_i "s/<string>$OLD_APP_NAME<\/string>/<string>$XML_SAFE_APP_NAME<\/string>/g" "$OLD_IOS_NAME/Info.plist"
    # CFBundleURLSchemes (scheme and package id)
    sed_i "s/<string>$OLD_SCHEME<\/string>/<string>$TARGET_SLUG<\/string>/g" "$OLD_IOS_NAME/Info.plist"
    sed_i "s/<string>$OLD_PACKAGE_ID<\/string>/<string>$PACKAGE_ID<\/string>/g" "$OLD_IOS_NAME/Info.plist"
  fi

  # 4.2 Rename Folders and Project Files (Now that data is updated)
  echo "  - Renaming project folders and files to $SAFE_APP_NAME..."
  
  # Rename internal files that contain the old app name in their filename
  if [ -f "$OLD_IOS_NAME/$OLD_IOS_NAME.entitlements" ]; then
    mv "$OLD_IOS_NAME/$OLD_IOS_NAME.entitlements" "$OLD_IOS_NAME/$SAFE_APP_NAME.entitlements"
  fi
  if [ -f "$OLD_IOS_NAME/$OLD_IOS_NAME-Bridging-Header.h" ]; then
    mv "$OLD_IOS_NAME/$OLD_IOS_NAME-Bridging-Header.h" "$OLD_IOS_NAME/$SAFE_APP_NAME-Bridging-Header.h"
  fi

  # Rename scheme file first
  if [ -f "$SCHEME_PATH" ]; then
    mv "$SCHEME_PATH" "$OLD_IOS_NAME.xcodeproj/xcshareddata/xcschemes/$SAFE_APP_NAME.xcscheme"
  fi

  # Rename main project folders and workspace
  if [ -d "$OLD_IOS_NAME" ]; then
    mv "$OLD_IOS_NAME" "$SAFE_APP_NAME"
  fi
  if [ -d "$OLD_IOS_NAME.xcodeproj" ]; then
    mv "$OLD_IOS_NAME.xcodeproj" "$SAFE_APP_NAME.xcodeproj"
  fi
  if [ -d "$OLD_IOS_NAME.xcworkspace" ]; then
    mv "$OLD_IOS_NAME.xcworkspace" "$SAFE_APP_NAME.xcworkspace"
  fi

  cd ../..
fi

echo "🎉 App Info dynamic setup complete."
