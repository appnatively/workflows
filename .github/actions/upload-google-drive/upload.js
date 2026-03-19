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
    const uniqueName = `${process.env.BUILD_ID || 'manual'}-${fileName}`;

    // Debug logging (masked)
    console.log('--- Environment Check ---');
    console.log(`CLIENT_ID: ${GOOGLE_DRIVE_CLIENT_ID ? '✅ Set' : '❌ MISSING'}`);
    console.log(`CLIENT_SECRET: ${GOOGLE_DRIVE_CLIENT_SECRET ? '✅ Set' : '❌ MISSING'}`);
    console.log(`REFRESH_TOKEN: ${GOOGLE_DRIVE_REFRESH_TOKEN ? '✅ Set' : '❌ MISSING'}`);
    console.log(`ACCESS_TOKEN: ${GOOGLE_DRIVE_ACCESS_TOKEN ? '✅ Set' : 'ℹ️ Not Provided (Refreshing...)'}`);
    console.log(`FOLDER_ID: ${GOOGLE_DRIVE_FOLDER_ID ? `✅ Set` : '❌ MISSING'}`);
    console.log(`FILE_PATH: ${filePath ? '✅ Set' : '❌ MISSING'}`);
    console.log('-------------------------');

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
    
    // 3. Perform Upload
    console.log(`📤 Uploading ${uniqueName} to Google Drive folder ${GOOGLE_DRIVE_FOLDER_ID}...`);

    const fileMetadata = {
      name: uniqueName,
      parents: [GOOGLE_DRIVE_FOLDER_ID]
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

    console.log(`✅ Successfully uploaded to Google Drive. File ID: ${response.data.id}`);
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
