/**
 * utils.js
 * Common utility functions for AppNatively GitHub Action scripts.
 * Pure native Node.js (zero external dependencies).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

// ==========================================
// 1. Logger & Exit Utilities
// ==========================================
const log = {
  info: (msg) => console.log(`📡 ${msg}`),
  success: (msg) => console.log(`✅ ${msg}`),
  warn: (msg) => console.warn(`⚠️ ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  step: (msg) => console.log(`🚀 ${msg}`),
  process: (msg) => console.log(`🏗️ ${msg}`),
  firebase: (msg) => console.log(`🔥 ${msg}`),
  keystore: (msg) => console.log(`🔑 ${msg}`),
};

function fail(message, exitCode = 1) {
  log.error(message);
  process.exit(exitCode);
}

// ==========================================
// 2. Configuration Utilities
// ==========================================
function loadAppConfig(defaultFilename = 'app_config.json') {
  const searchPaths = [
    defaultFilename,
    path.join('..', defaultFilename),
    process.env.GITHUB_WORKSPACE ? path.join(process.env.GITHUB_WORKSPACE, defaultFilename) : null
  ].filter(Boolean);

  let configPath = null;
  for (const p of searchPaths) {
    if (fs.existsSync(p) && fs.lstatSync(p).isFile()) {
      configPath = p;
      break;
    }
  }

  if (!configPath) {
    fail(`Configuration file not found. Checked paths: ${searchPaths.join(', ')}`);
  }

  log.info(`Loading configuration from: ${configPath}`);
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    return { config: JSON.parse(data), configPath };
  } catch (err) {
    fail(`Failed to parse configuration: ${err.message}`);
  }
}

// ==========================================
// 3. HTTP/HTTPS Networking Utilities
// ==========================================
/**
 * Performs a GET/POST request with automated redirect following.
 * Supports binary and text responses.
 */
function request(urlStr, options = {}) {
  const maxRedirects = 5;
  
  return new Promise((resolve, reject) => {
    function executeRequest(targetUrl, redirectCount = 0) {
      if (redirectCount > maxRedirects) {
        return reject(new Error(`Too many redirects (max: ${maxRedirects})`));
      }

      const parsedUrl = new URL(targetUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const reqOptions = {
        method: options.method || 'GET',
        headers: options.headers || {}
      };

      const req = client.request(parsedUrl, reqOptions, (res) => {
        // Handle Redirects (301, 302, 307, 308)
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, targetUrl).toString();
          return executeRequest(redirectUrl, redirectCount + 1);
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Server returned status ${res.statusCode} for ${targetUrl}`));
        }

        // If downloading straight to file stream
        if (options.writeStream) {
          res.pipe(options.writeStream);
          options.writeStream.on('finish', () => resolve(true));
          options.writeStream.on('error', (err) => reject(err));
          return;
        }

        // Otherwise collect buffer
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (options.isBinary) {
            resolve(buffer);
          } else {
            resolve(buffer.toString('utf8'));
          }
        });
      });

      req.on('error', (err) => reject(err));

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    }

    executeRequest(urlStr, 0);
  });
}

/**
 * Downloads a file from a URL to a local destination directory.
 */
async function downloadFile(urlStr, destPath, authHeader = null, isBinary = true) {
  const options = {
    isBinary,
    headers: authHeader ? { 'Authorization': authHeader } : {}
  };
  
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  
  const writeStream = fs.createWriteStream(destPath);
  options.writeStream = writeStream;
  
  try {
    await request(urlStr, options);
    return true;
  } catch (err) {
    writeStream.destroy();
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    throw err;
  }
}

// ==========================================
// 4. Sanitization & Command Runner
// ==========================================
function sanitizeString(val, regex) {
  if (val === null || val === undefined) return '';
  return String(val).replace(regex, '');
}

function runCommand(command, options = {}) {
  try {
    const env = options.env ? { ...process.env, ...options.env } : process.env;
    return execSync(command, { stdio: 'inherit', ...options, env });
  } catch (err) {
    fail(`Command execution failed: "${command}". Error: ${err.message}`);
  }
}

module.exports = {
  log,
  fail,
  loadAppConfig,
  request,
  downloadFile,
  sanitizeString,
  runCommand
};
