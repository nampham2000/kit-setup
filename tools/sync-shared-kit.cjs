#!/usr/bin/env node
'use strict';

/**
 * sync-shared-kit.cjs
 * Synchronizes shared packages from `playable-shared-kit/packages/` into `assets/script/shared/`
 * and shared extensions from `playable-shared-kit/packages/extensions/` into `extensions/`.
 * Ensures deterministic, non-destructive .meta generation and preservation for Cocos Creator 3.8.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function getProjectRoot() {
  let curr = __dirname;
  while (curr && curr !== path.dirname(curr)) {
    if (fs.existsSync(path.join(curr, 'package.json')) && fs.existsSync(path.join(curr, 'assets'))) {
      return curr;
    }
    curr = path.dirname(curr);
  }
  return path.resolve(__dirname, '../..');
}

const PROJECT_ROOT = getProjectRoot();
const SHARED_KIT_ROOT = path.join(PROJECT_ROOT, 'playable-shared-kit');
const TARGET_SHARED_DIR = path.join(PROJECT_ROOT, 'assets', 'script', 'shared');
const SHARED_EXTENSIONS_DIR = path.join(SHARED_KIT_ROOT, 'packages', 'extensions');
const TARGET_EXTENSIONS_DIR = path.join(PROJECT_ROOT, 'extensions');

const PACKAGE_MAPPING = [
  { source: path.join(SHARED_KIT_ROOT, 'packages', 'playable-sdk'), dest: path.join(TARGET_SHARED_DIR, 'sdk') },
  { source: path.join(SHARED_KIT_ROOT, 'packages', 'playable-core'), dest: path.join(TARGET_SHARED_DIR, 'core') },
];

function generateUuidFromPath(relPath) {
  const hash = crypto.createHash('md5').update('cc_shared_' + relPath.replace(/\\/g, '/')).digest('hex');
  return `${hash.substr(0, 8)}-${hash.substr(8, 4)}-4${hash.substr(13, 3)}-8${hash.substr(17, 3)}-${hash.substr(20, 12)}`;
}

function ensureDirectoryMeta(dirPath) {
  const metaPath = `${dirPath}.meta`;
  if (!fs.existsSync(metaPath)) {
    const rel = path.relative(PROJECT_ROOT, dirPath);
    const metaContent = {
      ver: '1.2.0',
      importer: 'directory',
      imported: true,
      uuid: generateUuidFromPath(rel),
      files: [],
      subMetas: {},
      userData: {},
    };
    fs.writeFileSync(metaPath, JSON.stringify(metaContent, null, 2) + '\n', 'utf8');
  }
}

function ensureScriptMeta(filePath) {
  const metaPath = `${filePath}.meta`;
  if (!fs.existsSync(metaPath)) {
    const rel = path.relative(PROJECT_ROOT, filePath);
    const metaContent = {
      ver: '4.0.24',
      importer: 'typescript',
      imported: true,
      uuid: generateUuidFromPath(rel),
      files: [],
      subMetas: {},
      userData: {},
    };
    fs.writeFileSync(metaPath, JSON.stringify(metaContent, null, 2) + '\n', 'utf8');
  }
}

function copyDirectoryRecursive(src, dest) {
  if (!fs.existsSync(src)) return;

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  ensureDirectoryMeta(dest);

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'package.json' || entry.name.endsWith('.meta')) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js') || entry.name.endsWith('.json'))) {
      let srcContent = fs.readFileSync(srcPath, 'utf8');
      if (entry.name.endsWith('.ts')) {
        srcContent = srcContent
          .replace(/from\s+['"](?:\.\.\/)?playable-sdk\/(.*?)['"]/g, "from '../sdk/$1'")
          .replace(/from\s+['"](?:\.\.\/)?playable-core\/(.*?)['"]/g, "from '../core/$1'");
      }
      let shouldWrite = true;
      if (fs.existsSync(destPath)) {
        const destContent = fs.readFileSync(destPath, 'utf8');
        if (srcContent === destContent) {
          shouldWrite = false;
        }
      }
      if (shouldWrite) {
        fs.writeFileSync(destPath, srcContent, 'utf8');
      }
      if (entry.name.endsWith('.ts')) {
        ensureScriptMeta(destPath);
      }
    }
  }
}

function copyDirectorySimple(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectorySimple(srcPath, destPath);
    } else if (entry.isFile()) {
      let shouldWrite = true;
      if (fs.existsSync(destPath)) {
        const srcBuf = fs.readFileSync(srcPath);
        const dstBuf = fs.readFileSync(destPath);
        if (srcBuf.equals(dstBuf)) shouldWrite = false;
      }
      if (shouldWrite) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

function syncExtensions() {
  if (!fs.existsSync(SHARED_EXTENSIONS_DIR)) return;
  if (!fs.existsSync(TARGET_EXTENSIONS_DIR)) {
    fs.mkdirSync(TARGET_EXTENSIONS_DIR, { recursive: true });
  }

  console.log('[sync-shared-kit] Syncing editor extensions from shared kit -> extensions/ ...');
  const entries = fs.readdirSync(SHARED_EXTENSIONS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const srcExt = path.join(SHARED_EXTENSIONS_DIR, entry.name);
      const destExt = path.join(TARGET_EXTENSIONS_DIR, entry.name);
      copyDirectorySimple(srcExt, destExt);
      console.log(`  [ok] Synced extension: ${entry.name} -> extensions/${entry.name}`);
    }
  }
}

function generateSharedIndex(destDir) {
  const indexPath = path.join(destDir, 'index.ts');
  const content = `/**
 * @module cc_playable_framework/shared
 * Auto-synced from playable-shared-kit. DO NOT EDIT DIRECTLY.
 * Modify sources in \`playable-shared-kit/packages/\` and run \`npm run sync:shared\`.
 */

// SDK Platforms & Tracking
export * from './sdk';

// Core Game Lifecycle, Audio & Utilities
export * from './core';
`;

  let shouldWrite = true;
  if (fs.existsSync(indexPath)) {
    const existing = fs.readFileSync(indexPath, 'utf8');
    if (existing === content) shouldWrite = false;
  }

  if (shouldWrite) {
    fs.writeFileSync(indexPath, content, 'utf8');
  }
  ensureScriptMeta(indexPath);
}

function syncSharedKit(options = {}) {
  console.log('[sync-shared-kit] Syncing packages from playable-shared-kit -> assets/script/shared ...');

  if (options.clean && fs.existsSync(TARGET_SHARED_DIR)) {
    console.log('[sync-shared-kit] Cleaning existing shared directory...');
    fs.rmSync(TARGET_SHARED_DIR, { recursive: true, force: true });
    if (fs.existsSync(`${TARGET_SHARED_DIR}.meta`)) {
      fs.rmSync(`${TARGET_SHARED_DIR}.meta`, { force: true });
    }
  }

  if (!fs.existsSync(TARGET_SHARED_DIR)) {
    fs.mkdirSync(TARGET_SHARED_DIR, { recursive: true });
  }
  ensureDirectoryMeta(TARGET_SHARED_DIR);

  for (const mapping of PACKAGE_MAPPING) {
    if (fs.existsSync(mapping.source)) {
      copyDirectoryRecursive(mapping.source, mapping.dest);
      console.log(`  [ok] Synced: ${path.basename(mapping.source)} -> ${path.relative(PROJECT_ROOT, mapping.dest)}`);
    } else {
      console.warn(`  [warn] Source package not found: ${mapping.source}`);
    }
  }

  generateSharedIndex(TARGET_SHARED_DIR);
  syncExtensions();
  console.log('[sync-shared-kit] Successfully synchronized shared modules & extensions.\\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const clean = args.includes('--clean');
  syncSharedKit({ clean });
}

module.exports = { syncSharedKit, syncExtensions, TARGET_SHARED_DIR, SHARED_KIT_ROOT, PROJECT_ROOT };
