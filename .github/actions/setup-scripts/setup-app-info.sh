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
  # Look for app_config.json in current or parent directory
  CONFIG_PATH="app_config.json"
  if [ ! -f "$CONFIG_PATH" ] && [ -f "../app_config.json" ]; then
    CONFIG_PATH="../app_config.json"
  fi

  if [ ! -f "$CONFIG_PATH" ]; then
    echo "❌ app_config.json not found in $(pwd) or parent directory."
    echo "   The 'Fetch App Configuration' step must run before this script."
    exit 1
  fi

  echo "📖 Loading build configuration from $CONFIG_PATH..."
  CONFIG_RESPONSE=$(cat "$CONFIG_PATH")

  # 2. Secure & Correct Data Extraction
  # 🔐 Sanitization: Allow alphanumeric, spaces, dots, and hyphens. Filter out shell/sed metacharacters.
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

# Constants for the base template (must match the source repository state)
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

# Helper for macOS/Linux sed compatibility (using '|' as delimiter for safety)
sed_safe() {
  local pattern="$1"
  local file="$2"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$pattern" "$file"
  else
    sed -i "$pattern" "$file"
  fi
}

# --- 2. Update app.json (Using jq for Native JSON Manipulation) ---
if [ -f "app.json" ]; then
  echo "📝 Updating app.json with jq..."
  TARGET_SLUG="${SLUG:-$APP_NAME}"
  
  # Atomically update app.json
  TEMP_JSON=$(mktemp)
  jq --arg name "$APP_NAME" \
     --arg slug "$TARGET_SLUG" \
     --arg pkg "$PACKAGE_ID" \
     '.expo.name = $name | .expo.slug = $slug | .expo.ios.bundleIdentifier = $pkg | .expo.android.package = $pkg | .expo.scheme = $slug' \
     app.json > "$TEMP_JSON"
  mv "$TEMP_JSON" app.json
fi

# --- 3. Android Updates ---
if [ -d "android" ]; then
  echo "🤖 Updating Android project..."
  
  # build.gradle
  if [ -f "android/app/build.gradle" ]; then
    echo "  - Updating build.gradle"
    sed_safe "s|namespace '$OLD_PACKAGE_ID'|namespace '$PACKAGE_ID'|g" android/app/build.gradle
    sed_safe "s|applicationId '$OLD_PACKAGE_ID'|applicationId '$PACKAGE_ID'|g" android/app/build.gradle
  fi

  # strings.xml
  if [ -f "android/app/src/main/res/values/strings.xml" ]; then
    echo "  - Updating strings.xml"
    # Note: Using different delimiter '|' to prevent issues if XML_SAFE_APP_NAME contains slashes
    sed_safe "s|<string name=\"app_name\">$OLD_APP_NAME</string>|<string name=\"app_name\">$XML_SAFE_APP_NAME</string>|g" android/app/src/main/res/values/strings.xml
  fi

  # settings.gradle
  if [ -f "android/settings.gradle" ]; then
    echo "  - Updating settings.gradle"
    sed_safe "s|rootProject.name = '$OLD_APP_NAME'|rootProject.name = '$APP_NAME'|g" android/settings.gradle
  fi

  # AndroidManifest.xml (Deep link scheme)
  if [ -f "android/app/src/main/AndroidManifest.xml" ]; then
    echo "  - Updating AndroidManifest scheme"
    sed_safe "s|android:scheme=\"$OLD_SCHEME\"|android:scheme=\"$TARGET_SLUG\"|g" android/app/src/main/AndroidManifest.xml
  fi

  # Kotlin Files & Package Structure
  OLD_PACKAGE_PATH=$(echo "$OLD_PACKAGE_ID" | tr '.' '/')
  NEW_PACKAGE_PATH=$(echo "$PACKAGE_ID" | tr '.' '/')
  
  SOURCE_DIR="android/app/src/main/java/$OLD_PACKAGE_PATH"
  TARGET_DIR="android/app/src/main/java/$NEW_PACKAGE_PATH"

  if [ -d "$SOURCE_DIR" ]; then
    echo "  - Updating package declarations in Kotlin files..."
    # Find all .kt files and update their package declaration
    find "$SOURCE_DIR" -maxdepth 1 -name "*.kt" | while read -r file; do
      sed_safe "s|package $OLD_PACKAGE_ID|package $PACKAGE_ID|g" "$file"
    done

    echo "  - Moving Kotlin files to new package structure: $TARGET_DIR"
    mkdir -p "$TARGET_DIR"
    mv "$SOURCE_DIR"/* "$TARGET_DIR/"
    
    # Clean up old directory structure if empty
    rmdir -p "$SOURCE_DIR" 2>/dev/null || true
  fi
fi

# --- 4. iOS Updates ---
if [ -d "ios" ]; then
  echo "🍎 Updating iOS project..."
  
  # Avoid double-running if already renamed
  if [ ! -d "ios/$OLD_IOS_NAME" ] && [ ! -d "ios/$SAFE_APP_NAME" ]; then
     echo "❌ iOS project structure in an unexpected state. Base template folder '$OLD_IOS_NAME' not found."
     exit 1
  else
    # 4.1 Update Internal Data First (Using Old Paths)
    echo "  - Updating internal data in project files..."
    
    # Podfile
    if [ -f "ios/Podfile" ]; then
      sed_safe "s|target '$OLD_IOS_NAME'|target '$SAFE_APP_NAME'|g" ios/Podfile
    fi

    # Workspace
    if [ -f "ios/$OLD_IOS_NAME.xcworkspace/contents.xcworkspacedata" ]; then
      sed_safe "s|$OLD_IOS_NAME.xcodeproj|$SAFE_APP_NAME.xcodeproj|g" "ios/$OLD_IOS_NAME.xcworkspace/contents.xcworkspacedata"
    fi

    # project.pbxproj
    if [ -f "ios/$OLD_IOS_NAME.xcodeproj/project.pbxproj" ]; then
      sed_safe "s|$OLD_IOS_NAME|$SAFE_APP_NAME|g" "ios/$OLD_IOS_NAME.xcodeproj/project.pbxproj"
      # Update bundle ID and product name
      sed_safe "s|PRODUCT_BUNDLE_IDENTIFIER = $OLD_PACKAGE_ID|PRODUCT_BUNDLE_IDENTIFIER = $PACKAGE_ID|g" "ios/$OLD_IOS_NAME.xcodeproj/project.pbxproj"
      sed_safe "s|PRODUCT_NAME = $OLD_APP_NAME|PRODUCT_NAME = $APP_NAME|g" "ios/$OLD_IOS_NAME.xcodeproj/project.pbxproj"
    fi

    # Scheme
    SCHEME_PATH="ios/$OLD_IOS_NAME.xcodeproj/xcshareddata/xcschemes/$OLD_IOS_NAME.xcscheme"
    if [ -f "$SCHEME_PATH" ]; then
      sed_safe "s|$OLD_IOS_NAME|$SAFE_APP_NAME|g" "$SCHEME_PATH"
    fi

    # Info.plist
    if [ -f "ios/$OLD_IOS_NAME/Info.plist" ]; then
      sed_safe "s|<string>$OLD_APP_NAME</string>|<string>$XML_SAFE_APP_NAME</string>|g" "ios/$OLD_IOS_NAME/Info.plist"
      sed_safe "s|<string>$OLD_SCHEME</string>|<string>$TARGET_SLUG</string>|g" "ios/$OLD_IOS_NAME/Info.plist"
      sed_safe "s|<string>$OLD_PACKAGE_ID</string>|<string>$PACKAGE_ID</string>|g" "ios/$OLD_IOS_NAME/Info.plist"
    fi

    # 4.2 Rename Folders and Project Files (Now that data is updated)
    echo "  - Renaming project folders and files to $SAFE_APP_NAME..."
    
    # Rename internal files synchronously
    [ -f "ios/$OLD_IOS_NAME/$OLD_IOS_NAME.entitlements" ] && mv "ios/$OLD_IOS_NAME/$OLD_IOS_NAME.entitlements" "ios/$OLD_IOS_NAME/$SAFE_APP_NAME.entitlements"
    [ -f "ios/$OLD_IOS_NAME/$OLD_IOS_NAME-Bridging-Header.h" ] && mv "ios/$OLD_IOS_NAME/$OLD_IOS_NAME-Bridging-Header.h" "ios/$OLD_IOS_NAME/$SAFE_APP_NAME-Bridging-Header.h"
    [ -f "$SCHEME_PATH" ] && mv "$SCHEME_PATH" "ios/$OLD_IOS_NAME.xcodeproj/xcshareddata/xcschemes/$SAFE_APP_NAME.xcscheme"

    # Rename main project folders and workspace
    [ -d "ios/$OLD_IOS_NAME" ] && mv "ios/$OLD_IOS_NAME" "ios/$SAFE_APP_NAME"
    [ -d "ios/$OLD_IOS_NAME.xcodeproj" ] && mv "ios/$OLD_IOS_NAME.xcodeproj" "ios/$SAFE_APP_NAME.xcodeproj"
    [ -d "ios/$OLD_IOS_NAME.xcworkspace" ] && mv "ios/$OLD_IOS_NAME.xcworkspace" "ios/$SAFE_APP_NAME.xcworkspace"
  fi
fi

echo "🎉 App Info dynamic setup complete."
