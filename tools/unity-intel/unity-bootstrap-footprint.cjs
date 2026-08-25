'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { isInside, validateUnityProject } = require('./unity-editor.cjs');

const READY_DEFINE = 'UNITY_MCP_READY';
const GENERATION_PREFIX = 'UNITY_MCP_DEPS_';

function optionalBytes(filePath, fsImpl = fs) {
  return fsImpl.existsSync(filePath) ? fsImpl.readFileSync(filePath) : null;
}

function defineSet(text) {
  const values = new Set();
  for (const match of String(text || '').matchAll(/(?:^|;)(UNITY_MCP_(?:READY|DEPS_[A-Za-z0-9_]+))(?=;|$)/gm)) {
    values.add(match[1]);
  }
  return values;
}

function defineMap(text) {
  const output = {};
  const lines = String(text || '').split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    if (/^  scriptingDefineSymbols:\s*$/.test(line)) { inSection = true; continue; }
    if (inSection && /^  \S/.test(line)) break;
    if (!inSection) continue;
    const match = /^\s{4}([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    output[match[1]] = match[2].split(';').map(value => value.trim())
      .filter(value => value === READY_DEFINE || value.startsWith(GENERATION_PREFIX)).sort();
  }
  return output;
}

function captureUnityBootstrapFootprint(projectRoot, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const project = validateUnityProject(projectRoot, { fs: fsImpl, path: pathImpl });
  const packageLockPath = pathImpl.join(project.packagesPath, 'packages-lock.json');
  const nugetPath = pathImpl.join(project.assetsPath, 'Plugins', 'NuGet');
  const nugetMetaPath = `${nugetPath}.meta`;
  const pluginsPath = pathImpl.dirname(nugetPath);
  const pluginsMetaPath = `${pluginsPath}.meta`;
  const projectSettingsAsset = pathImpl.join(project.projectSettingsPath, 'ProjectSettings.asset');
  const settingsBytes = optionalBytes(projectSettingsAsset, fsImpl);
  return Object.freeze({
    schemaVersion: 1,
    projectRoot: project.projectRoot,
    packageLockPath,
    packageLockBytes: optionalBytes(packageLockPath, fsImpl),
    nugetPath,
    nugetExisted: fsImpl.existsSync(nugetPath),
    nugetMetaPath,
    nugetMetaExisted: fsImpl.existsSync(nugetMetaPath),
    pluginsPath,
    pluginsExisted: fsImpl.existsSync(pluginsPath),
    pluginsMetaPath,
    pluginsMetaExisted: fsImpl.existsSync(pluginsMetaPath),
    projectSettingsAsset,
    projectSettingsBytes: settingsBytes,
    definesBefore: defineMap(settingsBytes && settingsBytes.toString('utf8')),
  });
}

function sameBytes(left, right) {
  if (left === null || right === null) return left === right;
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.equals(right);
}

function directoryDigest(directory, fsImpl = fs, pathImpl = path) {
  if (!fsImpl.existsSync(directory)) return null;
  const root = fsImpl.realpathSync(directory);
  const entries = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fsImpl.readdirSync(current, { withFileTypes: true })) {
      const full = pathImpl.join(current, entry.name);
      const relative = pathImpl.relative(root, full).replace(/\\/g, '/');
      if (entry.isSymbolicLink()) {
        const error = new Error('Bootstrap footprint cannot seal a symbolic link.');
        error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_SYMLINK';
        throw error;
      }
      if (entry.isDirectory()) {
        entries.push(`d:${relative}`);
        stack.push(full);
      } else if (entry.isFile()) {
        const bytes = fsImpl.readFileSync(full);
        entries.push(`f:${relative}:${bytes.length}:${crypto.createHash('sha256').update(bytes).digest('hex')}`);
      } else {
        const error = new Error('Bootstrap footprint contains a non-regular entry.');
        error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_INVALID';
        throw error;
      }
    }
  }
  entries.sort();
  return crypto.createHash('sha256').update(entries.join('\n')).digest('hex');
}

function sealUnityBootstrapFootprint(fingerprint, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const project = validateUnityProject(fingerprint && fingerprint.projectRoot, { fs: fsImpl, path: pathImpl });
  if (!fingerprint || fingerprint.schemaVersion !== 1 || project.projectRoot !== fingerprint.projectRoot) {
    const error = new Error('Bootstrap footprint does not match this Unity project.');
    error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_INVALID';
    throw error;
  }
  return Object.freeze({
    ...fingerprint,
    sealed: true,
    packageLockBytesAfter: optionalBytes(fingerprint.packageLockPath, fsImpl),
    nugetDigestAfter: directoryDigest(fingerprint.nugetPath, fsImpl, pathImpl),
    nugetMetaBytesAfter: optionalBytes(fingerprint.nugetMetaPath, fsImpl),
    pluginsMetaBytesAfter: optionalBytes(fingerprint.pluginsMetaPath, fsImpl),
    projectSettingsBytesAfter: optionalBytes(fingerprint.projectSettingsAsset, fsImpl),
  });
}

function atomicReplace(filePath, bytes, expectedCurrent, fsImpl = fs) {
  const current = optionalBytes(filePath, fsImpl);
  if (!sameBytes(current, expectedCurrent)) {
    const error = new Error(`Concurrent change detected for ${path.basename(filePath)}.`);
    error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_CONFLICT';
    throw error;
  }
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fsImpl.writeFileSync(temp, bytes, { flag: 'wx' });
    fsImpl.renameSync(temp, filePath);
  } finally {
    try { if (fsImpl.existsSync(temp)) fsImpl.unlinkSync(temp); } catch (_) { /* best effort */ }
  }
}

function restoreOptionalFile(filePath, beforeBytes, fsImpl = fs, expectedCurrent = undefined) {
  const current = optionalBytes(filePath, fsImpl);
  if (sameBytes(current, beforeBytes)) return 'unchanged';
  if (expectedCurrent !== undefined && !sameBytes(current, expectedCurrent)) {
    const error = new Error(`Concurrent change detected for ${path.basename(filePath)}.`);
    error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_CONFLICT';
    throw error;
  }
  if (beforeBytes === null) {
    if (fsImpl.lstatSync(filePath).isSymbolicLink()) {
      const error = new Error(`Refusing to remove symbolic link ${path.basename(filePath)}.`);
      error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_SYMLINK';
      throw error;
    }
    fsImpl.unlinkSync(filePath);
    return 'removed-generated';
  }
  atomicReplace(filePath, beforeBytes, current, fsImpl);
  return 'restored';
}

function validateOptionalRestore(filePath, beforeBytes, fsImpl = fs, expectedCurrent = undefined) {
  const current = optionalBytes(filePath, fsImpl);
  if (sameBytes(current, beforeBytes)) return 'unchanged';
  if (expectedCurrent === undefined || !sameBytes(current, expectedCurrent)) {
    const error = new Error(`Concurrent change detected for ${path.basename(filePath)}.`);
    error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_CONFLICT';
    throw error;
  }
  if (beforeBytes === null) {
    const entry = fsImpl.lstatSync(filePath);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      const error = new Error(`Refusing to remove unsafe ${path.basename(filePath)}.`);
      error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_SYMLINK';
      throw error;
    }
    return 'remove-generated';
  }
  return 'restore';
}

function stripAddedMcpDefines(text, definesBefore) {
  const globalBefore = Array.isArray(definesBefore) ? new Set(definesBefore) : null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let inSection = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^  scriptingDefineSymbols:\s*$/.test(line)) { inSection = true; continue; }
    if (inSection && /^  \S/.test(line)) { inSection = false; }
    if (!inSection) continue;
    const match = /^(\s{4}[^:]+:\s*)(.*)$/.exec(line);
    if (!match) continue;
    const targetMatch = /^\s{4}([^:]+):/.exec(line);
    const before = globalBefore || new Set(definesBefore && definesBefore[targetMatch && targetMatch[1]] || []);
    const values = match[2].split(';').filter(Boolean);
    const filtered = values.filter(value => {
      const token = value.trim();
      if (token !== READY_DEFINE && !token.startsWith(GENERATION_PREFIX)) return true;
      return before.has(token);
    });
    lines[index] = `${match[1]}${filtered.join(';')}`;
  }
  return lines.join(eol);
}

function validateGeneratedNuget(fingerprint, fsImpl, pathImpl) {
  if (fingerprint.nugetExisted || !fsImpl.existsSync(fingerprint.nugetPath)) return 'unchanged';
  const entry = fsImpl.lstatSync(fingerprint.nugetPath);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    const error = new Error('Generated Assets/Plugins/NuGet target is not a safe directory.');
    error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_SYMLINK';
    throw error;
  }
  const resolved = fsImpl.realpathSync(fingerprint.nugetPath);
  const expected = pathImpl.resolve(fingerprint.nugetPath);
  if (pathImpl.resolve(resolved) !== expected ||
      !isInside(pathImpl, pathImpl.join(fingerprint.projectRoot, 'Assets', 'Plugins'), resolved)) {
    const error = new Error('Generated NuGet directory resolves outside Assets/Plugins.');
    error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_ESCAPE';
    throw error;
  }
  if (directoryDigest(resolved, fsImpl, pathImpl) !== fingerprint.nugetDigestAfter) {
    const error = new Error('Concurrent change detected in generated NuGet directory.');
    error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_CONFLICT';
    throw error;
  }
  return 'remove-generated';
}

function removeGeneratedNuget(fingerprint, fsImpl, pathImpl) {
  const validation = validateGeneratedNuget(fingerprint, fsImpl, pathImpl);
  if (validation === 'unchanged') return validation;
  const resolved = fsImpl.realpathSync(fingerprint.nugetPath);
  fsImpl.rmSync(resolved, { recursive: true, force: false });
  return 'removed-generated';
}

function validateEmptyGeneratedParent(fingerprint, fsImpl) {
  if (fingerprint.pluginsExisted || !fsImpl.existsSync(fingerprint.pluginsPath)) return 'unchanged';
  const entry = fsImpl.lstatSync(fingerprint.pluginsPath);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    const error = new Error('Generated Assets/Plugins target is not a safe directory.');
    error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_SYMLINK';
    throw error;
  }
  const remaining = fsImpl.readdirSync(fingerprint.pluginsPath)
    .filter(name => name !== path.basename(fingerprint.nugetPath) &&
      name !== path.basename(fingerprint.nugetMetaPath));
  if (remaining.length > 0) return 'preserved-nonempty';
  if (!fingerprint.pluginsMetaExisted) {
    validateOptionalRestore(fingerprint.pluginsMetaPath, null, fsImpl, fingerprint.pluginsMetaBytesAfter);
  }
  return 'remove-generated';
}

function removeEmptyGeneratedParent(fingerprint, fsImpl) {
  const validation = validateEmptyGeneratedParent(fingerprint, fsImpl);
  if (validation !== 'remove-generated') return validation;
  if (fsImpl.readdirSync(fingerprint.pluginsPath).length > 0) return 'preserved-nonempty';
  if (!fingerprint.pluginsMetaExisted) {
    // Recheck the CAS boundary before deleting the parent. This prevents a
    // concurrent Plugins.meta edit from leaving an orphaned meta file.
    validateOptionalRestore(fingerprint.pluginsMetaPath, null, fsImpl, fingerprint.pluginsMetaBytesAfter);
  }
  fsImpl.rmdirSync(fingerprint.pluginsPath);
  if (!fingerprint.pluginsMetaExisted) {
    restoreOptionalFile(fingerprint.pluginsMetaPath, null, fsImpl, fingerprint.pluginsMetaBytesAfter);
  }
  return 'removed-generated';
}

function validateScriptingDefinesRollback(fingerprint, fsImpl) {
  const current = optionalBytes(fingerprint.projectSettingsAsset, fsImpl);
  if (sameBytes(current, fingerprint.projectSettingsBytes)) return 'unchanged';
  if (!sameBytes(current, fingerprint.projectSettingsBytesAfter)) {
    const error = new Error('Concurrent change detected for ProjectSettings.asset.');
    error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_CONFLICT';
    throw error;
  }
  return current === null ? 'unchanged' : 'remove-generated';
}

function rollbackUnityBootstrapFootprint(fingerprint, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const project = validateUnityProject(fingerprint && fingerprint.projectRoot, { fs: fsImpl, path: pathImpl });
  if (!fingerprint || fingerprint.schemaVersion !== 1 || project.projectRoot !== fingerprint.projectRoot) {
    const error = new Error('Bootstrap footprint does not match this Unity project.');
    error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_INVALID';
    throw error;
  }
  if (fingerprint.sealed !== true) {
    return {
      complete: false,
      steps: {},
      errors: [{ step: 'seal', code: 'UNITY_BOOTSTRAP_FOOTPRINT_UNSEALED' }],
    };
  }
  if (options.ownershipConfirmed !== true) {
    // A capture->Unity-import->seal window cannot attribute intermediate file
    // writes to Unity versus the user. Production bootstrap therefore keeps
    // the full generation after reload failure; destructive rollback requires
    // an external, artifact-level ownership proof that this module cannot infer.
    return {
      complete: false,
      phase: 'ownership',
      steps: {},
      errors: [{ step: 'ownership', code: 'UNITY_BOOTSTRAP_FOOTPRINT_OWNERSHIP_AMBIGUOUS' }],
    };
  }
  const steps = {};
  const errors = [];
  const validations = [
    ['packagesLock', () => validateOptionalRestore(
      fingerprint.packageLockPath, fingerprint.packageLockBytes, fsImpl, fingerprint.packageLockBytesAfter)],
    ['nugetDirectory', () => validateGeneratedNuget(fingerprint, fsImpl, pathImpl)],
    ['nugetMeta', () => fingerprint.nugetMetaExisted
      ? 'unchanged'
      : validateOptionalRestore(fingerprint.nugetMetaPath, null, fsImpl, fingerprint.nugetMetaBytesAfter)],
    ['pluginsDirectory', () => validateEmptyGeneratedParent(fingerprint, fsImpl)],
    ['scriptingDefines', () => validateScriptingDefinesRollback(fingerprint, fsImpl)],
  ];
  for (const [name, validate] of validations) {
    try { steps[name] = `validated:${validate()}`; } catch (error) {
      steps[name] = error.code || 'failed';
      errors.push({ step: name, code: error.code || 'failed' });
    }
  }
  if (errors.length) return { complete: false, phase: 'validation', steps, errors };
  if (options.validateOnly) return { complete: true, phase: 'validation', steps, errors: [] };

  const run = (name, action) => {
    try { steps[name] = action(); } catch (error) {
      steps[name] = error.code || 'failed';
      errors.push({ step: name, code: error.code || 'failed' });
    }
  };
  run('packagesLock', () => restoreOptionalFile(
    fingerprint.packageLockPath, fingerprint.packageLockBytes, fsImpl, fingerprint.packageLockBytesAfter));
  run('nugetDirectory', () => removeGeneratedNuget(fingerprint, fsImpl, pathImpl));
  run('nugetMeta', () => fingerprint.nugetMetaExisted
    ? 'unchanged'
    : restoreOptionalFile(fingerprint.nugetMetaPath, null, fsImpl, fingerprint.nugetMetaBytesAfter));
  run('pluginsDirectory', () => removeEmptyGeneratedParent(fingerprint, fsImpl));
  run('scriptingDefines', () => {
    const current = optionalBytes(fingerprint.projectSettingsAsset, fsImpl);
    if (current === null) return 'missing';
    if (sameBytes(current, fingerprint.projectSettingsBytes)) return 'unchanged';
    if (!sameBytes(current, fingerprint.projectSettingsBytesAfter)) {
      const error = new Error('Concurrent change detected for ProjectSettings.asset.');
      error.code = 'UNITY_BOOTSTRAP_FOOTPRINT_CONFLICT';
      throw error;
    }
    const stripped = Buffer.from(stripAddedMcpDefines(current.toString('utf8'), fingerprint.definesBefore), 'utf8');
    if (current.equals(stripped)) return 'unchanged';
    atomicReplace(fingerprint.projectSettingsAsset, stripped, current, fsImpl);
    return 'removed-generated';
  });
  return { complete: errors.length === 0, steps, errors };
}

function validateUnityBootstrapFootprintRollback(fingerprint, options = {}) {
  return rollbackUnityBootstrapFootprint(fingerprint, { ...options, validateOnly: true });
}

module.exports = {
  READY_DEFINE,
  GENERATION_PREFIX,
  optionalBytes,
  defineSet,
  defineMap,
  captureUnityBootstrapFootprint,
  directoryDigest,
  sealUnityBootstrapFootprint,
  sameBytes,
  atomicReplace,
  restoreOptionalFile,
  stripAddedMcpDefines,
  removeGeneratedNuget,
  validateUnityBootstrapFootprintRollback,
  rollbackUnityBootstrapFootprint,
};
