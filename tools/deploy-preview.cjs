#!/usr/bin/env node
'use strict';

/**
 * Playable Ads Multi-Platform Deploy Preview Tool
 *
 * Deploys Cocos Playable HTML5 builds to:
 * - GitHub Pages (gh-pages branch)
 * - Netlify (netlify.app)
 * - Vercel (vercel.app)
 *
 * Generates live public preview URLs with terminal ANSI QR Codes
 * for instant mobile web testing.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, exec } = require('child_process');
const { toTerminalString } = require('./deploy-preview/qr-generator.cjs');
const { stageAndDeploy: deployToGithub, resolveGitInfo, discoverPlayableArtifacts } = require('./deploy-preview/git-publisher.cjs');
const { deployToNetlify, checkNetlifyEnv } = require('./deploy-preview/publishers/netlify-publisher.cjs');
const { deployToVercel, checkVercelEnv } = require('./deploy-preview/publishers/vercel-publisher.cjs');

function getProjectRoot() {
  let curr = __dirname;
  while (curr && curr !== path.dirname(curr)) {
    if (fs.existsSync(path.join(curr, 'package.json')) && (fs.existsSync(path.join(curr, 'assets')) || fs.existsSync(path.join(curr, 'playable-shared-kit')))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return path.resolve(__dirname, '../..');
}

const ROOT_DIR = getProjectRoot();
const BUILD_DIR = path.join(ROOT_DIR, 'build');

function getProjectName() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    return pkg.name || 'Cocos Playable Ad';
  } catch (e) {
    return 'Cocos Playable Ad';
  }
}

function printBanner() {
  console.log(`
\x1b[36m================================================================================\x1b[0m
\x1b[1m\x1b[32m🚀 PLAYABLE ADS MULTI-PLATFORM LIVE PREVIEW DEPLOYER\x1b[0m
\x1b[36m================================================================================\x1b[0m`);
}

function printHelp() {
  printBanner();
  console.log(`
Usage:
  node playable-shared-kit/tools/deploy-preview.cjs [options]
  npm run deploy
  npm run deploy:github
  npm run deploy:netlify
  npm run deploy:vercel
  npm run deploy:build

Options:
  --provider <p>       Deployment provider: "github" (default), "netlify", "vercel", or "all".
  --build              Build playables before deploying (if build/ is empty, auto-builds).
  --brief <name>       Deploy a specific brief name (e.g. --brief Sample).
  --branch <name>      Target deployment branch for GitHub Pages (default: "gh-pages").
  --dry-run            Generate preview hub & print QR code locally without publishing.
  --custom-domain <d>  Configure a custom domain for GitHub Pages / Netlify / Vercel.
  --open               Automatically open live preview URL in default web browser.
  --doctor             Validate credentials, environment, and platform status.
  --help, -h           Show this help manual.

Examples:
  npm run deploy                          # Deploy to GitHub Pages (default)
  npm run deploy:netlify                  # Deploy to Netlify
  npm run deploy:vercel                   # Deploy to Vercel
  node playable-shared-kit/tools/deploy-preview.cjs --provider all
  node playable-shared-kit/tools/deploy-preview.cjs --provider netlify --dry-run
  node playable-shared-kit/tools/deploy-preview.cjs --provider vercel --open
`);
}

function openBrowser(url) {
  const startCmd = process.platform === 'win32' ? `start "" "${url}"` : (process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`);
  exec(startCmd, () => {});
}

function runAutoBuild(briefFilter = null) {
  console.log('\n\x1b[33m[deploy-preview] 🔨 Building playable project before deployment...\x1b[0m');
  const buildScript = path.join(__dirname, 'playable-build.cjs');
  const args = [buildScript, 'build'];
  if (briefFilter) {
    args.push('--brief', briefFilter);
  } else {
    args.push('--all');
  }

  const res = spawnSync(process.execPath, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });

  if (res.status !== 0) {
    console.error('\x1b[31m[deploy-preview] ❌ Build failed. Please fix build errors before deploying.\x1b[0m');
    process.exit(1);
  }
}

function runDoctor() {
  printBanner();
  console.log('\x1b[1m🔍 Running Multi-Platform Deployment Diagnostics...\x1b[0m\n');

  console.log(`📁 Project Root:     ${ROOT_DIR}`);
  
  // 1. GitHub Diagnostics
  const gitInfo = resolveGitInfo(ROOT_DIR);
  console.log(`\n\x1b[36m[GitHub Pages Diagnostics]\x1b[0m`);
  console.log(`🌿 Current Branch:   ${gitInfo.currentBranch}`);
  console.log(`🔗 Remote Origin:    ${gitInfo.remoteUrl || '\x1b[31m(None detected - run git remote add origin <url>)\x1b[0m'}`);
  console.log(`👤 Committer:        ${gitInfo.userName} <${gitInfo.userEmail}>`);
  console.log(`🌐 Expected Pages:   \x1b[32m${gitInfo.publicBaseUrl}\x1b[0m`);

  // 2. Netlify Diagnostics
  const netlifyEnv = checkNetlifyEnv();
  console.log(`\n\x1b[36m[Netlify Diagnostics]\x1b[0m`);
  console.log(`🔑 NETLIFY_AUTH_TOKEN: ${netlifyEnv.hasToken ? '\x1b[32mConfigured\x1b[0m' : '\x1b[33mNot set (will prompt via Netlify CLI if needed)\x1b[0m'}`);
  console.log(`🏷️ NETLIFY_SITE_ID:    ${netlifyEnv.siteId || '(Auto-create / prompt)'}`);

  // 3. Vercel Diagnostics
  const vercelEnv = checkVercelEnv();
  console.log(`\n\x1b[36m[Vercel Diagnostics]\x1b[0m`);
  console.log(`🔑 VERCEL_TOKEN:        ${vercelEnv.hasToken ? '\x1b[32mConfigured\x1b[0m' : '\x1b[33mNot set (will prompt via Vercel CLI if needed)\x1b[0m'}`);
  console.log(`🏢 VERCEL_PROJECT_ID:   ${vercelEnv.projectId || '(Auto-link / prompt)'}`);

  // 4. Build Artifacts
  const artifacts = discoverPlayableArtifacts(BUILD_DIR);
  console.log(`\n📦 Build Output Status: ${BUILD_DIR}`);
  if (artifacts.length === 0) {
    console.log('   \x1b[33m⚠️ No HTML playables found in build/. Run "npm run build" to compile.\x1b[0m');
  } else {
    console.log(`   \x1b[32m✅ Found ${artifacts.length} playable file(s):\x1b[0m`);
    artifacts.forEach((a) => {
      console.log(`     - [${a.brief}] [${a.channel}] ${a.fileName} (${(a.sizeBytes / 1024).toFixed(1)} KB)`);
    });
  }

  console.log('\n\x1b[32m✅ Diagnostics complete.\x1b[0m\n');
}

function deployProvider(provider, options) {
  const normalized = String(provider).trim().toLowerCase();

  switch (normalized) {
    case 'github':
    case 'gh-pages':
      return deployToGithub(options);
    case 'netlify':
      return deployToNetlify(options);
    case 'vercel':
      return deployToVercel(options);
    default:
      throw new Error(`Unsupported deployment provider: "${provider}". Choose from: github, netlify, vercel, all.`);
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args.includes('--doctor')) {
    runDoctor();
    return;
  }

  // Parse Provider
  let providerArg = 'github';
  const providerIdx = args.indexOf('--provider');
  if (providerIdx !== -1 && args[providerIdx + 1]) {
    providerArg = args[providerIdx + 1].trim().toLowerCase();
  } else if (args.includes('--netlify')) {
    providerArg = 'netlify';
  } else if (args.includes('--vercel')) {
    providerArg = 'vercel';
  } else if (args.includes('--github')) {
    providerArg = 'github';
  }

  let briefFilter = null;
  const briefIdx = args.indexOf('--brief');
  if (briefIdx !== -1 && args[briefIdx + 1]) {
    briefFilter = args[briefIdx + 1].trim();
  }

  let targetBranch = 'gh-pages';
  const branchIdx = args.indexOf('--branch');
  if (branchIdx !== -1 && args[branchIdx + 1]) {
    targetBranch = args[branchIdx + 1].trim();
  }

  let customDomain = null;
  const domainIdx = args.indexOf('--custom-domain');
  if (domainIdx !== -1 && args[domainIdx + 1]) {
    customDomain = args[domainIdx + 1].trim();
  }

  const dryRun = args.includes('--dry-run');
  const shouldOpen = args.includes('--open');
  const forceBuild = args.includes('--build');

  printBanner();

  // Check if build artifacts exist
  let artifacts = discoverPlayableArtifacts(BUILD_DIR, briefFilter);
  if (artifacts.length === 0 || forceBuild) {
    if (artifacts.length === 0) {
      console.log('\x1b[33m[deploy-preview] No existing playable builds found in ./build. Triggering auto-build...\x1b[0m');
    }
    runAutoBuild(briefFilter);
    artifacts = discoverPlayableArtifacts(BUILD_DIR, briefFilter);
  }

  if (artifacts.length === 0) {
    console.error(`\x1b[31m[deploy-preview] ERROR: No playable HTML files found in ${BUILD_DIR}.\x1b[0m`);
    process.exit(1);
  }

  const providersToDeploy = providerArg === 'all'
    ? ['github', 'netlify', 'vercel']
    : [providerArg];

  const deploymentResults = [];

  for (const provider of providersToDeploy) {
    console.log(`\n\x1b[36m================================================================================\x1b[0m`);
    console.log(`\x1b[1m\x1b[33m🚀 Deploying to Provider: [${provider.toUpperCase()}]\x1b[0m`);
    console.log(`\x1b[36m================================================================================\x1b[0m`);

    try {
      const result = deployProvider(provider, {
        rootDir: ROOT_DIR,
        buildDir: BUILD_DIR,
        briefFilter,
        targetBranch,
        dryRun,
        customDomain,
        projectName: getProjectName(),
        log: (msg) => console.log(`  ${msg}`),
        warn: (msg) => console.warn(`  \x1b[33m${msg}\x1b[0m`),
      });

      deploymentResults.push(result);
      const publicUrl = result.publicBaseUrl;

      console.log(`
\x1b[32m================================================================================\x1b[0m
\x1b[1m\x1b[32m🎉 [${provider.toUpperCase()}] DEPLOYMENT SUCCESSFUL! LIVE PREVIEW IS READY\x1b[0m
\x1b[32m================================================================================\x1b[0m

🌐 \x1b[1m${provider.toUpperCase()} Web Hub URL:\x1b[0m
   \x1b[4m\x1b[36m${publicUrl}\x1b[0m

🎯 \x1b[1mDirect Playable Variations:\x1b[0m`);

      result.items.forEach((item) => {
        console.log(`   • \x1b[33m[${item.brief}]\x1b[0m \x1b[35m[${item.channel}]\x1b[0m: \x1b[36m${item.fullUrl}\x1b[0m (${(item.sizeBytes / 1024).toFixed(1)} KB)`);
      });

      console.log(`
📱 \x1b[1m\x1b[32mSCAN WITH MOBILE PHONE CAMERA TO PREVIEW IMMEDIATELY ON [${provider.toUpperCase()}]:\x1b[0m
`);

      // Render ANSI QR Code in Terminal
      try {
        const qrAscii = toTerminalString(publicUrl, { ecLevel: 'M', quietZone: 2 });
        console.log(qrAscii);
      } catch (qrErr) {
        console.warn('   (Terminal QR rendering skipped: ' + qrErr.message + ')');
      }

      if (shouldOpen && !dryRun) {
        console.log(`[deploy-preview] Opening browser: ${publicUrl}`);
        openBrowser(publicUrl);
      }
    } catch (err) {
      console.error(`\n\x1b[31m[deploy-${provider}] DEPLOY ERROR: ${err.message}\x1b[0m\n`);
      if (providersToDeploy.length === 1) {
        process.exit(1);
      }
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  deployProvider,
  deployToGithub,
  deployToNetlify,
  deployToVercel,
};
