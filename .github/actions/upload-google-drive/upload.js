const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

/**
 * 🛠️ Configuration Loader
 * Loads and validates app_config.json from the workspace
 */
function loadConfig() {
  const workspacePath = process.env.GITHUB_WORKSPACE || process.cwd();
  const configPath = path.resolve(workspacePath, 'app_config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`❌ Configuration file not found at ${configPath}`);
  }

  console.log(`📖 Loading configuration from ${configPath}`);
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // Required fields check
    const required = [
      'google_drive_client_id',
      'google_drive_client_secret',
      'google_drive_refresh_token',
      'google_drive_folder_id'
    ];
    
    const missing = required.filter(key => !config[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required configuration keys: ${missing.join(', ')}`);
    }

    return { config, workspacePath };
  } catch (error) {
    throw new Error(`❌ Failed to parse config JSON: ${error.message}`);
  }
}

/**
 * 🔐 Drive Client Initializer
 * Sets up the Google Drive API client with OAuth2
 */
function initDriveClient(config) {
  const oauth2Client = new google.auth.OAuth2(
    config.google_drive_client_id,
    config.google_drive_client_secret
  );

  oauth2Client.setCredentials({
    refresh_token: config.google_drive_refresh_token,
    access_token: config.google_drive_access_token,
    expiry_date: config.google_drive_token_expiry ? parseInt(config.google_drive_token_expiry) : undefined
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * 📁 Folder Manager
 * Robustly finds or creates a folder within a parent
 */
async function findOrCreateFolder(drive, name, parentId) {
  const query = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`;
  
  const res = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    spaces: 'drive'
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  console.log(`📂 Creating folder: "${name}"`);
  const folder = await drive.files.create({
    requestBody: {
      name: name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    },
    fields: 'id'
  });

  return folder.data.id;
}

/**
 * 📦 File Uploader
 * Uploads a file and makes it public
 */
async function uploadFile(drive, filePath, folderId) {
  const fileName = path.basename(filePath);
  console.log(`📥 Uploading artifact: "${fileName}"`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`❌ File not found for upload: ${filePath}`);
  }

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId]
    },
    media: {
      mimeType: 'application/octet-stream',
      body: fs.createReadStream(filePath)
    },
    fields: 'id, name'
  });

  const fileId = response.data.id;
  console.log(`✅ File uploaded successfully. ID: ${fileId}`);

  console.log(`🌍 Setting public permissions...`);
  await drive.permissions.create({
    fileId: fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  return fileId;
}

/**
 * 🚀 Main Entry Point
 */
async function main() {
  try {
    const { config, workspacePath } = loadConfig();
    const drive = initDriveClient(config);

    const buildId = process.env.BUILD_ID || 'manual';
    const rawFilePath = process.env.FILE_PATH;
    
    if (!rawFilePath) {
      throw new Error('❌ FILE_PATH environment variable is missing.');
    }

    const filePath = path.isAbsolute(rawFilePath) ? rawFilePath : path.resolve(workspacePath, rawFilePath);

    // 1. Ensure Folder Structure: builds/ -> :buildId/
    const buildsFolderId = await findOrCreateFolder(drive, 'builds', config.google_drive_folder_id);
    const targetFolderId = await findOrCreateFolder(drive, buildId, buildsFolderId);

    // 2. Perform Upload
    await uploadFile(drive, filePath, targetFolderId);

    console.log('🎉 Job complete!');
  } catch (error) {
    console.error('\n❌ Google Drive Upload Failed:');
    if (error.response && error.response.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}

main();
