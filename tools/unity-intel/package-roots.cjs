'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function packageInfo(dir, fallbackName = null) {
  const json = readJson(path.join(dir, 'package.json')) || {};
  const folder = path.basename(dir);
  const inferred = folder.replace(/@[^/\\]+$/, '');
  return {
    name: typeof json.name === 'string' && json.name ? json.name : (fallbackName || inferred),
    version: typeof json.version === 'string' ? json.version : null,
  };
}

function immediateDirectories(dir) {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => path.join(dir, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch (_) {
    return [];
  }
}

function expectedPackages(projectRoot) {
  const manifest = readJson(path.join(projectRoot, 'Packages', 'manifest.json')) || {};
  const lock = readJson(path.join(projectRoot, 'Packages', 'packages-lock.json')) || {};
  const direct = manifest.dependencies && typeof manifest.dependencies === 'object'
    ? manifest.dependencies
    : {};
  const locked = lock.dependencies && typeof lock.dependencies === 'object'
    ? lock.dependencies
    : {};
  const names = new Set([...Object.keys(direct), ...Object.keys(locked)]);
  return { direct, locked, names };
}

function descriptor(dir, kind, precedence, fallbackName = null) {
  const info = packageInfo(dir, fallbackName);
  let rootStat = null;
  let manifestStat = null;
  try { rootStat = fs.statSync(dir); } catch (_) { /* unavailable root is filtered earlier */ }
  try { manifestStat = fs.statSync(path.join(dir, 'package.json')); } catch (_) { /* optional */ }
  return {
    kind,
    origin: 'package',
    packageName: info.name,
    packageVersion: info.version,
    physicalRoot: path.resolve(dir),
    logicalPrefix: `Packages/${info.name}`,
    precedence,
    indexed: true,
    integrityStamp: [
      rootStat ? rootStat.mtimeMs : 0,
      rootStat ? rootStat.ctimeMs : 0,
      manifestStat ? manifestStat.size : 0,
      manifestStat ? manifestStat.mtimeMs : 0,
      manifestStat ? manifestStat.ctimeMs : 0,
    ].join(':'),
  };
}

function versionExpected(name, expected) {
  const locked = expected.locked[name];
  if (locked && typeof locked.version === 'string') return locked.version;
  const direct = expected.direct[name];
  if (typeof direct === 'string' && /^\d+(?:\.\d+){1,3}(?:[-+].*)?$/.test(direct)) return direct;
  return null;
}

function selectCacheCandidate(candidates, expectedVersion) {
  return [...candidates].sort((a, b) => {
    const aExact = Number(!!expectedVersion && a.packageVersion === expectedVersion);
    const bExact = Number(!!expectedVersion && b.packageVersion === expectedVersion);
    return bExact - aExact || b.packageVersion?.localeCompare(a.packageVersion || '') ||
      a.physicalRoot.localeCompare(b.physicalRoot);
  })[0];
}

function discoverPackageRoots(projectRoot) {
  if (!projectRoot) return { roots: [], unavailable: [], expected: {} };
  const expected = expectedPackages(projectRoot);
  const selected = new Map();
  const packagesDir = path.join(projectRoot, 'Packages');

  for (const dir of immediateDirectories(packagesDir)) {
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
    const item = descriptor(dir, 'embedded-package', 10);
    selected.set(item.packageName, item);
  }

  for (const [name, specifier] of Object.entries(expected.direct)) {
    if (typeof specifier !== 'string' || !specifier.startsWith('file:')) continue;
    const relative = specifier.slice('file:'.length);
    const candidates = [
      path.resolve(projectRoot, relative),
      path.resolve(packagesDir, relative),
    ];
    const dir = candidates.find(candidate => fs.existsSync(path.join(candidate, 'package.json')));
    if (!dir) continue;
    const item = descriptor(dir, 'local-package', 11, name);
    if (!selected.has(item.packageName)) selected.set(item.packageName, item);
  }

  const cacheByName = new Map();
  const packageCache = path.join(projectRoot, 'Library', 'PackageCache');
  for (const dir of immediateDirectories(packageCache)) {
    const item = descriptor(dir, 'package-cache', 20);
    if (expected.names.size && !expected.names.has(item.packageName)) continue;
    if (!cacheByName.has(item.packageName)) cacheByName.set(item.packageName, []);
    cacheByName.get(item.packageName).push(item);
  }
  for (const [name, candidates] of cacheByName) {
    if (selected.has(name)) continue;
    selected.set(name, selectCacheCandidate(candidates, versionExpected(name, expected)));
  }

  const unavailable = [...expected.names]
    .filter(name => !selected.has(name) && !name.startsWith('com.unity.modules.'))
    .sort();
  const roots = [...selected.values()]
    .sort((a, b) => a.precedence - b.precedence || a.packageName.localeCompare(b.packageName));
  return {
    roots,
    unavailable,
    expected: Object.fromEntries([...expected.names].sort().map(name => [name, versionExpected(name, expected)])),
  };
}

module.exports = {
  discoverPackageRoots,
  expectedPackages,
  packageInfo,
};
