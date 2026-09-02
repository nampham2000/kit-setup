'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CACHE_SCHEMA_VERSION = 2;
// Version 4 adds Unity engine-feature evidence to the serialized record
// contract and content-bound stamps for every textual/serialized asset plus
// its .meta. Coarse-timestamp filesystems such as exFAT must not reuse stale
// evidence after same-size content replacement.
const INDEXER_VERSION = 4;

const EXTRACTOR_FILES = [
  'schema.cjs',
  'cache.cjs',
  'asset-reader.cjs',
  'diagnostics.cjs',
  'guid-index.cjs',
  'dependency-graph.cjs',
  'package-roots.cjs',
  'project-index.cjs',
  'engine-feature-closure.cjs',
  'script-index.cjs',
  '../lib/unity-serialized-file.cjs',
];

function extractorFingerprint(readFile = (file) => fs.readFileSync(file)) {
  const hash = crypto.createHash('sha256');
  for (const name of EXTRACTOR_FILES) {
    const file = path.join(__dirname, name);
    hash.update(name);
    try { hash.update(readFile(file, name)); } catch (_) { hash.update('missing'); }
  }
  return hash.digest('hex').slice(0, 16);
}

const EXTRACTOR_FINGERPRINT = extractorFingerprint();

function slash(value) {
  const resolved = path.resolve(value).replace(/\\/g, '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function nearestExistingAncestor(candidate) {
  let current = path.resolve(candidate);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

function assertExternalCacheLocation(cacheDir, protectedRoots = []) {
  const candidate = path.resolve(cacheDir);
  const ancestor = nearestExistingAncestor(candidate);
  for (const protectedRoot of protectedRoots.filter(Boolean)) {
    if (isInside(protectedRoot, candidate)) {
      throw new Error(`Unity intelligence cache must stay outside source/project: ${candidate}`);
    }
    if (!ancestor || !fs.existsSync(protectedRoot)) continue;
    const realProtected = fs.realpathSync.native(protectedRoot);
    const realAncestor = fs.realpathSync.native(ancestor);
    const prospective = path.resolve(realAncestor, path.relative(ancestor, candidate));
    if (isInside(realProtected, prospective)) {
      throw new Error('Unity intelligence cache symlink/junction must stay outside source/project.');
    }
  }
  return candidate;
}

function resolveDefaultCacheDir() {
  const configured = process.env.CC_PLAYABLE_UNITY_INTEL_CACHE;
  if (configured) return path.resolve(configured);
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache');
  return path.join(base, 'cc-playable-framework', 'unity-intel');
}

function createCacheContext(options) {
  if (options.enabled === false) return { enabled: false, file: null, key: null };
  const identity = JSON.stringify({
    projectRoot: slash(options.projectRoot || options.sourceRoot),
    sourceRoot: slash(options.sourceRoot),
    packageRoots: (options.packageRoots || []).map(root => ({
      kind: root.kind,
      name: root.packageName || null,
      version: root.packageVersion || null,
      path: slash(root.physicalRoot),
      integrityStamp: root.integrityStamp || null,
    })),
  });
  const key = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
  const protectedRoots = [options.projectRoot, options.sourceRoot].filter(Boolean).map(value => path.resolve(value));
  const cacheDir = assertExternalCacheLocation(options.cacheDir || resolveDefaultCacheDir(), protectedRoots);
  return { enabled: true, key, file: path.join(cacheDir, `${key}.json`), protectedRoots };
}

function loadIndexCache(context) {
  if (!context.enabled || !context.file || !fs.existsSync(context.file)) return null;
  try {
    assertExternalCacheLocation(path.dirname(context.file), context.protectedRoots);
    if (fs.lstatSync(context.file).isSymbolicLink()) return null;
    const cache = JSON.parse(fs.readFileSync(context.file, 'utf8'));
    if (cache.schemaVersion !== CACHE_SCHEMA_VERSION || cache.indexerVersion !== INDEXER_VERSION ||
        cache.extractorFingerprint !== EXTRACTOR_FINGERPRINT) return null;
    if (!cache.entries || typeof cache.entries !== 'object') return null;
    return cache;
  } catch (_) {
    return null;
  }
}

function saveIndexCache(context, entries) {
  if (!context.enabled || !context.file) return { written: false, error: null };
  let tempFile = null;
  try {
    assertExternalCacheLocation(path.dirname(context.file), context.protectedRoots);
    fs.mkdirSync(path.dirname(context.file), { recursive: true });
    assertExternalCacheLocation(path.dirname(context.file), context.protectedRoots);
    if (fs.existsSync(context.file) && fs.lstatSync(context.file).isSymbolicLink()) {
      throw new Error('Unity intelligence cache file must not be a symlink.');
    }
    tempFile = `${context.file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify({
      schemaVersion: CACHE_SCHEMA_VERSION,
      indexerVersion: INDEXER_VERSION,
      extractorFingerprint: EXTRACTOR_FINGERPRINT,
      updatedAt: new Date().toISOString(),
      entries,
    })}\n`, 'utf8');
    fs.renameSync(tempFile, context.file);
    return { written: true, error: null };
  } catch (error) {
    if (tempFile) {
      try { fs.unlinkSync(tempFile); } catch (_) { /* best-effort cleanup */ }
    }
    return { written: false, error: error.message };
  }
}

function hashFile(filePath) {
  if (!filePath) return '';
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex').slice(0, 16);
  } catch (_) {
    return 'unreadable';
  }
}

function fileStamp(fileStat, metaStat, filePath = null, metaPath = null, options = {}) {
  const hashContent = options.hashContent === true;
  const hashMeta = options.hashMeta !== false;
  return [
    fileStat.size,
    fileStat.mtimeMs,
    fileStat.ctimeMs,
    metaStat ? metaStat.size : 0,
    metaStat ? metaStat.mtimeMs : 0,
    metaStat ? metaStat.ctimeMs : 0,
    hashContent ? hashFile(filePath) : '',
    hashMeta ? hashFile(metaPath) : '',
  ].join(':');
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  INDEXER_VERSION,
  EXTRACTOR_FILES: Object.freeze([...EXTRACTOR_FILES]),
  EXTRACTOR_FINGERPRINT,
  extractorFingerprint,
  resolveDefaultCacheDir,
  assertExternalCacheLocation,
  createCacheContext,
  loadIndexCache,
  saveIndexCache,
  hashFile,
  fileStamp,
};
