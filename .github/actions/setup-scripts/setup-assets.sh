#!/bin/bash
set -e

echo "⬇️ Downloading app assets from Google Drive..."

# Ensure required environment variables
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

# Extract Google Drive access token for API requests from the fetched configuration
# This ensures we always use a fresh token provided by the backend
ACCESS_TOKEN=$(echo "$CONFIG_RESPONSE" | jq -r ".google_drive_access_token // empty")

# Mapping of backend configuration keys to local project file paths
ASSET_KEYS="asset_icon_id asset_splash_id asset_adaptive_foreground_id asset_adaptive_background_id asset_adaptive_monochrome_id"

# Process each defined asset type
for KEY in $ASSET_KEYS; do
  # Determine the destination path based on the key
  case "$KEY" in
    "asset_icon_id") DEST="assets/images/icon.png" ;;
    "asset_splash_id") DEST="assets/images/splash-icon.png" ;;
    "asset_adaptive_foreground_id") DEST="assets/images/android-icon-foreground.png" ;;
    "asset_adaptive_background_id") DEST="assets/images/android-icon-background.png" ;;
    "asset_adaptive_monochrome_id") DEST="assets/images/android-icon-monochrome.png" ;;
    *) continue ;;
  esac

  # Extract the asset value (JSON string or plain ID) from the configuration response
  # New flat structure: jq -r ".$KEY"
  ASSET_VALUE=$(echo "$CONFIG_RESPONSE" | jq -r ".$KEY // empty")
  
  if [ -z "$ASSET_VALUE" ] || [ "$ASSET_VALUE" == "null" ]; then
    echo "⚠️ $KEY not found in configuration, skipping..."
    continue
  fi
  
  # Determine the Google Drive File ID. 
  FILE_ID="$ASSET_VALUE"

  if [ -z "$FILE_ID" ] || [ "$FILE_ID" == "null" ]; then
    echo "⚠️ Valid File ID for $KEY not found in configuration, skipping..."
    continue
  fi
  
  echo "📥 Downloading $KEY ($FILE_ID) to $DEST..."
  
  # Create destination directory if it doesn't exist
  mkdir -p "$(dirname "$DEST")"
  
  # Fetch file content using Google Drive API's media download endpoint
  if curl -sfL -H "Authorization: Bearer $ACCESS_TOKEN" \
    "https://www.googleapis.com/drive/v3/files/$FILE_ID?alt=media" \
    -o "$DEST"; then
    echo "✅ Successfully downloaded $KEY"
  else
    echo "⚠️ Failed to download $KEY (ID: $FILE_ID). This asset will be missing in the build."
  fi
done

# --- Native Asset Synchronization ---
echo "🔄 Syncing assets to native project folders..."
if [ -f "scripts/sync-assets.js" ]; then
  node scripts/sync-assets.js
elif [ -f "./sync-assets.js" ]; then
  node ./sync-assets.js
else
  echo "⚠️ sync-assets.js not found, skipping native sync."
fi


