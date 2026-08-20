'use strict';

/**
 * Prefab -> material -> shader dependency closure.
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

const GUID_RE = /guid:\s*([0-9a-f]{32})/g;
const SHADER_REF_RE = /m_Shader:\s*\{fileID:\s*-?\d+,\s*guid:\s*([0-9a-f]{32})/;
const TEXTURE_EXT = /\.(png|jpg|jpeg|tga|psd|exr|hdr|tif|tiff|bmp|gif)$/i;
const MESH_EXT = /\.(fbx|obj|blend|dae|3ds)$/i;

/**
 * Index every `.meta` in the Unity project so GUIDs resolve to files.
 * Cached on disk: the walk dominates runtime on a real project (~2k assets),
 * and a chain query is usually one of many in a porting session.
 */
function buildGuidIndex(unityAssetsRoot, options = {}) {
  const cachePath = options.cachePath ||
    path.join(unityAssetsRoot, '..', '.ucshader-guid-index.json');

  if (!options.noCache && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached.root === unityAssetsRoot && cached.guids) {
        return { guidToFile: new Map(Object.entries(cached.guids)), fromCache: true };
      }
    } catch { /* rebuild on any cache problem */ }
  }

  const guidToFile = new Map();
  const stack = [unityAssetsRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (!e.name.endsWith('.meta')) continue;
      let head;
      try { head = fs.readFileSync(p, 'utf8').slice(0, 400); } catch { continue; }
      const m = /guid:\s*([0-9a-f]{32})/.exec(head);
      if (m) guidToFile.set(m[1], p.slice(0, -5));
    }
  }

  try {
    fs.writeFileSync(cachePath, JSON.stringify({
      root: unityAssetsRoot,
      guids: Object.fromEntries(guidToFile),
    }), 'utf8');
  } catch { /* cache is an optimisation, not a requirement */ }

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
  if (!fs.existsSync(prefabPath)) throw new Error(`Prefab not found: ${prefabPath}`);
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

  return {
    prefab: prefabPath,
    materials,
    shaders,
    textures: [...textures],
    meshes: [...meshes],
    unresolved: [...unresolved],
    indexSize: guidToFile.size,
    fromCache,
  };
}

module.exports = { resolveChain, buildGuidIndex, referencedGuids };
