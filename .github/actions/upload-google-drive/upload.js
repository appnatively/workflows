const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

async function upload() {
  try {
    // 1. Parsing and validation
    if (!process.env.APPNATIVELY_SECRETS) {
      throw new Error('APPNATIVELY_SECRETS environment variable is missing.');
    }

    let secrets;
    try {
      secrets = JSON.parse(process.env.APPNATIVELY_SECRETS);
    } catch (e) {
      throw new Error(`Failed to parse APPNATIVELY_SECRETS JSON: ${e.message}`);
    }

    const {
      GOOGLE_DRIVE_CLIENT_ID,
      GOOGLE_DRIVE_CLIENT_SECRET,
      GOOGLE_DRIVE_REFRESH_TOKEN,
      GOOGLE_DRIVE_FOLDER_ID,
      GOOGLE_DRIVE_ACCESS_TOKEN,
      GOOGLE_DRIVE_TOKEN_EXPIRY
    } = secrets;

    const workspacePath = process.env.GITHUB_WORKSPACE || process.cwd();
    const rawFilePath = process.env.FILE_PATH;
    const filePath = path.isAbsolute(rawFilePath) ? rawFilePath : path.resolve(workspacePath, rawFilePath);
    const fileName = path.basename(filePath);

    if (!GOOGLE_DRIVE_CLIENT_ID || !GOOGLE_DRIVE_CLIENT_SECRET || !GOOGLE_DRIVE_REFRESH_TOKEN || !GOOGLE_DRIVE_FOLDER_ID) {
      throw new Error('Required Google Drive credentials are missing in APPNATIVELY_SECRETS.');
    }

    // 2. Setup OAuth2 Client
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_DRIVE_CLIENT_ID,
      GOOGLE_DRIVE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      refresh_token: GOOGLE_DRIVE_REFRESH_TOKEN,
      access_token: GOOGLE_DRIVE_ACCESS_TOKEN,
      expiry_date: GOOGLE_DRIVE_TOKEN_EXPIRY ? parseInt(GOOGLE_DRIVE_TOKEN_EXPIRY) : undefined
    });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    const buildId = process.env.BUILD_ID || 'manual';
    
    async function findOrCreateFolder(name, parentId) {
      const query = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`;
      const res = await drive.files.list({
        q: query,
        fields: 'files(id, name)',
        spaces: 'drive'
      });

      if (res.data.files && res.data.files.length > 0) {
        return res.data.files[0].id;
      }

      const folderMetadata = {
        name: name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      };

      const folder = await drive.files.create({
        requestBody: folderMetadata,
        fields: 'id'
      });

      return folder.data.id;
    }

    const buildsFolderId = await findOrCreateFolder('builds', GOOGLE_DRIVE_FOLDER_ID);
    const targetFolderId = await findOrCreateFolder(buildId, buildsFolderId);

    // 4. Perform Upload
    const fileMetadata = {
      name: fileName,
      parents: [targetFolderId]
    };

    const media = {
      mimeType: 'application/octet-stream',
      body: fs.createReadStream(filePath)
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name'
    });

    const fileId = response.data.id;

    // 5. Make file public (but folder remains private)
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

  } catch (error) {
    console.error('❌ Failed to upload to Google Drive:');
    if (error.response && error.response.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}

upload();
