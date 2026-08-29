'use strict';

/**
 * Unity YAML asset -> material -> shader dependency closure.
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
const { createPathBoundary, inspectContainedPath } = require('../lib/path-boundary.cjs');

const GUID_RE = /guid:\s*([0-9a-f]{32})/g;
const SHADER_REF_RE = /m_Shader:\s*\{fileID:\s*-?\d+,\s*guid:\s*([0-9a-f]{32})/;
const TEXTURE_EXT = /\.(png|jpg|jpeg|tga|psd|exr|hdr|tif|tiff|bmp|gif)$/i;
const MESH_EXT = /\.(fbx|obj|blend|dae|3ds)$/i;

/**
 * Index every `.meta` in the Unity project so GUIDs resolve to files.
 * Cached on disk: the walk dominates runtime on a real project (~2k assets),
 * and a chain query is usually one of many in a porting session.
 */
function normalizedRoot(value) {
  const resolved = path.resolve(value).replace(/\\/g, '/');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
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
  const assetsRoot = path.resolve(unityAssetsRoot);
  const unityProjectRoot = findUnityProjectRoot(assetsRoot);
  const stateFingerprint = unityProjectRoot
    ? computeUnityProjectState(unityProjectRoot).fingerprint
    : fallbackMetaFingerprint(assetsRoot);
  const key = projectKey(unityProjectRoot || assetsRoot);
  const cachePath = path.resolve(options.cachePath || path.join(resolveDefaultCacheDir(), 'shader-guid', `${key}.json`));
  const protectedRoots = [assetsRoot, unityProjectRoot].filter(Boolean);
  assertExternalCacheLocation(path.dirname(cachePath), protectedRoots);
  return { assetsRoot, key, stateFingerprint, cachePath, protectedRoots };
}

function cachedGuidMap(context, guids) {
  if (!guids || typeof guids !== 'object' || Array.isArray(guids)) return null;

  let boundary;
  try {
    boundary = createPathBoundary(context.assetsRoot);
  } catch {
    return null;
  }

  const guidToFile = new Map();
  for (const [guid, relative] of Object.entries(guids)) {
    if (!/^[0-9a-f]{32}$/.test(guid) || typeof relative !== 'string' || relative.length === 0) {
      return null;
    }
    if (path.isAbsolute(relative) || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
      return null;
    }

    const portable = relative.replace(/\\/g, '/');
    const segments = portable.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      return null;
    }

    const candidate = path.resolve(context.assetsRoot, ...segments);
    const asset = inspectContainedPath(boundary, candidate);
    const meta = inspectContainedPath(boundary, `${candidate}.meta`);
    if (!asset || !meta || !meta.stat.isFile()) return null;
    guidToFile.set(guid, asset.resolvedPath);
  }
  return guidToFile;
}

function buildGuidIndex(unityAssetsRoot, options = {}) {
  const context = options.noCache ? null : guidCacheContext(unityAssetsRoot, options);
  const cachePath = context && context.cachePath;

  if (context && fs.existsSync(cachePath)) {
    try {
      const cacheStat = fs.lstatSync(cachePath);
      if (cacheStat.isSymbolicLink() || !cacheStat.isFile()) {
        throw new Error('Shader GUID cache file must be a regular file, not a symlink.');
      }
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached.schemaVersion === 1 && cached.projectKey === context.key &&
          cached.stateFingerprint === context.stateFingerprint && cached.guids) {
        const guidToFile = cachedGuidMap(context, cached.guids);
        if (guidToFile) return { guidToFile, fromCache: true };
      }
    } catch { /* rebuild on any cache problem */ }
  }

  const guidToFile = new Map();
  for (const metaFile of containedMetaFiles(unityAssetsRoot)) {
    let head;
    try { head = fs.readFileSync(metaFile, 'utf8').slice(0, 400); } catch { continue; }
    const match = /guid:\s*([0-9a-f]{32})/.exec(head);
    if (match) guidToFile.set(match[1], metaFile.slice(0, -5));
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
      const guids = Object.fromEntries([...guidToFile].map(([guid, file]) => [
        guid, path.relative(context.assetsRoot, file).replace(/\\/g, '/'),
      ]));
      fs.writeFileSync(temp, JSON.stringify({
        schemaVersion: 1,
        projectKey: context.key,
        stateFingerprint: context.stateFingerprint,
        guids,
      }), { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temp, cachePath);
    } catch {
      if (temp) try { fs.unlinkSync(temp); } catch { /* best effort */ }
    }
  }

  return { guidToFile, fromCache: false };
}

/** Every GUID referenced anywhere in a YAML asset file. */
function referencedGuids(filePath) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch { return []; }
  const out = new Set();
  for (const m of text.matchAll(GUID_RE)) out.add(m[1]);
  return [...out];
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

  const { guidToFile, fromCache } = buildGuidIndex(unityAssetsRoot, options);

  const materials = [];
  const shaderByPath = new Map();
  const textures = new Set();
  const meshes = new Set();
  const unresolved = new Set();

  for (const guid of referencedGuids(prefabPath)) {
    const file = guidToFile.get(guid);
    if (!file) { unresolved.add(guid); continue; }

    if (file.endsWith('.mat')) {
      const matText = fs.readFileSync(file, 'utf8');
      const shaderGuid = (SHADER_REF_RE.exec(matText) || [])[1];
      const shaderFile = shaderGuid ? guidToFile.get(shaderGuid) : undefined;

      // Textures the material itself binds -- these are the ones that must be
      // imported for the material to look right, distinct from anything the
      // prefab happens to reference.
      const matTextures = [];
      for (const g of referencedGuids(file)) {
        const f = guidToFile.get(g);
        if (f && TEXTURE_EXT.test(f)) { matTextures.push(f); textures.add(f); }
      }

      materials.push({
        path: file,
        name: path.basename(file, '.mat'),
        shader: shaderFile || null,
        shaderGuid: shaderGuid || null,
        // A shader GUID that resolves to nothing is a Unity built-in or a
        // package shader: there is no .shader file on disk to transpile.
        shaderIsBuiltin: Boolean(shaderGuid && !shaderFile),
        textures: matTextures,
      });
      if (shaderFile && shaderFile.endsWith('.shader')) {
        shaderByPath.set(shaderFile, (shaderByPath.get(shaderFile) || 0) + 1);
      }
      continue;
    }

    if (TEXTURE_EXT.test(file)) { textures.add(file); continue; }
    if (MESH_EXT.test(file)) { meshes.add(file); continue; }
  }

  const shaders = [...shaderByPath.entries()].map(([p, usedBy]) => ({
    path: p, name: path.basename(p, '.shader'), usedByMaterials: usedBy,
  }));

  const sourceExtension = path.extname(prefabPath).toLowerCase();
  return {
    prefab: prefabPath,
    sourceAsset: prefabPath,
    sourceKind: sourceExtension === '.prefab' ? 'prefab'
      : sourceExtension === '.asset' ? 'scriptable-object'
        : 'unity-yaml',
    materialSetDetected: sourceExtension === '.asset' && materials.length > 1,
    materials,
    shaders,
    textures: [...textures],
    meshes: [...meshes],
    unresolved: [...unresolved],
    indexSize: guidToFile.size,
    fromCache,
  };
}

module.exports = {
  resolveChain,
  buildGuidIndex,
  referencedGuids,
  guidCacheContext,
  fallbackMetaFingerprint,
  normalizedRoot,
};
