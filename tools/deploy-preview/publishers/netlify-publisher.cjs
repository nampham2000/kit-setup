'use strict';

/**
 * Netlify Publisher for Playable Ads Live Preview
 * Supports zero-dependency Netlify CLI / REST API deployments with _headers & _redirects config.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync, execSync } = require('child_process');
const { generateHubHtml, generate404Html } = require('../hub-template.cjs');
const { discoverPlayableArtifacts } = require('../git-publisher.cjs');

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function generateNetlifyHeaders() {
  return `/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, OPTIONS
  Access-Control-Allow-Headers: Content-Type
  X-Frame-Options: SAMEORIGIN
`;
}

function generateNetlifyRedirects() {
  return `/*  /index.html  200
`;
}

function generateNetlifyToml() {
  return `[build]
  publish = "."

[[headers]]
  for = "/*"
  [headers.values]
    Access-Control-Allow-Origin = "*"
    X-Frame-Options = "SAMEORIGIN"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
`;
}

/**
 * Check if Netlify CLI or credentials are ready
 */
function checkNetlifyEnv() {
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN || '';
  const siteId = process.env.NETLIFY_SITE_ID || '';
  return { token, siteId, hasToken: Boolean(token) };
}

/**
 * Deploy to Netlify
 */
function deployToNetlify(options) {
  const {
    rootDir,
    buildDir,
    briefFilter = null,
    dryRun = false,
    projectName = 'cc-playable',
    siteNameOverride = null,
    log = console.log,
    warn = console.warn,
  } = options;

  const env = checkNetlifyEnv();
  const normalizedProjectName = (siteNameOverride || projectName || 'playable')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/^-+|-+$/g, '');

  let siteSubdomain = normalizedProjectName;
  if (env.siteId && env.siteId.length > 20) {
    siteSubdomain = normalizedProjectName;
  }
  let publicBaseUrl = `https://${siteSubdomain}.netlify.app/`;

  // 1. Discover Playable Artifacts
  const artifacts = discoverPlayableArtifacts(buildDir, briefFilter);
  if (artifacts.length === 0) {
    throw new Error(`No HTML playable files found in ${path.relative(rootDir, buildDir)}. Run "npm run build" first.`);
  }

  // 2. Prepare Isolated Staging Directory
  const stagingDir = path.join(rootDir, 'temp', 'netlify-staging');
  if (fs.existsSync(stagingDir)) {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch (e) {}
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  // 3. Copy build files
  copyDirRecursive(buildDir, stagingDir);

  const items = artifacts.map((item) => ({
    ...item,
    fullUrl: `${publicBaseUrl}${item.relativePath}`,
  }));

  // 4. Generate Hub HTML & Netlify configuration files
  const hubHtml = generateHubHtml({
    projectName,
    githubRepoUrl: '',
    publicBaseUrl,
    gitCommitSha: '',
    gitBranch: 'netlify',
    buildTime: new Date().toLocaleString(),
    items,
  });

  fs.writeFileSync(path.join(stagingDir, 'index.html'), hubHtml, 'utf8');
  fs.writeFileSync(path.join(stagingDir, '404.html'), generate404Html(), 'utf8');
  fs.writeFileSync(path.join(stagingDir, '_headers'), generateNetlifyHeaders(), 'utf8');
  fs.writeFileSync(path.join(stagingDir, '_redirects'), generateNetlifyRedirects(), 'utf8');
  fs.writeFileSync(path.join(stagingDir, 'netlify.toml'), generateNetlifyToml(), 'utf8');

  log(`[deploy-netlify] Prepared ${items.length} playable variations in temporary staging.`);

  if (dryRun) {
    log(`[deploy-netlify] [DRY RUN] Skipping Netlify upload.`);
    return {
      success: true,
      provider: 'netlify',
      dryRun: true,
      publicBaseUrl,
      items,
      stagingDir,
    };
  }

  log(`[deploy-netlify] Deploying to Netlify via netlify-cli...`);

  const cliArgs = ['--yes', 'netlify-cli', 'deploy', '--dir', stagingDir, '--prod'];
  if (env.token) {
    cliArgs.push('--auth', env.token);
  }
  if (env.siteId) {
    cliArgs.push('--site', env.siteId);
  }

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const deployRes = spawnSync(npxCmd, cliArgs, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
  });

  const stdout = deployRes.stdout || '';
  const stderr = deployRes.stderr || '';

  if (deployRes.status !== 0) {
    // If auth error, explain how to set NETLIFY_AUTH_TOKEN
    if (stdout.includes('Not logged in') || stderr.includes('Not logged in') || !env.hasToken) {
      throw new Error(
        `Netlify authentication required. Please set NETLIFY_AUTH_TOKEN in environment or run "npx netlify-cli login" once.`
      );
    }
    throw new Error(`Netlify deployment failed: ${stderr || stdout}`);
  }

  // Parse deployed URL from Netlify CLI output if available
  const urlMatch = stdout.match(/Website URL:\s+(https:\/\/[^\s]+)/i)
    || stdout.match(/URL:\s+(https:\/\/[^\s]+)/i)
    || stdout.match(/(https:\/\/[a-zA-Z0-9-]+\.netlify\.app)/i);

  if (urlMatch) {
    publicBaseUrl = urlMatch[1].trim();
    if (!publicBaseUrl.endsWith('/')) publicBaseUrl += '/';
  }

  log(`[deploy-netlify] Successfully deployed to Netlify! URL: ${publicBaseUrl}`);

  const finalItems = artifacts.map((item) => ({
    ...item,
    fullUrl: `${publicBaseUrl}${item.relativePath}`,
  }));

  return {
    success: true,
    provider: 'netlify',
    dryRun: false,
    publicBaseUrl,
    items: finalItems,
    stagingDir,
  };
}

module.exports = {
  checkNetlifyEnv,
  deployToNetlify,
};
