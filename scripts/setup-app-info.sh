#!/bin/bash
set -e

echo "🚀 Setting up dynamic App Info (Package ID & App Name) in $(pwd)..."

# This script expects BUILD_ID and SECRETS_JSON as environment variables
if [ -z "$BUILD_ID" ]; then
  echo "❌ BUILD_ID not found in environment."
  exit 1
fi

if [ -z "$SECRETS_JSON" ]; then
  echo "❌ SECRETS_JSON not found in environment."
  exit 1
fi

# 1. Extract API URL from secrets
API_URL=$(echo "$SECRETS_JSON" | jq -r '.EXPO_PUBLIC_API_URL // empty')

if [ -z "$API_URL" ]; then
  echo "⚠️ EXPO_PUBLIC_API_URL not found in secrets. Skipping App Info setup."
  exit 0
fi

# 2. Fetch config from backend
echo "📡 Fetching config from ${API_URL}/mobile-app/builds/${BUILD_ID}/config"
CONFIG_RESPONSE=$(curl -s "${API_URL}/mobile-app/builds/${BUILD_ID}/config")

# 3. Extract Package ID, App Name and Slug
PACKAGE_ID=$(echo "$CONFIG_RESPONSE" | jq -r '.data.package_id // empty')
APP_NAME=$(echo "$CONFIG_RESPONSE" | jq -r '.data.app_name // empty')
SLUG=$(echo "$CONFIG_RESPONSE" | jq -r '.data.slug // empty')

if [ -z "$PACKAGE_ID" ] || [ -z "$APP_NAME" ]; then
  echo "⚠️ package_id or app_name not found in config. Skipping updates."
  echo "Response: $CONFIG_RESPONSE"
  exit 0
fi

echo "✅ Target Package ID: $PACKAGE_ID"
echo "✅ Target App Name: $APP_NAME"
echo "✅ Target Slug: $SLUG"

OLD_PACKAGE_ID="com.appnatively.appnatively"
OLD_APP_NAME="app"

# Helper for macOS sed compatibility
sed_i() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

# --- 1. Update app.json ---
if [ -f "app/app.json" ]; then
  echo "📝 Updating app/app.json..."
  sed_i "s/\"name\": \"$OLD_APP_NAME\"/\"name\": \"$APP_NAME\"/g" app/app.json
  
  # Use SLUG if provided, otherwise fallback to APP_NAME
  TARGET_SLUG=${SLUG:-$APP_NAME}
  sed_i "s/\"slug\": \"$OLD_APP_NAME\"/\"slug\": \"$TARGET_SLUG\"/g" app/app.json
  sed_i "s/\"bundleIdentifier\": \"$OLD_PACKAGE_ID\"/\"bundleIdentifier\": \"$PACKAGE_ID\"/g" app/app.json
  sed_i "s/\"package\": \"$OLD_PACKAGE_ID\"/\"package\": \"$PACKAGE_ID\"/g" app/app.json
  # Update scheme if it matches OLD_APP_NAME
  sed_i "s/\"scheme\": \"$OLD_APP_NAME\"/\"scheme\": \"$APP_NAME\"/g" app/app.json
fi

# --- 2. Android Updates ---
if [ -d "app/android" ]; then
  echo "🤖 Updating Android project..."
  
  # build.gradle
  if [ -f "app/android/app/build.gradle" ]; then
    echo "  - Updating build.gradle"
    sed_i "s/namespace '$OLD_PACKAGE_ID'/namespace '$PACKAGE_ID'/g" app/android/app/build.gradle
    sed_i "s/applicationId '$OLD_PACKAGE_ID'/applicationId '$PACKAGE_ID'/g" app/android/app/build.gradle
  fi

  # strings.xml
  if [ -f "app/android/app/src/main/res/values/strings.xml" ]; then
    echo "  - Updating strings.xml"
    sed_i "s/<string name=\"app_name\">$OLD_APP_NAME<\/string>/<string name=\"app_name\">$APP_NAME<\/string>/g" app/android/app/src/main/res/values/strings.xml
  fi

  # AndroidManifest.xml (Deep link scheme)
  if [ -f "app/android/app/src/main/AndroidManifest.xml" ]; then
    echo "  - Updating AndroidManifest scheme"
    sed_i "s/android:scheme=\"$OLD_APP_NAME\"/android:scheme=\"$APP_NAME\"/g" app/android/app/src/main/AndroidManifest.xml
  fi

  # Kotlin Files & Package Structure
  OLD_PACKAGE_PATH=$(echo $OLD_PACKAGE_ID | tr '.' '/')
  NEW_PACKAGE_PATH=$(echo $PACKAGE_ID | tr '.' '/')
  
  SOURCE_DIR="app/android/app/src/main/java/$OLD_PACKAGE_PATH"
  TARGET_DIR="app/android/app/src/main/java/$NEW_PACKAGE_PATH"

  if [ -d "$SOURCE_DIR" ]; then
    echo "  - Moving Kotlin files to new package structure: $TARGET_DIR"
    mkdir -p "$TARGET_DIR"
    mv "$SOURCE_DIR"/* "$TARGET_DIR/"
    
    # Update package declarations in moved files
    for file in "$TARGET_DIR"/*.kt; do
      if [ -f "$file" ]; then
        sed_i "s/package $OLD_PACKAGE_ID/package $PACKAGE_ID/g" "$file"
      fi
    done
    
    # Clean up old directory if empty
    rmdir -p "$SOURCE_DIR" 2>/dev/null || true
  fi
fi

# --- 3. iOS Updates ---
if [ -d "app/ios" ]; then
  echo "🍎 Updating iOS project..."
  
  # Info.plist
  if [ -f "app/ios/app/Info.plist" ]; then
    echo "  - Updating Info.plist"
    # CFBundleDisplayName
    sed_i "s/<string>$OLD_APP_NAME<\/string>/<string>$APP_NAME<\/string>/g" app/ios/app/Info.plist
    # CFBundleURLSchemes
    sed_i "s/<string>$OLD_PACKAGE_ID<\/string>/<string>$PACKAGE_ID<\/string>/g" app/ios/app/Info.plist
    sed_i "s/<string>$OLD_APP_NAME<\/string>/<string>$APP_NAME<\/string>/g" app/ios/app/Info.plist
  fi

  # project.pbxproj
  if [ -f "app/ios/app.xcodeproj/project.pbxproj" ]; then
    echo "  - Updating project.pbxproj"
    sed_i "s/PRODUCT_BUNDLE_IDENTIFIER = $OLD_PACKAGE_ID/PRODUCT_BUNDLE_IDENTIFIER = $PACKAGE_ID/g" app/ios/app.xcodeproj/project.pbxproj
    sed_i "s/PRODUCT_NAME = $OLD_APP_NAME/PRODUCT_NAME = $APP_NAME/g" app/ios/app.xcodeproj/project.pbxproj
  fi
fi

echo "🎉 App Info dynamic setup complete."
