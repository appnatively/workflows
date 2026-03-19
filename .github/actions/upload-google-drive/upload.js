const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

async function upload() {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.REFRESH_TOKEN
    });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    const filePath = process.env.FILE_PATH;
    const fileName = path.basename(filePath);
    const uniqueName = `${process.env.BUILD_ID}-${fileName}`;
    const folderId = process.env.FOLDER_ID;

    // Debug logging (masked)
    console.log('--- Environment Check ---');
    console.log(`CLIENT_ID: ${process.env.CLIENT_ID ? '✅ Set' : '❌ MISSING'}`);
    console.log(`CLIENT_SECRET: ${process.env.CLIENT_SECRET ? '✅ Set' : '❌ MISSING'}`);
    console.log(`REFRESH_TOKEN: ${process.env.REFRESH_TOKEN ? '✅ Set' : '❌ MISSING'}`);
    console.log(`FOLDER_ID: ${process.env.FOLDER_ID ? `✅ Set (${process.env.FOLDER_ID})` : '❌ MISSING'}`);
    console.log(`FILE_PATH: ${process.env.FILE_PATH ? '✅ Set' : '❌ MISSING'}`);
    console.log(`BUILD_ID: ${process.env.BUILD_ID ? '✅ Set' : '❌ MISSING'}`);
    console.log('-------------------------');

    if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET || !process.env.REFRESH_TOKEN) {
      throw new Error('Required Google Drive credentials are missing or empty.');
    }

    console.log(`📤 Uploading ${uniqueName} to Google Drive folder ${folderId}...`);

    const fileMetadata = {
      name: uniqueName,
      parents: [folderId]
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
