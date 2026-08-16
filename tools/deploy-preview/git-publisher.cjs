'use strict';

/**
 * Git Publisher for GitHub Pages
 * Handles git remote discovery, build artifact discovery, isolated staging, and gh-pages publishing.
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { generateHubHtml, generate404Html } = require('./hub-template.cjs');

function runGit(cmd, cwd, options = {}) {
  try {
    const res = execSync(`git ${cmd}`, {
      cwd,
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : ['pipe', 'pipe', 'pipe'],
      timeout: options.timeout || 60000,
    });
    return { success: true, output: res.trim() };
  } catch (err) {
    return {
      success: false,
      output: err.stdout ? err.stdout.trim() : '',
      error: err.stderr ? err.stderr.trim() : err.message,
    };
  }
}

/**
 * Parses GitHub repository info from remote URL
 * Supports SSH, HTTPS, and git protocols.
 */
function parseGitRemote(remoteUrl) {
  if (!remoteUrl) return null;
  const clean = remoteUrl.trim().replace(/\.git$/, '');

  // https://github.com/owner/repo
  const httpsMatch = clean.match(/^https?:\/\/[^\/]+\/([^\/]+)\/([^\/]+)$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2], rawUrl: remoteUrl };
  }

  // git@github.com:owner/repo
  const sshMatch = clean.match(/^[a-zA-Z0-9_\-]+@[^:]+:([^\/]+)\/([^\/]+)$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2], rawUrl: remoteUrl };
  }

  // ssh://git@github.com/owner/repo
  const sshProtocolMatch = clean.match(/^ssh:\/\/[^\/]+\/([^\/]+)\/([^\/]+)$/i);
  if (sshProtocolMatch) {
    return { owner: sshProtocolMatch[1], repo: sshProtocolMatch[2], rawUrl: remoteUrl };
  }

  return null;
}

function resolveGitInfo(rootDir) {
  const remoteRes = runGit('remote get-url origin', rootDir, { silent: true });
  const remoteUrl = remoteRes.success ? remoteRes.output : '';
  const parsed = parseGitRemote(remoteUrl);

  const branchRes = runGit('rev-parse --abbrev-ref HEAD', rootDir, { silent: true });
  const currentBranch = branchRes.success ? branchRes.output : 'main';

  const shaRes = runGit('rev-parse HEAD', rootDir, { silent: true });
  const commitSha = shaRes.success ? shaRes.output : '';

  const userNameRes = runGit('config user.name', rootDir, { silent: true });
  const userEmailRes = runGit('config user.email', rootDir, { silent: true });

  let repoName = parsed ? parsed.repo : path.basename(rootDir);
  let ownerName = parsed ? parsed.owner : '';
  let githubRepoUrl = parsed ? `https://github.com/${ownerName}/${repoName}` : '';
  let publicBaseUrl = (parsed && ownerName && repoName)
    ? `https://${ownerName.toLowerCase()}.github.io/${repoName}/`
    : `https://pages.github.io/${repoName}/`;

  return {
    remoteUrl,
    parsed,
    currentBranch,
    commitSha,
    userName: userNameRes.success && userNameRes.output ? userNameRes.output : 'Playable Deploy Bot',
    userEmail: userEmailRes.success && userEmailRes.output ? userEmailRes.output : 'deploy-bot@playable.local',
    repoName,
    ownerName,
    githubRepoUrl,
    publicBaseUrl,
  };
}

/**
 * Recursively find all HTML playables in build directory
 */
function discoverPlayableArtifacts(buildDir, briefFilter = null) {
  if (!fs.existsSync(buildDir)) return [];

  const results = [];

  function scan(dir, relativePrefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePrefix, entry.name).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        scan(fullPath, relPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        // Skip root index.html if we generated it previously
        if (relPath === 'index.html' || relPath === '404.html') continue;

        const stat = fs.statSync(fullPath);
        const parts = relPath.split('/');
        
        let brief = 'Main';
        let channel = 'common';

        if (parts.length >= 3) {
          brief = parts[0];
          channel = parts[1];
        } else if (parts.length === 2) {
          brief = parts[0];
          channel = path.basename(parts[1], '.html').split('_').pop() || 'standard';
        } else {
          channel = path.basename(entry.name, '.html').split('_').pop() || 'standard';
        }

        if (briefFilter && brief.toLowerCase() !== briefFilter.toLowerCase()) {
          continue;
        }

        results.push({
          fileName: entry.name,
          brief,
          channel,
          fullPath,
          relativePath: relPath,
          sizeBytes: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }
    }
  }

  scan(buildDir);
  return results.sort((a, b) => a.brief.localeCompare(b.brief) || a.channel.localeCompare(b.channel));
}

/**
 * Copy directory recursively
 */
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

/**
 * Staging & Deployment Execution
 */
function stageAndDeploy(options) {
  const {
    rootDir,
    buildDir,
    briefFilter = null,
    targetBranch = 'gh-pages',
    dryRun = false,
    customDomain = null,
    projectName = 'Cocos Playable Ads',
    log = console.log,
    warn = console.warn,
  } = options;

  const gitInfo = resolveGitInfo(rootDir);
  let publicBaseUrl = customDomain ? `https://${customDomain}/` : gitInfo.publicBaseUrl;
  if (!publicBaseUrl.endsWith('/')) publicBaseUrl += '/';

  // 1. Discover Playable Artifacts
  const artifacts = discoverPlayableArtifacts(buildDir, briefFilter);
  if (artifacts.length === 0) {
    throw new Error(`No HTML playable files found in ${path.relative(rootDir, buildDir)}. Build the project first using "npm run build".`);
  }

  // Attach full URLs to artifacts
  const items = artifacts.map((item) => ({
    ...item,
    fullUrl: `${publicBaseUrl}${item.relativePath}`,
  }));

  // 2. Prepare Isolated Staging Directory in temp
  const stagingDir = path.join(rootDir, 'temp', 'gh-pages-staging');
  if (fs.existsSync(stagingDir)) {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch (e) {
      // If locked, create a timestamped folder
    }
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  // 3. Copy build contents to staging
  copyDirRecursive(buildDir, stagingDir);

  // 4. Generate Mobile Preview Hub index.html & 404.html & .nojekyll
  const hubHtml = generateHubHtml({
    projectName,
    githubRepoUrl: gitInfo.githubRepoUrl,
    publicBaseUrl,
    gitCommitSha: gitInfo.commitSha,
    gitBranch: gitInfo.currentBranch,
    buildTime: new Date().toLocaleString(),
    items,
  });

  const notFoundHtml = generate404Html();

  fs.writeFileSync(path.join(stagingDir, 'index.html'), hubHtml, 'utf8');
  fs.writeFileSync(path.join(stagingDir, '404.html'), notFoundHtml, 'utf8');
  fs.writeFileSync(path.join(stagingDir, '.nojekyll'), '', 'utf8');

  if (customDomain) {
    fs.writeFileSync(path.join(stagingDir, 'CNAME'), customDomain.trim(), 'utf8');
  }

  log(`[deploy-preview] Staged ${items.length} playable variations into temporary staging.`);

  // 5. Git Publish
  if (dryRun) {
    log(`[deploy-preview] [DRY RUN] Skipping git push to ${targetBranch}.`);
    return {
      success: true,
      provider: 'github',
      dryRun: true,
      gitInfo,
      publicBaseUrl,
      items,
      stagingDir,
    };
  }

  if (!gitInfo.remoteUrl) {
    throw new Error('Git remote "origin" not found. Please set up a remote git repository before deploying.');
  }

  log(`[deploy-preview] Initializing isolated staging repository...`);
  runGit('init', stagingDir, { silent: true });
  runGit(`config user.name "${gitInfo.userName}"`, stagingDir, { silent: true });
  runGit(`config user.email "${gitInfo.userEmail}"`, stagingDir, { silent: true });
  runGit(`checkout -B ${targetBranch}`, stagingDir, { silent: true });
  runGit('add -A', stagingDir, { silent: true });

  const commitMsg = `Deploy Playable Ads preview [${new Date().toISOString()}] from ${gitInfo.commitSha ? gitInfo.commitSha.substring(0, 7) : 'local'}`;
  const commitRes = runGit(`commit -m "${commitMsg}"`, stagingDir, { silent: true });

  log(`[deploy-preview] Pushing branch "${targetBranch}" to ${gitInfo.remoteUrl}...`);
  const pushRes = runGit(`push --force "${gitInfo.remoteUrl}" ${targetBranch}`, stagingDir, { timeout: 120000 });

  if (!pushRes.success) {
    throw new Error(`Git push failed: ${pushRes.error || pushRes.output}. Check repository write permissions.`);
  }

  log(`[deploy-preview] Successfully published to branch "${targetBranch}"!`);

  return {
    success: true,
    provider: 'github',
    dryRun: false,
    gitInfo,
    publicBaseUrl,
    items,
    stagingDir,
  };
}

module.exports = {
  resolveGitInfo,
  discoverPlayableArtifacts,
  stageAndDeploy,
  deployToGithub: stageAndDeploy,
};
