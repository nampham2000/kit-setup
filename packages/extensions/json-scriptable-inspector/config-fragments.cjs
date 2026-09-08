'use strict';

const fs = require('fs');
const path = require('path');

const FRAGMENTS_KEY = '$fragments';
const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeTargetPath(value) {
  const target = String(value || '').trim();
  const parts = target.split('.').map(part => part.trim());
  if (!parts.length || parts.some(part => !part || FORBIDDEN_PATH_PARTS.has(part) || part === FRAGMENTS_KEY)) {
    throw new Error(`Invalid config fragment target "${value}"`);
  }
  return parts;
}

function normalizeResourcePath(value) {
  if (typeof value !== 'string') {
    throw new Error(`Invalid config fragment resource path "${String(value)}"`);
  }
  let resourcePath = String(value || '').trim().replace(/\\/g, '/');
  resourcePath = resourcePath.replace(/^resources\//, '').replace(/\.json$/i, '');
  const parts = resourcePath.split('/');
  if (!resourcePath || path.posix.isAbsolute(resourcePath)
    || parts.some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error(`Invalid config fragment resource path "${value}"`);
  }
  return resourcePath;
}

function validateFragmentMap(fragmentMap) {
  if (fragmentMap === undefined) return [];
  if (!fragmentMap || typeof fragmentMap !== 'object' || Array.isArray(fragmentMap)) {
    throw new Error(`${FRAGMENTS_KEY} must be an object mapping target paths to resource paths`);
  }

  const entries = Object.entries(fragmentMap).map(([target, resourcePath]) => ({
    target,
    targetParts: normalizeTargetPath(target),
    resourcePath: normalizeResourcePath(resourcePath),
  }));
  if (entries.length > 64) throw new Error(`${FRAGMENTS_KEY} supports at most 64 entries`);

  const resourcePaths = new Set();
  for (const entry of entries) {
    if (resourcePaths.has(entry.resourcePath)) {
      throw new Error(`Config fragment resource path "${entry.resourcePath}" has more than one owner`);
    }
    resourcePaths.add(entry.resourcePath);
  }

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const left = entries[i].targetParts;
      const right = entries[j].targetParts;
      const shared = Math.min(left.length, right.length);
      let samePrefix = true;
      for (let k = 0; k < shared; k++) {
        if (left[k] !== right[k]) {
          samePrefix = false;
          break;
        }
      }
      if (samePrefix) {
        throw new Error(`Overlapping config fragment targets "${entries[i].target}" and "${entries[j].target}"`);
      }
    }
  }

  return entries;
}

function findResourcesRoot(configFile) {
  let current = path.dirname(path.resolve(configFile));
  while (true) {
    if (path.basename(current).toLowerCase() === 'resources'
      && path.basename(path.dirname(current)).toLowerCase() === 'assets') {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Config fragments require the manifest under assets/resources: ${configFile}`);
}

function resolveFragmentFile(resourcesRoot, resourcePath) {
  const normalized = normalizeResourcePath(resourcePath);
  const root = path.resolve(resourcesRoot);
  const file = path.resolve(root, ...normalized.split('/')) + '.json';
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Config fragment escapes assets/resources: ${resourcePath}`);
  }
  return file;
}

function getAtPath(source, parts) {
  let current = source;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function setAtPath(target, parts, value) {
  let current = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = cloneJson(value);
}

function deleteAtPath(target, parts) {
  let current = target;
  for (let i = 0; i < parts.length - 1; i++) {
    current = current?.[parts[i]];
    if (!current || typeof current !== 'object') return;
  }
  delete current[parts[parts.length - 1]];
}

function composeConfig(manifest, loadFragment) {
  const entries = validateFragmentMap(manifest?.[FRAGMENTS_KEY]);
  const merged = cloneJson(manifest || {});
  for (const entry of entries) {
    setAtPath(merged, entry.targetParts, loadFragment(entry));
  }
  return { merged, entries };
}

function loadMergedConfigFromFile(configFile) {
  const resolvedConfig = path.resolve(configFile);
  const manifest = JSON.parse(fs.readFileSync(resolvedConfig, 'utf8'));
  const resourcesRoot = findResourcesRoot(resolvedConfig);
  const result = composeConfig(manifest, entry => {
    const fragmentFile = resolveFragmentFile(resourcesRoot, entry.resourcePath);
    if (!fs.existsSync(fragmentFile)) {
      throw new Error(`Missing config fragment "${entry.resourcePath}" at ${fragmentFile}`);
    }
    return JSON.parse(fs.readFileSync(fragmentFile, 'utf8'));
  });
  return { ...result, manifest, resourcesRoot };
}

function writeJsonAtomic(file, value) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const tempFile = path.join(directory, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempFile, file);
}

function splitMergedConfig(mergedConfig) {
  const fragmentMap = mergedConfig?.[FRAGMENTS_KEY];
  const entries = validateFragmentMap(fragmentMap);
  const root = cloneJson(mergedConfig || {});
  const fragments = [];
  for (const entry of entries) {
    const value = getAtPath(mergedConfig, entry.targetParts);
    fragments.push({ ...entry, value: value === undefined ? null : cloneJson(value) });
    deleteAtPath(root, entry.targetParts);
  }
  root[FRAGMENTS_KEY] = cloneJson(fragmentMap || {});
  return { root, fragments };
}

function saveMergedConfigToFile(configFile, mergedConfig) {
  const resolvedConfig = path.resolve(configFile);
  const { root, fragments } = splitMergedConfig(mergedConfig);
  if (!fragments.length) {
    writeJsonAtomic(resolvedConfig, root);
    return { files: [resolvedConfig], fragmentCount: 0 };
  }

  const resourcesRoot = findResourcesRoot(resolvedConfig);
  const writes = fragments.map(fragment => ({
    file: resolveFragmentFile(resourcesRoot, fragment.resourcePath),
    value: fragment.value,
  }));
  for (const write of writes) writeJsonAtomic(write.file, write.value);
  writeJsonAtomic(resolvedConfig, root);
  return {
    files: [resolvedConfig, ...writes.map(write => write.file)],
    fragmentCount: fragments.length,
    resourcesRoot,
  };
}

module.exports = {
  FRAGMENTS_KEY,
  composeConfig,
  deleteAtPath,
  findResourcesRoot,
  getAtPath,
  loadMergedConfigFromFile,
  normalizeResourcePath,
  normalizeTargetPath,
  resolveFragmentFile,
  saveMergedConfigToFile,
  setAtPath,
  splitMergedConfig,
  validateFragmentMap,
  writeJsonAtomic,
};
