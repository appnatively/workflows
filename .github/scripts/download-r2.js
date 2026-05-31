#!/usr/bin/env node
/**
 * download-r2.js — Download and extract a release zip from Cloudflare R2.
 *
 * Reads R2 credentials from app_config.json in the current directory.
 * Uses the AWS CLI (aws s3 cp) to download, then unzip to extract.
 */

const fs = require('fs');
const { execSync } = require('child_process');

const CONFIG_FILE = 'app_config.json';

if (!fs.existsSync(CONFIG_FILE)) {
  console.error(`❌ Configuration file not found at ${CONFIG_FILE}. Build bootstrap must run first.`);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
} catch (err) {
  console.error('❌ Failed to parse app_config.json:', err.message);
  process.exit(1);
}

console.log(`📡 Discovering R2 credentials from ${CONFIG_FILE}...`);

const r2AccountId = config.r2_account_id;
const r2Bucket = config.r2_bucket;
const accessKeyId = config.r2_access_key_id;
const secretAccessKey = config.r2_secret_access_key;
const sourceVersion = config.source_version;

if (!r2AccountId || !r2Bucket || !accessKeyId || !secretAccessKey || !sourceVersion) {
  console.error('❌ Missing required R2 credentials in app_config.json.');
  process.exit(1);
}

const rawAppType = config.app_type || 'app';
const fileName = `release-assets-${rawAppType}.zip`;
const endpoint = `https://${r2AccountId}.r2.cloudflarestorage.com`;
const remotePath = `releases/${sourceVersion}/${fileName}`;

console.log(`🎯 Target file name: ${fileName}`);
console.log(`⬇️ Downloading ${remotePath} from R2...`);

const env = {
  ...process.env,
  AWS_ACCESS_KEY_ID: accessKeyId,
  AWS_SECRET_ACCESS_KEY: secretAccessKey,
};

try {
  execSync(
    `aws s3 cp --endpoint-url ${endpoint} s3://${r2Bucket}/${remotePath} ${fileName}`,
    { stdio: 'inherit', env }
  );
} catch (err) {
  console.error('❌ Failed to download from R2.');
  process.exit(1);
}

console.log(`📦 Extracting archive ${fileName}...`);
try {
  execSync(`unzip -qo ${fileName}`, { stdio: 'inherit' });
  fs.rmSync(fileName);
} catch (err) {
  console.error('❌ Failed to extract archive:', err.message);
  process.exit(1);
}

console.log('✅ R2 Asset Synchronization Complete.');
