'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { EXTRACTOR_FINGERPRINT, hashFile } = require('./cache.cjs');
const { discoverPackageRoots } = require('./package-roots.cjs');

const PROJECT_STATE_SCHEMA_VERSION = 1;
const CONTENT_HASH_EXTENSIONS = new Set([
  '.asmdef', '.asmref', '.cginc', '.compute', '.cs', '.hlsl', '.json', '.shader', '.shadergraph',
]);
const MAX_CONTENT_HASH_BYTES = 2 * 1024 * 1024;

function normalizedRealPath(value) {
  const resolved = path.resolve(value);
  let real = resolved;
  try { real = fs.realpathSync.native(resolved); } catch (_) { /* use resolved path for missing inputs */ }
  const slashed = real.replace(/\\/g, '/');
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function projectKey(projectRoot) {
  return sha256(normalizedRealPath(projectRoot)).slice(0, 32);
}

function fileState(file, logicalPath) {
  let stat;
  try { stat = fs.statSync(file); } catch (_) { return null; }
  const extension = path.extname(file).toLowerCase();
  const shouldHash = CONTENT_HASH_EXTENSIONS.has(extension) && stat.size <= MAX_CONTENT_HASH_BYTES;
  return {
    path: logicalPath.replace(/\\/g, '/'),
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
    ctimeMs: Math.trunc(stat.ctimeMs),
    content: shouldHash ? hashFile(file) : null,
  };
}

function walkRoot(root, logicalPrefix, output) {
  if (!fs.existsSync(root)) return;
  const realRoot = normalizedRealPath(root);
  const stack = [{ physical: path.resolve(root), logical: logicalPrefix }];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current.physical, { withFileTypes: true })
        .sort((left, right) => right.name.localeCompare(left.name));
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === '.svn' || entry.name === '.hg') continue;
      const physical = path.join(current.physical, entry.name);
      const logical = `${current.logical}/${entry.name}`.replace(/^\//, '');
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const realChild = normalizedRealPath(physical);
        if (realChild !== realRoot && !realChild.startsWith(`${realRoot}/`)) continue;
        stack.push({ physical, logical });
        continue;
      }
      if (!entry.isFile()) continue;
      const state = fileState(physical, logical);
      if (state) output.push(state);
    }
  }
}

function computeUnityProjectState(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const entries = [];
  walkRoot(path.join(root, 'Assets'), 'Assets', entries);
  walkRoot(path.join(root, 'Packages'), 'Packages', entries);
  walkRoot(path.join(root, 'ProjectSettings'), 'ProjectSettings', entries);

  if (options.includeLocalPackages !== false) {
    const packages = discoverPackageRoots(root);
    const seen = new Set([
      normalizedRealPath(path.join(root, 'Packages')),
      normalizedRealPath(path.join(root, 'Assets')),
    ]);
    for (const descriptor of packages.roots) {
      if (descriptor.kind !== 'local-package') continue;
      const real = normalizedRealPath(descriptor.physicalRoot);
      if (seen.has(real)) continue;
      seen.add(real);
      walkRoot(descriptor.physicalRoot, `LocalPackages/${descriptor.packageName}`, entries);
    }
    for (const descriptor of packages.roots.filter(item => item.kind === 'package-cache')) {
      const packageJson = path.join(descriptor.physicalRoot, 'package.json');
      const state = fileState(packageJson, `PackageCache/${descriptor.packageName}/package.json`);
      if (state) entries.push(state);
      entries.push({
        path: `PackageCache/${descriptor.packageName}/@integrity`,
        size: 0,
        mtimeMs: 0,
        ctimeMs: 0,
        content: descriptor.integrityStamp || null,
      });
    }
  }

  entries.sort((left, right) => left.path.localeCompare(right.path));
  const payload = JSON.stringify({
    schemaVersion: PROJECT_STATE_SCHEMA_VERSION,
    extractorFingerprint: EXTRACTOR_FINGERPRINT,
    entries,
  });
  return {
    schemaVersion: PROJECT_STATE_SCHEMA_VERSION,
    projectKey: projectKey(root),
    fingerprint: sha256(payload),
    fileCount: entries.length,
    extractorFingerprint: EXTRACTOR_FINGERPRINT,
  };
}

module.exports = {
  PROJECT_STATE_SCHEMA_VERSION,
  CONTENT_HASH_EXTENSIONS,
  MAX_CONTENT_HASH_BYTES,
  normalizedRealPath,
  projectKey,
  fileState,
  computeUnityProjectState,
};
