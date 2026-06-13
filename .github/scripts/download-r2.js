#!/usr/bin/env node
/**
 * download-r2.js — Download and extract a release zip from Cloudflare R2.
 *
 * Reads R2 credentials from app_config.json in the current directory.
 * Uses the AWS CLI (aws s3 cp) to download, then unzip to extract.
 */

const fs = require('fs');
const { loadAppConfig, runCommand, log, fail } = require('./utils');

const { config } = loadAppConfig();

log.info('Discovering R2 credentials...');

const r2AccountId = config.r2_account_id;
const r2Bucket = config.r2_bucket;
const accessKeyId = config.r2_access_key_id;
const secretAccessKey = config.r2_secret_access_key;
const sourceVersion = config.source_version;

if (!r2AccountId || !r2Bucket || !accessKeyId || !secretAccessKey || !sourceVersion) {
  fail('Missing required R2 credentials in app_config.json.');
}

const rawAppType = config.app_type || 'app';
const fileName = `release-assets-${rawAppType}.zip`;
const endpoint = `https://${r2AccountId}.r2.cloudflarestorage.com`;
const remotePath = `${sourceVersion}/${fileName}`;

console.log(`🎯 Target file name: ${fileName}`);
log.info(`Downloading ${remotePath} from R2...`);

const env = {
  AWS_ACCESS_KEY_ID: accessKeyId,
  AWS_SECRET_ACCESS_KEY: secretAccessKey,
};

runCommand(
  `aws s3 cp --endpoint-url ${endpoint} s3://${r2Bucket}/${remotePath} ${fileName}`,
  { env }
);

log.process(`Extracting archive ${fileName}...`);
runCommand(`unzip -qo ${fileName}`);
fs.rmSync(fileName);

log.success('R2 Asset Synchronization Complete.');
