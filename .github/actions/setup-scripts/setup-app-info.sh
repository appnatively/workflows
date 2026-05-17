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

# --- 2. Update app.config.ts ---
if [ -f "app.config.ts" ]; then
  echo "📝 Updating app.config.ts with sed..."
  TARGET_SLUG="${SLUG:-$APP_NAME}"
  
  sed_safe "s|name: \"$OLD_APP_NAME\"|name: \"$APP_NAME\"|g" app.config.ts
  sed_safe "s|slug: \"$OLD_SLUG\"|slug: \"$TARGET_SLUG\"|g" app.config.ts
  sed_safe "s|bundleIdentifier: \"$OLD_PACKAGE_ID\"|bundleIdentifier: \"$PACKAGE_ID\"|g" app.config.ts
  sed_safe "s|package: \"$OLD_PACKAGE_ID\"|package: \"$PACKAGE_ID\"|g" app.config.ts
  sed_safe "s|scheme: \"$OLD_SCHEME\"|scheme: \"$TARGET_SLUG\"|g" app.config.ts
fi

echo "🎉 App Info dynamic setup complete."
