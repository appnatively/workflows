set -e

echo "🔥 Setting up Firebase configuration in $(pwd)..."

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
  echo "⚠️ EXPO_PUBLIC_API_URL not found in secrets. Skipping Firebase setup."
  exit 0
fi

# 2. Fetch config from backend
echo "📡 Fetching config from ${API_URL}/mobile-app/builds/${BUILD_ID}/config"
CONFIG_RESPONSE=$(curl -s "${API_URL}/mobile-app/builds/${BUILD_ID}/config")

# 3. Extract Firebase configs
FIREBASE_ANDROID=$(echo "$CONFIG_RESPONSE" | jq -r '.data.firebase_android // empty')
FIREBASE_IOS=$(echo "$CONFIG_RESPONSE" | jq -r '.data.firebase_ios // empty')

# 4. Inject Android config
if [ -n "$FIREBASE_ANDROID" ]; then
  echo "✅ Injecting google-services.json"
  echo "$FIREBASE_ANDROID" > google-services.json
else
  echo "ℹ️ No firebase_android config found."
fi

# 5. Inject iOS config
if [ -n "$FIREBASE_IOS" ]; then
  echo "✅ Injecting GoogleService-Info.plist"
  # Support both paths
  mkdir -p ios/app
  echo "$FIREBASE_IOS" > ios/app/GoogleService-Info.plist
  echo "$FIREBASE_IOS" > GoogleService-Info.plist
else
  echo "ℹ️ No firebase_ios config found."
fi

echo "🎉 Firebase configuration complete."
