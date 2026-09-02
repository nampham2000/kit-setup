'use strict';

/**
 * Unity scene/YAML asset -> material -> shader dependency closure.
 *
 * Porting "a prefab with a couple of materials on it" is three lookups deep:
 * the prefab references material GUIDs, each material references a shader GUID
 * and texture GUIDs, and the shader is what actually has to be transpiled.
 * Done by hand that means reading a prefab, grepping .meta files for GUIDs, and
 * opening each .mat -- tens of thousands of tokens of YAML for a job whose
 * answer is a short list. This resolves the whole chain in one pass and reports
 * only the parts a caller has to act on.
 *
 * Reads only; nothing is written unless an output directory is given.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assertExternalCacheLocation, resolveDefaultCacheDir } = require('../unity-intel/cache.cjs');
const { findUnityProjectRoot } = require('../unity-intel/project-index.cjs');
const { computeUnityProjectState, projectKey } = require('../unity-intel/project-state.cjs');
const { discoverPackageRoots } = require('../unity-intel/package-roots.cjs');
const { BUILTIN_GUIDS } = require('../unity-intel/guid-index.cjs');
const { createPathBoundary, inspectContainedPath } = require('../lib/path-boundary.cjs');

const GUID_RE = /guid:\s*([0-9a-f]{32})/g;
const SHADER_REF_RE = /m_Shader:\s*\{fileID:\s*-?\d+,\s*guid:\s*([0-9a-f]{32})/;
const TEXTURE_EXT = /\.(png|jpg|jpeg|tga|psd|exr|hdr|tif|tiff|bmp|gif)$/i;
const MESH_EXT = /\.(fbx|obj|blend|dae|3ds)$/i;
const SHADER_SOURCE_EXT = /\.(shader|tcp2shader)$/i;
const YAML_CLOSURE_EXT = /\.(unity|prefab|asset)$/i;
const DEFAULT_MAX_CLOSURE_ASSETS = 4096;
const DEFAULT_MAX_CLOSURE_DEPTH = 32;

/**
 * Index every `.meta` in the Unity project so GUIDs resolve to files.
 * Cached on disk: the walk dominates runtime on a real project (~2k assets),
 * and a chain query is usually one of many in a porting session.
 */
function normalizedRoot(value) {
  const resolved = path.resolve(value).replace(/\\/g, '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function guidIndexRoots(unityAssetsRoot) {
  const assetsRoot = path.resolve(unityAssetsRoot);
  const unityProjectRoot = findUnityProjectRoot(assetsRoot);
  const roots = [{
    id: 'assets',
    physicalRoot: assetsRoot,
    precedence: 0,
    packageName: null,
  }];
  const packages = discoverPackageRoots(unityProjectRoot);
  for (const descriptor of packages.roots) {
    roots.push({
      id: `package:${descriptor.packageName}`,
      physicalRoot: path.resolve(descriptor.physicalRoot),
      precedence: descriptor.precedence,
      packageName: descriptor.packageName,
    });
  }
  roots.sort((a, b) => a.precedence - b.precedence || a.id.localeCompare(b.id));
  return { assetsRoot, unityProjectRoot, roots, packages };
}

function containedMetaFiles(unityAssetsRoot) {
  let boundary;
  try {
    boundary = createPathBoundary(unityAssetsRoot);
  } catch {
    return [];
  }

  const metaFiles = [];
  const stack = [boundary.resolvedRoot];
  while (stack.length) {
    const dir = stack.pop();
    let children;
    try { children = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      const full = path.join(dir, child.name);
      const inspected = inspectContainedPath(boundary, full);
      if (!inspected) continue;
      if (inspected.stat.isDirectory()) { stack.push(full); continue; }
      if (!inspected.stat.isFile() || !child.name.endsWith('.meta')) continue;
      if (!inspectContainedPath(boundary, full.slice(0, -5))) continue;
      metaFiles.push(full);
    }
  }
  return metaFiles;
}

function fallbackMetaFingerprint(unityAssetsRoot) {
  const entries = [];
  for (const metaFile of containedMetaFiles(unityAssetsRoot)) {
    try {
      const stat = fs.lstatSync(metaFile);
      entries.push(`${path.relative(unityAssetsRoot, metaFile).replace(/\\/g, '/')}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
    } catch { /* skip files disappearing during scan */ }
  }
  entries.sort();
  return crypto.createHash('sha256').update(entries.join('\n')).digest('hex');
}

function guidCacheContext(unityAssetsRoot, options) {
  const layout = guidIndexRoots(unityAssetsRoot);
  const { assetsRoot, unityProjectRoot, roots, packages } = layout;
  const stateFingerprint = unityProjectRoot
    ? computeUnityProjectState(unityProjectRoot).fingerprint
    : fallbackMetaFingerprint(assetsRoot);
  const key = projectKey(unityProjectRoot || assetsRoot);
  const cachePath = path.resolve(options.cachePath || path.join(resolveDefaultCacheDir(), 'shader-guid', `${key}.json`));
  const protectedRoots = [assetsRoot, unityProjectRoot, ...roots.map(root => root.physicalRoot)].filter(Boolean);
  assertExternalCacheLocation(path.dirname(cachePath), protectedRoots);
  return { assetsRoot, unityProjectRoot, roots, packages, key, stateFingerprint, cachePath, protectedRoots };
}

function cachedGuidMap(context, guids) {
  if (!guids || typeof guids !== 'object' || Array.isArray(guids)) return null;

  const rootsById = new Map(context.roots.map(root => [root.id, root]));
  const boundaries = new Map();
  for (const root of context.roots) {
    try { boundaries.set(root.id, createPathBoundary(root.physicalRoot)); }
    catch { return null; }
  }

  const guidToFile = new Map();
  const guidOrigins = new Map();
  for (const [guid, entry] of Object.entries(guids)) {
    if (!/^[0-9a-f]{32}$/.test(guid) || !entry || typeof entry !== 'object' || Array.isArray(entry) ||
        typeof entry.rootId !== 'string' || typeof entry.relative !== 'string' || entry.relative.length === 0) {
      return null;
    }
    const root = rootsById.get(entry.rootId);
    const boundary = boundaries.get(entry.rootId);
    if (!root || !boundary) return null;
    const relative = entry.relative;
    if (path.isAbsolute(relative) || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
      return null;
    }

    const portable = relative.replace(/\\/g, '/');
    const segments = portable.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      return null;
    }

    const candidate = path.resolve(root.physicalRoot, ...segments);
    const asset = inspectContainedPath(boundary, candidate);
    const meta = inspectContainedPath(boundary, `${candidate}.meta`);
    if (!asset || !meta || !meta.stat.isFile()) return null;
    guidToFile.set(guid, asset.resolvedPath);
    guidOrigins.set(guid, root);
  }
  return { guidToFile, guidOrigins };
}

function buildGuidIndex(unityAssetsRoot, options = {}) {
  const layout = guidIndexRoots(unityAssetsRoot);
  const context = options.noCache ? null : guidCacheContext(unityAssetsRoot, options);
  const cachePath = context && context.cachePath;

  if (context && fs.existsSync(cachePath)) {
    try {
      const cacheStat = fs.lstatSync(cachePath);
      if (cacheStat.isSymbolicLink() || !cacheStat.isFile()) {
        throw new Error('Shader GUID cache file must be a regular file, not a symlink.');
      }
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached.schemaVersion === 2 && cached.projectKey === context.key &&
          cached.stateFingerprint === context.stateFingerprint && cached.guids) {
        const restored = cachedGuidMap(context, cached.guids);
        if (restored) return {
          ...restored,
          roots: context.roots,
          packages: context.packages,
          fromCache: true,
        };
      }
    } catch { /* rebuild on any cache problem */ }
  }

  const guidToFile = new Map();
  const guidOrigins = new Map();
  for (const root of layout.roots) {
    for (const metaFile of containedMetaFiles(root.physicalRoot)) {
      let head;
      try { head = fs.readFileSync(metaFile, 'utf8').slice(0, 400); } catch { continue; }
      const match = /guid:\s*([0-9a-f]{32})/.exec(head);
      if (!match || guidToFile.has(match[1])) continue;
      guidToFile.set(match[1], metaFile.slice(0, -5));
      guidOrigins.set(match[1], root);
    }
  }

  if (context) {
    let temp = null;
    try {
      assertExternalCacheLocation(path.dirname(cachePath), context.protectedRoots);
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      assertExternalCacheLocation(path.dirname(cachePath), context.protectedRoots);
      if (fs.existsSync(cachePath) && fs.lstatSync(cachePath).isSymbolicLink()) {
        throw new Error('Shader GUID cache file must not be a symlink.');
      }
      temp = `${cachePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      const guids = Object.fromEntries([...guidToFile].map(([guid, file]) => {
        const root = guidOrigins.get(guid);
        return [guid, {
          rootId: root.id,
          relative: path.relative(root.physicalRoot, file).replace(/\\/g, '/'),
        }];
      }));
      fs.writeFileSync(temp, JSON.stringify({
        schemaVersion: 2,
        projectKey: context.key,
        stateFingerprint: context.stateFingerprint,
        guids,
      }), { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temp, cachePath);
    } catch {
      if (temp) try { fs.unlinkSync(temp); } catch { /* best effort */ }
    }
  }

  return {
    guidToFile,
    guidOrigins,
    roots: layout.roots,
    packages: layout.packages,
    fromCache: false,
  };
}

/** Every GUID referenced anywhere in a YAML asset file. */
function referencedGuids(filePath) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch { return []; }
  const out = new Set();
  for (const m of text.matchAll(GUID_RE)) out.add(m[1]);
  return [...out];
}

function boundedPositiveInteger(value, fallback, maximum, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function isClosureAsset(file) {
  return YAML_CLOSURE_EXT.test(file) || MESH_EXT.test(file) || file.endsWith('.mat');
}

/**
 * Resolve prefab -> materials -> shaders + textures.
 *
 * @param {string} prefabPath
 * @param {string} unityAssetsRoot
 * @param {{noCache?: boolean, cachePath?: string}} [options]
 * @returns {{prefab: string, materials: object[], shaders: object[],
 *            textures: string[], meshes: string[], unresolved: string[],
 *            indexSize: number, fromCache: boolean}}
 */
function resolveChain(prefabPath, unityAssetsRoot, options = {}) {
  if (!fs.existsSync(prefabPath)) throw new Error(`Unity YAML asset not found: ${prefabPath}`);
  if (!fs.existsSync(unityAssetsRoot)) throw new Error(`Unity Assets root not found: ${unityAssetsRoot}`);

  const {
    guidToFile,
    guidOrigins,
    roots,
    packages,
    fromCache,
  } = buildGuidIndex(unityAssetsRoot, options);
  const originByFile = new Map(
    [...guidToFile].map(([guid, file]) => [file, guidOrigins.get(guid) || null]),
  );
  const maxClosureAssets = boundedPositiveInteger(
    options.maxClosureAssets,
    DEFAULT_MAX_CLOSURE_ASSETS,
    20000,
    'maxClosureAssets',
  );
  const maxClosureDepth = boundedPositiveInteger(
    options.maxClosureDepth,
    DEFAULT_MAX_CLOSURE_DEPTH,
    128,
    'maxClosureDepth',
  );

  const materials = [];
  const materialPaths = new Set();
  const shaderByPath = new Map();
  const textures = new Set();
  const meshes = new Set();
  const unresolved = new Set();
  const visited = new Set();
  const queue = [{ file: path.resolve(prefabPath), depth: 0, via: 'source' }];
  let closureComplete = true;
  let deepestDepth = 0;
  let nestedPrefabCount = 0;
  let modelImporterCount = 0;

  const enqueueGuid = (guid, depth, via, unresolvedMatters = false) => {
    const normalizedGuid = String(guid || '').toLowerCase();
    if (!normalizedGuid || BUILTIN_GUIDS.has(normalizedGuid)) return;
    const file = guidToFile.get(normalizedGuid);
    if (!file) {
      if (unresolvedMatters) unresolved.add(normalizedGuid);
      return;
    }
    if (!isClosureAsset(file) && !TEXTURE_EXT.test(file)) return;
    queue.push({ file, depth, via, guid: normalizedGuid });
  };

  while (queue.length) {
    const current = queue.shift();
    const file = path.resolve(current.file);
    if (visited.has(file)) continue;
    if (visited.size >= maxClosureAssets || current.depth > maxClosureDepth) {
      closureComplete = false;
      break;
    }
    visited.add(file);
    deepestDepth = Math.max(deepestDepth, current.depth);
    const extension = path.extname(file).toLowerCase();

    if (TEXTURE_EXT.test(file)) {
      textures.add(file);
      continue;
    }

    if (MESH_EXT.test(file)) {
      meshes.add(file);
      modelImporterCount++;
      // Unity model materials are frequently stored as sub-assets of the FBX.
      // Their external remap lives in the ModelImporter .meta, not in the
      // binary FBX itself. Following only the prefab GUID therefore reports
      // zero materials for a visibly shaded model.
      const metaPath = `${file}.meta`;
      for (const guid of referencedGuids(metaPath)) {
        enqueueGuid(guid, current.depth + 1, 'model-importer', true);
      }
      continue;
    }

    if (extension === '.mat') {
      if (materialPaths.has(file)) continue;
      materialPaths.add(file);
      let matText;
      try { matText = fs.readFileSync(file, 'utf8'); }
      catch {
        closureComplete = false;
        continue;
      }
      const shaderGuid = ((SHADER_REF_RE.exec(matText) || [])[1] || '').toLowerCase() || null;
      const shaderFile = shaderGuid ? guidToFile.get(shaderGuid) : undefined;
      const shaderOrigin = shaderGuid ? guidOrigins.get(shaderGuid) : null;
      const matTextures = [];
      for (const guid of referencedGuids(file)) {
        const dependency = guidToFile.get(guid);
        if (!dependency || !TEXTURE_EXT.test(dependency)) continue;
        matTextures.push(dependency);
        textures.add(dependency);
      }
      if (shaderGuid && !shaderFile && !BUILTIN_GUIDS.has(shaderGuid)) unresolved.add(shaderGuid);
      materials.push({
        path: file,
        name: path.basename(file, '.mat'),
        discoveredVia: current.via,
        shader: shaderFile || null,
        shaderGuid,
        shaderIsBuiltin: Boolean(shaderGuid && !shaderFile),
        shaderOrigin: shaderOrigin ? (shaderOrigin.packageName ? 'package' : 'project') : null,
        shaderPackage: shaderOrigin ? shaderOrigin.packageName : null,
        textures: matTextures,
      });
      if (shaderFile && SHADER_SOURCE_EXT.test(shaderFile)) {
        shaderByPath.set(shaderFile, (shaderByPath.get(shaderFile) || 0) + 1);
      }
      continue;
    }

    if (!YAML_CLOSURE_EXT.test(file)) continue;
    if (extension === '.prefab' && current.depth > 0) nestedPrefabCount++;
    for (const guid of referencedGuids(file)) {
      enqueueGuid(guid, current.depth + 1, extension.slice(1), false);
    }
  }

  const shaders = [...shaderByPath.entries()].map(([p, usedBy]) => ({
    path: p,
    name: path.basename(p).replace(/\.(?:shader|tcp2shader)$/i, ''),
    usedByMaterials: usedBy,
    origin: (originByFile.get(p) || {}).packageName ? 'package' : 'project',
    packageName: (originByFile.get(p) || {}).packageName || null,
  }));

  const sourceExtension = path.extname(prefabPath).toLowerCase();
  return {
    prefab: prefabPath,
    sourceAsset: prefabPath,
    sourceKind: sourceExtension === '.prefab' ? 'prefab'
      : sourceExtension === '.asset' ? 'scriptable-object'
        : sourceExtension === '.unity' ? 'scene'
        : 'unity-yaml',
    materialSetDetected: sourceExtension === '.asset' && materials.length > 1,
    materials,
    shaders,
    textures: [...textures],
    meshes: [...meshes],
    unresolved: [...unresolved],
    indexSize: guidToFile.size,
    fromCache,
    closure: {
      complete: closureComplete,
      visitedAssetCount: visited.size,
      nestedPrefabCount,
      modelImporterCount,
      deepestDepth,
      maxAssets: maxClosureAssets,
      maxDepth: maxClosureDepth,
    },
    packageRoots: (roots || []).filter(root => root.packageName).map(root => root.packageName),
    unavailablePackages: (packages && packages.unavailable) || [],
  };
}

module.exports = {
  resolveChain,
  buildGuidIndex,
  referencedGuids,
  guidCacheContext,
  fallbackMetaFingerprint,
  normalizedRoot,
  guidIndexRoots,
};
