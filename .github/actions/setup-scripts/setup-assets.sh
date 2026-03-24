#!/bin/bash
set -e

echo "⬇️ Downloading app assets from Google Drive..."

# Ensure required environment variables
if [ -z "$BUILD_ID" ]; then
  echo "❌ BUILD_ID not found in environment."
  exit 1
fi

if [ -z "$SECRETS_JSON" ]; then
  echo "❌ SECRETS_JSON not found in environment."
  exit 1
fi

# Extract Google Drive access token for API requests
ACCESS_TOKEN=$(echo "$SECRETS_JSON" | jq -r ".GOOGLE_DRIVE_ACCESS_TOKEN // empty")

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" == "null" ]; then
  echo "⚠️ GOOGLE_DRIVE_ACCESS_TOKEN not found in secrets. Skipping asset download."
  exit 0
fi

# Configuration must be provided by the preceding 'Fetch App Configuration' workflow step
if [ ! -f "app_config.json" ]; then
  echo "❌ app_config.json not found. The 'Fetch App Configuration' step must run before this script."
  exit 1
fi

echo "📖 Loading build configuration..."
CONFIG_RESPONSE=$(cat app_config.json)

# Mapping of backend configuration keys to local project file paths
ASSET_KEYS="asset_icon asset_splash asset_adaptive_foreground asset_adaptive_background asset_adaptive_monochrome"

# Process each defined asset type
for KEY in $ASSET_KEYS; do
  # Determine the destination path based on the key
  case "$KEY" in
    "asset_icon") DEST="assets/images/icon.png" ;;
    "asset_splash") DEST="assets/images/splash-icon.png" ;;
    "asset_adaptive_foreground") DEST="assets/images/android-icon-foreground.png" ;;
    "asset_adaptive_background") DEST="assets/images/android-icon-background.png" ;;
    "asset_adaptive_monochrome") DEST="assets/images/android-icon-monochrome.png" ;;
    *) continue ;;
  esac

  # Extract the asset value (JSON string or plain ID) from the configuration response
  ASSET_VALUE=$(echo "$CONFIG_RESPONSE" | jq -r ".data.$KEY // empty")
  
  if [ -z "$ASSET_VALUE" ] || [ "$ASSET_VALUE" == "null" ]; then
    echo "⚠️ $KEY not found in configuration, skipping..."
    continue
  fi
  
  # Determine the Google Drive File ID. 
  # Backend currently saves this as a JSON string: {"id": "...", "mimeType": "..."}
  if echo "$ASSET_VALUE" | jq -e . >/dev/null 2>&1; then
    FILE_ID=$(echo "$ASSET_VALUE" | jq -r ".id // empty")
  else
    # Fallback for plain string IDs if ever encountered
    FILE_ID="$ASSET_VALUE"
  fi

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


