'use strict';

/**
 * Vercel Publisher for Playable Ads Live Preview
 * Supports zero-dependency Vercel CLI / REST API deployments with vercel.json headers & routes.
 */

const fs = require('fs');
const path = require('path');
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

function generateVercelConfig() {
  return JSON.stringify({
    version: 2,
    cleanUrls: true,
    routes: [
      { handle: 'filesystem' },
      { src: '/(.*)', dest: '/index.html' },
    ],
    headers: [
      {
        source: '/(.*)',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ],
  }, null, 2);
}

/**
 * Check if Vercel CLI or credentials are ready
 */
function checkVercelEnv() {
  const token = process.env.VERCEL_TOKEN || process.env.VERCEL_AUTH_TOKEN || '';
  const orgId = process.env.VERCEL_ORG_ID || '';
  const projectId = process.env.VERCEL_PROJECT_ID || '';
  return { token, orgId, projectId, hasToken: Boolean(token) };
}

/**
 * Deploy to Vercel
 */
function deployToVercel(options) {
  const {
    rootDir,
    buildDir,
    briefFilter = null,
    dryRun = false,
    projectName = 'cc-playable',
    projectNameOverride = null,
    log = console.log,
    warn = console.warn,
  } = options;

  const env = checkVercelEnv();
  const normalizedProjectName = (projectNameOverride || projectName || 'playable')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/^-+|-+$/g, '');

  let publicBaseUrl = `https://${normalizedProjectName}.vercel.app/`;

  // 1. Discover Playable Artifacts
  const artifacts = discoverPlayableArtifacts(buildDir, briefFilter);
  if (artifacts.length === 0) {
    throw new Error(`No HTML playable files found in ${path.relative(rootDir, buildDir)}. Run "npm run build" first.`);
  }

  // 2. Prepare Isolated Staging Directory
  const stagingDir = path.join(rootDir, 'temp', 'vercel-staging');
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

  // 4. Generate Hub HTML & vercel.json
  const hubHtml = generateHubHtml({
    projectName,
    githubRepoUrl: '',
    publicBaseUrl,
    gitCommitSha: '',
    gitBranch: 'vercel',
    buildTime: new Date().toLocaleString(),
    items,
  });

  fs.writeFileSync(path.join(stagingDir, 'index.html'), hubHtml, 'utf8');
  fs.writeFileSync(path.join(stagingDir, '404.html'), generate404Html(), 'utf8');
  fs.writeFileSync(path.join(stagingDir, 'vercel.json'), generateVercelConfig(), 'utf8');

  log(`[deploy-vercel] Prepared ${items.length} playable variations in temporary staging.`);

  if (dryRun) {
    log(`[deploy-vercel] [DRY RUN] Skipping Vercel upload.`);
    return {
      success: true,
      provider: 'vercel',
      dryRun: true,
      publicBaseUrl,
      items,
      stagingDir,
    };
  }

  log(`[deploy-vercel] Deploying to Vercel via vercel CLI...`);

  const cliArgs = ['--yes', 'vercel', stagingDir, '--prod', '--yes', '--name', normalizedProjectName];
  if (env.token) {
    cliArgs.push('--token', env.token);
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
    if (stdout.includes('Error: Log in') || stderr.includes('Error: Log in') || !env.hasToken) {
      throw new Error(
        `Vercel authentication required. Please set VERCEL_TOKEN in environment or run "npx vercel login" once.`
      );
    }
    throw new Error(`Vercel deployment failed: ${stderr || stdout}`);
  }

  // Parse deployed URL from Vercel CLI output
  const urlMatch = stdout.match(/Production:\s+(https:\/\/[^\s]+)/i)
    || stdout.match(/(https:\/\/[a-zA-Z0-9-]+\.vercel\.app)/i)
    || stdout.match(/(https:\/\/[a-zA-Z0-9-]+\.vercel\.app)/);

  if (urlMatch) {
    publicBaseUrl = urlMatch[1].trim();
    if (!publicBaseUrl.endsWith('/')) publicBaseUrl += '/';
  }

  log(`[deploy-vercel] Successfully deployed to Vercel! URL: ${publicBaseUrl}`);

  const finalItems = artifacts.map((item) => ({
    ...item,
    fullUrl: `${publicBaseUrl}${item.relativePath}`,
  }));

  return {
    success: true,
    provider: 'vercel',
    dryRun: false,
    publicBaseUrl,
    items: finalItems,
    stagingDir,
  };
}

module.exports = {
  checkVercelEnv,
  deployToVercel,
};
