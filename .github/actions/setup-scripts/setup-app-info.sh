#!/bin/bash
set -e

echo "🚀 Setting up dynamic App Info (Package ID, App Name, Version & Slug) in $(pwd)..."

# 1. Ensure required configuration exists in app_config.json
CONFIG_PATH="app_config.json"
if [ ! -f "$CONFIG_PATH" ] && [ -f "../app_config.json" ]; then
  CONFIG_PATH="../app_config.json"
fi

if [ ! -f "$CONFIG_PATH" ]; then
  echo "❌ Error: app_config.json not found."
  exit 1
fi

# Extract raw values in a single jq pass formatted for shell evaluation
eval "$(jq -r '@sh "PACKAGE_ID=\(.package_id) APP_NAME=\(.app_name) SLUG=\(.app_slug) APP_VERSION=\(.app_version)"' "$CONFIG_PATH")"

# Clean up values (keep only safe characters)
PACKAGE_ID=$(echo "$PACKAGE_ID" | sed 's/[^a-zA-Z0-9._-]//g')
APP_NAME=$(echo "$APP_NAME" | sed 's/[^a-zA-Z0-9 ._-]//g')
SLUG=$(echo "$SLUG" | sed 's/[^a-zA-Z0-9._-]//g')
APP_VERSION=$(echo "$APP_VERSION" | sed 's/[^a-zA-Z0-9._-]//g')

# Enforce that all items are present and valid after sanitization
for var in PACKAGE_ID APP_NAME SLUG APP_VERSION; do
  if [ -z "${!var}" ] || [ "${!var}" = "null" ]; then
    echo "❌ Error: Required configuration key '$var' is missing, empty, or null in $CONFIG_PATH."
    exit 1
  fi
done

echo "✅ Target Package ID: $PACKAGE_ID"
echo "✅ Target App Name: $APP_NAME"
echo "✅ Target Slug: $SLUG"
echo "✅ Target App Version: $APP_VERSION"

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
  
  sed_safe "s|name: \"[^\"]*\"|name: \"$APP_NAME\"|g" app.config.ts
  sed_safe "s|slug: \"[^\"]*\"|slug: \"$SLUG\"|g" app.config.ts
  sed_safe "s|version: \"[^\"]*\"|version: \"$APP_VERSION\"|g" app.config.ts
  sed_safe "s|bundleIdentifier: \"[^\"]*\"|bundleIdentifier: \"$PACKAGE_ID\"|g" app.config.ts
  sed_safe "s|package: \"[^\"]*\"|package: \"$PACKAGE_ID\"|g" app.config.ts
  sed_safe "s|scheme: \"[^\"]*\"|scheme: \"$SLUG\"|g" app.config.ts
fi

echo "🎉 App Info dynamic setup complete."
