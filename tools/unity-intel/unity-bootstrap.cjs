'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  validateUnityProject,
  isInside,
} = require('./unity-editor.cjs');

const UPSTREAM_PACKAGE_NAME = 'com.ivanmurzak.unity.mcp';
const UPSTREAM_PACKAGE_VERSION = '0.89.0';
const UPSTREAM_PACKAGE_SPEC = 'https://github.com/IvanMurzak/Unity-MCP.git?path=/Unity-MCP-Plugin/Packages/com.ivanmurzak.unity.mcp#71931e260b32339ca35f89de409da0516930cb5c';
const UPSTREAM_TRANSITIVE_OPENUPM_DEPENDENCIES = Object.freeze([
  'extensions.unity.playerprefsex',
]);
const SCANNER_PACKAGE_METADATA = require('../../packages/unity-intelligence/package.json');
const SCANNER_PACKAGE_NAME = SCANNER_PACKAGE_METADATA.name;
const SCANNER_PACKAGE_VERSION = SCANNER_PACKAGE_METADATA.version;
const OPENUPM_URL = 'https://package.openupm.com';
const OPENUPM_REQUIRED_SCOPES = Object.freeze([
  'com.ivanmurzak',
  'extensions.unity',
]);

class UnityBootstrapError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'UnityBootstrapError';
    this.code = code;
    this.details = details;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function statOrNull(fsImpl, value, lstat = false) {
  try { return lstat ? fsImpl.lstatSync(value) : fsImpl.statSync(value); } catch (_) { return null; }
}

function randomToken(options = {}) {
  const randomBytes = options.randomBytes || crypto.randomBytes;
  return randomBytes(12).toString('hex');
}

function parseManifestBytes(bytes, manifestPath) {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const text = bytes.subarray(hasBom ? 3 : 0).toString('utf8');
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw new UnityBootstrapError(
      'UNITY_MANIFEST_CORRUPT',
      `Packages/manifest.json is not valid JSON: ${error.message}`,
      { manifestPath },
    );
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new UnityBootstrapError(
      'UNITY_MANIFEST_CORRUPT',
      'Packages/manifest.json must contain a JSON object.',
      { manifestPath },
    );
  }
  if (manifest.dependencies !== undefined &&
      (!manifest.dependencies || typeof manifest.dependencies !== 'object' || Array.isArray(manifest.dependencies))) {
    throw new UnityBootstrapError(
      'UNITY_MANIFEST_CORRUPT',
      'Packages/manifest.json dependencies must be a JSON object.',
      { manifestPath },
    );
  }
  if (manifest.scopedRegistries !== undefined && !Array.isArray(manifest.scopedRegistries)) {
    throw new UnityBootstrapError(
      'UNITY_MANIFEST_CORRUPT',
      'Packages/manifest.json scopedRegistries must be an array when present.',
      { manifestPath },
    );
  }
  return { manifest, text, hasBom };
}

function serializeManifest(manifest, original) {
  const indentMatch = /\n([ \t]+)"/.exec(original.text);
  const indent = indentMatch ? indentMatch[1] : '  ';
  const eol = original.text.includes('\r\n') ? '\r\n' : '\n';
  const endsWithEol = /(?:\r\n|\n)$/.test(original.text);
  let text = JSON.stringify(manifest, null, indent);
  if (eol === '\r\n') text = text.replace(/\n/g, '\r\n');
  if (endsWithEol) text += eol;
  const body = Buffer.from(text, 'utf8');
  return original.hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

function validateManifestPath(project, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const manifestPath = pathImpl.join(project.projectRoot, 'Packages', 'manifest.json');
  const manifestStat = statOrNull(fsImpl, manifestPath, true);
  if (manifestStat && manifestStat.isSymbolicLink()) {
    throw new UnityBootstrapError(
      'UNITY_MANIFEST_SYMLINK_UNSUPPORTED',
      'Packages/manifest.json must be a regular file, not a symbolic link.',
      { manifestPath },
    );
  }
  if (!manifestStat || !manifestStat.isFile()) {
    throw new UnityBootstrapError(
      'UNITY_MANIFEST_MISSING',
      `Packages/manifest.json not found: ${manifestPath}`,
      { manifestPath },
    );
  }

  const packagesReal = fsImpl.realpathSync(pathImpl.dirname(manifestPath));
  const manifestReal = fsImpl.realpathSync(manifestPath);
  if (!isInside(pathImpl, project.projectRoot, packagesReal) ||
      !isInside(pathImpl, project.projectRoot, manifestReal)) {
    throw new UnityBootstrapError(
      'UNITY_MANIFEST_SYMLINK_ESCAPE',
      'Packages/manifest.json resolves outside the Unity project.',
      { projectRoot: project.projectRoot, manifestPath, manifestReal },
    );
  }
  return { manifestPath, manifestReal, manifestStat };
}

function isCrossPlatformAbsolute(value, pathImpl) {
  return pathImpl.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

function validateScannerPackageSpec(scannerPackageSpec, project, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  if (typeof scannerPackageSpec !== 'string' || !scannerPackageSpec.startsWith('file:')) {
    throw new UnityBootstrapError(
      'UNITY_SCANNER_SPEC_INVALID',
      `Local scanner package must use a file: spec for ${SCANNER_PACKAGE_NAME}.`,
      { scannerPackageSpec },
    );
  }
  const rawPath = scannerPackageSpec.slice('file:'.length).trim();
  if (!rawPath || rawPath.startsWith('//')) {
    throw new UnityBootstrapError(
      'UNITY_SCANNER_SPEC_INVALID',
      'Local scanner package spec must be file:absolute or file:relative, not a remote file URL.',
      { scannerPackageSpec },
    );
  }

  const wasAbsolute = isCrossPlatformAbsolute(rawPath, pathImpl);
  const requestedPath = wasAbsolute
    ? pathImpl.resolve(rawPath)
    : pathImpl.resolve(project.packagesPath, rawPath);
  let packageRoot;
  try { packageRoot = fsImpl.realpathSync(requestedPath); } catch (_) {
    throw new UnityBootstrapError(
      'UNITY_SCANNER_PACKAGE_NOT_FOUND',
      `Local scanner package directory not found: ${requestedPath}`,
      { scannerPackageSpec, requestedPath },
    );
  }
  const packageStat = statOrNull(fsImpl, packageRoot);
  if (!packageStat || !packageStat.isDirectory()) {
    throw new UnityBootstrapError(
      'UNITY_SCANNER_PACKAGE_NOT_FOUND',
      `Local scanner package is not a directory: ${packageRoot}`,
      { scannerPackageSpec, packageRoot },
    );
  }

  const packageJsonPath = pathImpl.join(packageRoot, 'package.json');
  const packageJsonReal = (() => {
    try { return fsImpl.realpathSync(packageJsonPath); } catch (_) { return null; }
  })();
  if (!packageJsonReal || !isInside(pathImpl, packageRoot, packageJsonReal)) {
    throw new UnityBootstrapError(
      'UNITY_SCANNER_PACKAGE_INVALID',
      'Local scanner package.json is missing or resolves outside its package directory.',
      { packageRoot, packageJsonPath },
    );
  }
  let metadata;
  try { metadata = JSON.parse(fsImpl.readFileSync(packageJsonReal, 'utf8')); } catch (error) {
    throw new UnityBootstrapError(
      'UNITY_SCANNER_PACKAGE_INVALID',
      `Local scanner package.json is invalid: ${error.message}`,
      { packageJsonPath: packageJsonReal },
    );
  }
  if (metadata.name !== SCANNER_PACKAGE_NAME || metadata.version !== SCANNER_PACKAGE_VERSION) {
    throw new UnityBootstrapError(
      'UNITY_SCANNER_PACKAGE_IDENTITY_MISMATCH',
      `Expected ${SCANNER_PACKAGE_NAME}@${SCANNER_PACKAGE_VERSION}, found ${metadata.name || '<missing>'}@${metadata.version || '<missing>'}.`,
      { packageRoot, name: metadata.name || null, version: metadata.version || null },
    );
  }

  let canonicalPath;
  if (wasAbsolute) {
    canonicalPath = packageRoot;
  } else {
    canonicalPath = pathImpl.relative(project.packagesPath, packageRoot) || '.';
    if (isCrossPlatformAbsolute(canonicalPath, pathImpl)) canonicalPath = packageRoot;
  }
  return {
    spec: `file:${slash(canonicalPath).replace(/\/$/, '')}`,
    packageRoot,
    packageJsonPath: packageJsonReal,
    metadata: { name: metadata.name, version: metadata.version },
  };
}

function normalizeRegistryUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function transitiveDependenciesRequireOpenUpm(dependencies) {
  return (dependencies || []).some(name => String(name).startsWith('extensions.unity.'));
}

function mergeOpenUpmScopes(manifest, requiredScopes = OPENUPM_REQUIRED_SCOPES) {
  if (!requiredScopes.length) return false;
  if (!manifest.scopedRegistries) manifest.scopedRegistries = [];
  if (!Array.isArray(manifest.scopedRegistries)) {
    throw new UnityBootstrapError('UNITY_MANIFEST_CORRUPT', 'scopedRegistries must be an array.');
  }
  let registry = manifest.scopedRegistries.find(item => item && typeof item === 'object' &&
    normalizeRegistryUrl(item.url) === normalizeRegistryUrl(OPENUPM_URL));
  let changed = false;
  if (!registry) {
    registry = { name: 'package.openupm.com', url: OPENUPM_URL, scopes: [] };
    manifest.scopedRegistries.push(registry);
    changed = true;
  }
  if (!Array.isArray(registry.scopes) || registry.scopes.some(scope => typeof scope !== 'string')) {
    throw new UnityBootstrapError(
      'UNITY_MANIFEST_CORRUPT',
      'OpenUPM scoped registry must contain a string scopes array.',
    );
  }
  for (const scope of requiredScopes) {
    if (registry.scopes.includes(scope)) continue;
    registry.scopes.push(scope);
    changed = true;
  }
  return changed;
}

function planManifestInstall(manifest, scannerSpec) {
  let changed = false;
  if (!manifest.dependencies) {
    manifest.dependencies = {};
    changed = true;
  }
  if (manifest.dependencies[UPSTREAM_PACKAGE_NAME] !== UPSTREAM_PACKAGE_SPEC) {
    manifest.dependencies[UPSTREAM_PACKAGE_NAME] = UPSTREAM_PACKAGE_SPEC;
    changed = true;
  }
  if (manifest.dependencies[SCANNER_PACKAGE_NAME] !== scannerSpec) {
    manifest.dependencies[SCANNER_PACKAGE_NAME] = scannerSpec;
    changed = true;
  }
  if (transitiveDependenciesRequireOpenUpm(UPSTREAM_TRANSITIVE_OPENUPM_DEPENDENCIES)) {
    changed = mergeOpenUpmScopes(manifest) || changed;
  }
  return changed;
}

function storageBase(project, options = {}) {
  const pathImpl = options.path || path;
  const processImpl = options.process || process;
  const env = options.env || processImpl.env || {};
  const homeDir = options.homeDir || os.homedir();
  const configured = options.storageDir;
  let base = configured || env.CC_PLAYABLE_UNITY_BOOTSTRAP_DIR;
  if (!base) {
    if (env.LOCALAPPDATA) base = pathImpl.join(env.LOCALAPPDATA, 'cc-playable-framework', 'unity-bootstrap');
    else base = pathImpl.join(env.XDG_CACHE_HOME || pathImpl.join(homeDir, '.cache'),
      'cc-playable-framework', 'unity-bootstrap');
  }
  const resolved = pathImpl.resolve(base);
  if (isInside(pathImpl, project.projectRoot, resolved) &&
      !isInside(pathImpl, pathImpl.join(project.projectRoot, 'Library'), resolved)) {
    throw new UnityBootstrapError(
      'UNITY_BOOTSTRAP_STORAGE_UNSAFE',
      'Bootstrap backups/locks must be user-local or under the Unity project Library directory.',
      { projectRoot: project.projectRoot, storageDir: resolved },
    );
  }
  return resolved;
}

function projectStorageRoot(project, options = {}) {
  const pathImpl = options.path || path;
  const identity = sha256(Buffer.from(project.projectRoot, 'utf8')).slice(0, 24);
  return pathImpl.join(storageBase(project, options), identity);
}

function acquireProjectBootstrapLock(project, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const processImpl = options.process || process;
  const root = options.storageRoot || projectStorageRoot(project, options);
  fsImpl.mkdirSync(root, { recursive: true });
  const lockFile = pathImpl.join(root, 'bootstrap.lock');
  const token = `${processImpl.pid || 0}-${randomToken(options)}`;
  let descriptor;
  try {
    descriptor = fsImpl.openSync(lockFile, 'wx', 0o600);
    fsImpl.writeFileSync(descriptor, `${JSON.stringify({
      token,
      pid: processImpl.pid || null,
      projectRoot: project.projectRoot,
      createdAt: new Date(typeof options.now === 'function' ? options.now() : Date.now()).toISOString(),
    })}\n`, 'utf8');
    if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor);
    fsImpl.closeSync(descriptor);
    descriptor = null;
  } catch (error) {
    if (descriptor !== undefined && descriptor !== null) {
      try { fsImpl.closeSync(descriptor); } catch (_) { /* best effort */ }
    }
    if (error && error.code === 'EEXIST') {
      throw new UnityBootstrapError(
        'UNITY_BOOTSTRAP_PROJECT_LOCKED',
        'Another Unity bootstrap transaction already owns this project lock.',
        { lockFile },
      );
    }
    throw error;
  }

  let released = false;
  return {
    token,
    lockFile,
    storageRoot: root,
    release() {
      if (released) return;
      released = true;
      try {
        const current = JSON.parse(fsImpl.readFileSync(lockFile, 'utf8'));
        if (current.token === token) fsImpl.unlinkSync(lockFile);
      } catch (_) { /* never remove a lock no longer owned by this transaction */ }
    },
  };
}

function atomicReplace(manifestPath, bytes, expectedHash, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const processImpl = options.process || process;
  const currentStat = statOrNull(fsImpl, manifestPath, true);
  if (!currentStat || !currentStat.isFile() || currentStat.isSymbolicLink()) {
    throw new UnityBootstrapError(
      'UNITY_BOOTSTRAP_CAS_CONFLICT',
      'Packages/manifest.json was removed or replaced by a symlink during the transaction.',
      { manifestPath },
    );
  }
  const current = fsImpl.readFileSync(manifestPath);
  const currentHash = sha256(current);
  if (currentHash !== expectedHash) {
    throw new UnityBootstrapError(
      'UNITY_BOOTSTRAP_CAS_CONFLICT',
      'Packages/manifest.json changed concurrently; refusing to overwrite it.',
      { manifestPath, expectedHash, actualHash: currentHash },
    );
  }

  const tempFile = pathImpl.join(pathImpl.dirname(manifestPath),
    `.${pathImpl.basename(manifestPath)}.${processImpl.pid || 0}.${randomToken(options)}.tmp`);
  let descriptor = null;
  try {
    descriptor = fsImpl.openSync(tempFile, 'wx', currentStat.mode & 0o777);
    fsImpl.writeFileSync(descriptor, bytes);
    if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor);
    fsImpl.closeSync(descriptor);
    descriptor = null;

    const finalCheck = fsImpl.readFileSync(manifestPath);
    if (sha256(finalCheck) !== expectedHash) {
      throw new UnityBootstrapError(
        'UNITY_BOOTSTRAP_CAS_CONFLICT',
        'Packages/manifest.json changed before atomic replace; refusing to overwrite it.',
        { manifestPath, expectedHash, actualHash: sha256(finalCheck) },
      );
    }
    fsImpl.renameSync(tempFile, manifestPath);
    const writtenHash = sha256(fsImpl.readFileSync(manifestPath));
    if (writtenHash !== sha256(bytes)) {
      throw new UnityBootstrapError(
        'UNITY_BOOTSTRAP_WRITE_VERIFY_FAILED',
        'Atomic manifest write did not preserve the expected bytes.',
        { manifestPath, expectedHash: sha256(bytes), actualHash: writtenHash },
      );
    }
  } finally {
    if (descriptor !== null) {
      try { fsImpl.closeSync(descriptor); } catch (_) { /* best effort */ }
    }
    try { fsImpl.unlinkSync(tempFile); } catch (_) { /* renamed or best-effort cleanup */ }
  }
}

function writeExactBackup(storageRoot, bytes, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const processImpl = options.process || process;
  const stamp = typeof options.now === 'function' ? options.now() : Date.now();
  const backupFile = pathImpl.join(storageRoot,
    `${stamp}-${processImpl.pid || 0}-${randomToken(options)}.manifest.json`);
  let descriptor = null;
  try {
    descriptor = fsImpl.openSync(backupFile, 'wx', 0o600);
    fsImpl.writeFileSync(descriptor, bytes);
    if (typeof fsImpl.fsyncSync === 'function') fsImpl.fsyncSync(descriptor);
    fsImpl.closeSync(descriptor);
    descriptor = null;
  } finally {
    if (descriptor !== null) {
      try { fsImpl.closeSync(descriptor); } catch (_) { /* best effort */ }
    }
  }
  if (sha256(fsImpl.readFileSync(backupFile)) !== sha256(bytes)) {
    throw new UnityBootstrapError(
      'UNITY_BOOTSTRAP_BACKUP_VERIFY_FAILED',
      'Manifest backup bytes failed verification.',
      { backupFile },
    );
  }
  return backupFile;
}

function setupUnityMcpPackages(projectPath, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const project = validateUnityProject(projectPath, { fs: fsImpl, path: pathImpl });
  const scanner = validateScannerPackageSpec(options.scannerPackageSpec, project, options);
  const manifestLocation = validateManifestPath(project, options);
  const lock = acquireProjectBootstrapLock(project, options);
  try {
    const beforeBytes = fsImpl.readFileSync(manifestLocation.manifestPath);
    const beforeHash = sha256(beforeBytes);
    const parsed = parseManifestBytes(beforeBytes, manifestLocation.manifestPath);
    const changed = planManifestInstall(parsed.manifest, scanner.spec);
    if (!changed) {
      return {
        changed: false,
        projectRoot: project.projectRoot,
        manifestPath: manifestLocation.manifestPath,
        scannerPackageSpec: scanner.spec,
        upstreamPackageSpec: UPSTREAM_PACKAGE_SPEC,
        beforeHash,
        afterHash: beforeHash,
        backupFile: null,
        storageRoot: lock.storageRoot,
        transaction: null,
      };
    }

    const afterBytes = serializeManifest(parsed.manifest, parsed);
    const afterHash = sha256(afterBytes);
    const backupFile = writeExactBackup(lock.storageRoot, beforeBytes, options);
    if (typeof options.beforeAtomicWrite === 'function') {
      options.beforeAtomicWrite({ project, manifestPath: manifestLocation.manifestPath, beforeHash, afterHash });
    }
    atomicReplace(manifestLocation.manifestPath, afterBytes, beforeHash, options);
    const transaction = Object.freeze({
      schemaVersion: 1,
      projectRoot: project.projectRoot,
      manifestPath: manifestLocation.manifestPath,
      storageRoot: lock.storageRoot,
      backupFile,
      beforeHash,
      afterHash,
    });
    return {
      changed: true,
      projectRoot: project.projectRoot,
      manifestPath: manifestLocation.manifestPath,
      scannerPackageSpec: scanner.spec,
      upstreamPackageSpec: UPSTREAM_PACKAGE_SPEC,
      beforeHash,
      afterHash,
      backupFile,
      storageRoot: lock.storageRoot,
      transaction,
    };
  } finally {
    lock.release();
  }
}

function assertRollbackToken(project, token, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  if (!token || token.schemaVersion !== 1 || token.projectRoot !== project.projectRoot) {
    throw new UnityBootstrapError('UNITY_BOOTSTRAP_ROLLBACK_INVALID', 'Rollback token does not match this Unity project.');
  }
  const manifestPath = pathImpl.join(project.projectRoot, 'Packages', 'manifest.json');
  if (pathImpl.resolve(token.manifestPath) !== pathImpl.resolve(manifestPath)) {
    throw new UnityBootstrapError('UNITY_BOOTSTRAP_ROLLBACK_INVALID', 'Rollback token manifest path is invalid.');
  }
  const storageRoot = pathImpl.resolve(token.storageRoot);
  if (isInside(pathImpl, project.projectRoot, storageRoot) &&
      !isInside(pathImpl, pathImpl.join(project.projectRoot, 'Library'), storageRoot)) {
    throw new UnityBootstrapError('UNITY_BOOTSTRAP_ROLLBACK_INVALID', 'Rollback storage root is unsafe.');
  }
  const backupFile = pathImpl.resolve(token.backupFile);
  const backupStat = statOrNull(fsImpl, backupFile, true);
  if (!isInside(pathImpl, storageRoot, backupFile) || !backupStat || !backupStat.isFile() || backupStat.isSymbolicLink()) {
    throw new UnityBootstrapError('UNITY_BOOTSTRAP_ROLLBACK_INVALID', 'Rollback backup file is missing or unsafe.');
  }
  return { manifestPath, storageRoot, backupFile };
}

function validatePackageRollbackState(transaction, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  if (!transaction || !transaction.projectRoot) {
    throw new UnityBootstrapError('UNITY_BOOTSTRAP_ROLLBACK_INVALID', 'A changed bootstrap transaction is required.');
  }
  const project = validateUnityProject(transaction.projectRoot, { fs: fsImpl, path: pathImpl });
  const paths = assertRollbackToken(project, transaction, options);
  validateManifestPath(project, options);
  const currentBytes = fsImpl.readFileSync(paths.manifestPath);
  const currentHash = sha256(currentBytes);
  if (currentHash !== transaction.afterHash) {
    throw new UnityBootstrapError(
      'UNITY_BOOTSTRAP_ROLLBACK_CONFLICT',
      'Packages/manifest.json changed after setup; refusing CAS rollback.',
      { expectedHash: transaction.afterHash, actualHash: currentHash },
    );
  }
  const backupBytes = fsImpl.readFileSync(paths.backupFile);
  const backupHash = sha256(backupBytes);
  if (backupHash !== transaction.beforeHash) {
    throw new UnityBootstrapError(
      'UNITY_BOOTSTRAP_BACKUP_CONFLICT',
      'Manifest backup no longer matches the setup transaction.',
      { expectedHash: transaction.beforeHash, actualHash: backupHash },
    );
  }
  return { project, paths, backupBytes };
}

function validateUnityMcpPackageRollback(transaction, options = {}) {
  const validated = validatePackageRollbackState(transaction, options);
  return {
    restorable: true,
    projectRoot: validated.project.projectRoot,
    manifestPath: validated.paths.manifestPath,
  };
}

function rollbackUnityMcpPackages(transaction, options = {}) {
  const fsImpl = options.fs || fs;
  const initial = validatePackageRollbackState(transaction, options);
  const project = initial.project;
  const paths = initial.paths;
  const lock = acquireProjectBootstrapLock(project, { ...options, storageRoot: paths.storageRoot });
  try {
    const validated = validatePackageRollbackState(transaction, options);
    atomicReplace(paths.manifestPath, validated.backupBytes, transaction.afterHash, options);
    return {
      rolledBack: true,
      projectRoot: project.projectRoot,
      manifestPath: paths.manifestPath,
      restoredHash: transaction.beforeHash,
      backupFile: paths.backupFile,
    };
  } finally {
    lock.release();
  }
}

module.exports = {
  UPSTREAM_PACKAGE_NAME,
  UPSTREAM_PACKAGE_VERSION,
  UPSTREAM_PACKAGE_SPEC,
  UPSTREAM_TRANSITIVE_OPENUPM_DEPENDENCIES,
  SCANNER_PACKAGE_NAME,
  SCANNER_PACKAGE_VERSION,
  OPENUPM_URL,
  OPENUPM_REQUIRED_SCOPES,
  UnityBootstrapError,
  sha256,
  parseManifestBytes,
  serializeManifest,
  validateScannerPackageSpec,
  transitiveDependenciesRequireOpenUpm,
  mergeOpenUpmScopes,
  planManifestInstall,
  projectStorageRoot,
  acquireProjectBootstrapLock,
  setupUnityMcpPackages,
  validateUnityMcpPackageRollback,
  rollbackUnityMcpPackages,
};
