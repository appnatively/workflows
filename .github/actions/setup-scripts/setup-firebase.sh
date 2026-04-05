set -e

echo "🔥 Setting up Firebase configuration in $(pwd)..."

# Ensure required environment variables
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

# 3. Extract Firebase configurations from the response (Flat structure)
FIREBASE_ANDROID=$(echo "$CONFIG_RESPONSE" | jq -r '.firebase_android // empty')
FIREBASE_IOS=$(echo "$CONFIG_RESPONSE" | jq -r '.firebase_ios // empty')

# 4. Inject Android Firebase configuration (google-services.json)
if [ -n "$FIREBASE_ANDROID" ]; then
  echo "✅ Injecting google-services.json"
  echo "$FIREBASE_ANDROID" > google-services.json
  
  # Copy to native paths if they exist (supporting both Expo and native Android structures)
  if [ -d "android/app" ]; then
    echo "$FIREBASE_ANDROID" > android/app/google-services.json
  elif [ "$(basename $(pwd))" == "android" ] && [ -d "app" ]; then
    echo "$FIREBASE_ANDROID" > app/google-services.json
  fi
else
  echo "ℹ️ No firebase_android configuration found."
fi

# 5. Inject iOS Firebase configuration (GoogleService-Info.plist)
if [ -n "$FIREBASE_IOS" ]; then
  echo "✅ Injecting GoogleService-Info.plist"
  echo "$FIREBASE_IOS" > GoogleService-Info.plist
  
  # Copy to native paths if they exist
  if [ -d "ios/app" ]; then
    echo "$FIREBASE_IOS" > ios/app/GoogleService-Info.plist
  elif [ "$(basename $(pwd))" == "ios" ] && [ -d "app" ]; then
    echo "$FIREBASE_IOS" > app/GoogleService-Info.plist
  fi
else
  echo "ℹ️ No firebase_ios configuration found."
fi

echo "🎉 Firebase configuration complete."

