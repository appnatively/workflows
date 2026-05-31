#!/usr/bin/env node
/**
 * generate-summary.js — Append a build artifact summary to the GitHub Step Summary.
 *
 * Usage:
 *   node ./scripts/generate-summary.js <title> <metric_name> <file_path> <platform> <build_id>
 *
 * Or via environment variables:
 *   SUMMARY_TITLE, SUMMARY_METRIC, SUMMARY_FILE, SUMMARY_PLATFORM, SUMMARY_BUILD_ID
 */

const fs = require('fs');
const { execSync } = require('child_process');

const [title, metric, filePath, platform, buildId] = process.argv.slice(2);

const TITLE = title || process.env.SUMMARY_TITLE;
const METRIC = metric || process.env.SUMMARY_METRIC;
const FILE = filePath || process.env.SUMMARY_FILE;
const PLATFORM = platform || process.env.SUMMARY_PLATFORM;
const BUILD_ID = buildId || process.env.SUMMARY_BUILD_ID;

if (!TITLE || !METRIC || !FILE || !PLATFORM || !BUILD_ID) {
  console.error('❌ Missing required arguments: title, metric_name, file_path, platform, build_id');
  process.exit(1);
}

const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (!summaryFile) {
  console.error('❌ GITHUB_STEP_SUMMARY environment variable is not set. Not running in a GitHub Actions context.');
  process.exit(1);
}

let lines = [
  `## ${TITLE}`,
  '| Metric | Value |',
  '| --- | --- |',
];

if (fs.existsSync(FILE)) {
  let size;
  try {
    // du -h output: "1.2M\tfilename"
    const duOutput = execSync(`du -h "${FILE}"`, { encoding: 'utf8' }).trim();
    size = duOutput.split('\t')[0];
  } catch {
    size = 'Unknown';
  }
  lines.push(`| ${METRIC} | ${size} |`);
  lines.push('| Status | ✅ Success |');
} else {
  lines.push('| Status | ❌ Failed |');
}

lines.push(`| Platform | ${PLATFORM} |`);
lines.push(`| Build ID | ${BUILD_ID} |`);

fs.appendFileSync(summaryFile, lines.join('\n') + '\n');
console.log(`✅ Summary appended to ${summaryFile}`);
