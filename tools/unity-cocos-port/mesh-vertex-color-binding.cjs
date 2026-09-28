'use strict';

// Unity feeds (1,1,1,1) for a shader's COLOR input when the mesh has no colour stream; WebGL feeds
// (0,0,0,1) for a missing attribute. Transpiled effects that read vertex colour expose
// UNITY_MESH_NO_VERTEX_COLOR (cocos-effect-generator); this pass sets it on the materials whose every
// user is a MeshRenderer/SkinnedMeshRenderer drawing a source model without a colour layer
// (KriptoFX RFX4 Tornado: Tornado_Loop has no colours and rendered black).
// Evidence: the FBX copied into the Cocos project (`LayerElementColor` node present or not). Anything
// else (particle renderers, non-FBX meshes, unknown meshes) counts as coloured and leaves the default.

const fs = require('node:fs');
const path = require('node:path');

const DEFINE = 'UNITY_MESH_NO_VERTEX_COLOR';

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** uuid -> asset path for every `.meta` under assets/ (root uuid only; sub-asset ids share it). */
function assetIndex(cocosRoot) {
  const index = new Map();
  for (const file of walk(path.join(cocosRoot, 'assets'))) {
    if (!file.endsWith('.meta')) continue;
    try {
      const uuid = JSON.parse(fs.readFileSync(file, 'utf8')).uuid;
      if (uuid) index.set(uuid, file.slice(0, -5));
    } catch { /* not JSON */ }
  }
  return index;
}

/** FBX (binary or ASCII) with a vertex colour layer on any mesh. */
function fbxHasVertexColors(file) {
  return fs.readFileSync(file).includes('LayerElementColor');
}

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  return { text, json: JSON.parse(text) };
}

function writeJsonLike(file, original, json) {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  let text = JSON.stringify(json, null, 2).replace(/\n/g, eol);
  if (/\r?\n$/.test(original)) text += eol;
  if (text !== original) fs.writeFileSync(file, text);
  return text !== original;
}

/**
 * @param {{cocosRoot: string, prefabFiles: string[], dryRun?: boolean}} options
 * @returns {{set: string[], cleared: string[], mixed: string[], checked: number}}
 */
function bindMeshVertexColor({ cocosRoot, prefabFiles, dryRun = false }) {
  const index = assetIndex(cocosRoot);
  const effectReadsColor = new Map();
  const fbxColors = new Map();
  const usage = new Map(); // material path -> { noColor, colored }

  const effectDeclares = (materialPath) => {
    const material = readJson(materialPath).json;
    const effectPath = index.get(material?._effectAsset?.__uuid__);
    if (!effectPath) return false;
    if (!effectReadsColor.has(effectPath)) effectReadsColor.set(effectPath, fs.readFileSync(effectPath, 'utf8').includes(DEFINE));
    return effectReadsColor.get(effectPath);
  };
  const meshColored = (meshRef) => {
    const source = index.get(String(meshRef?.__uuid__ || '').split('@')[0]);
    if (!source || !/\.fbx$/i.test(source)) return true;
    if (!fbxColors.has(source)) fbxColors.set(source, fbxHasVertexColors(source));
    return fbxColors.get(source);
  };

  for (const prefab of prefabFiles) {
    let objects;
    try { objects = JSON.parse(fs.readFileSync(prefab, 'utf8')); } catch { continue; }
    if (!Array.isArray(objects)) continue;
    for (const object of objects) {
      const isMesh = object?.__type__ === 'cc.MeshRenderer' || object?.__type__ === 'cc.SkinnedMeshRenderer';
      // Particle renderers always supply per-particle colour.
      const materials = object?.__type__ === 'cc.ParticleSystemRenderer'
        ? [object._cpuMaterial, object._gpuMaterial, object._trailMaterial]
        : object?._materials;
      if (!Array.isArray(materials)) continue;
      const colored = !isMesh || meshColored(object._mesh);
      for (const ref of materials) {
        const materialPath = index.get(ref?.__uuid__);
        if (!materialPath || !materialPath.endsWith('.mtl')) continue;
        const entry = usage.get(materialPath) || { noColor: 0, colored: 0 };
        if (colored) entry.colored++; else entry.noColor++;
        usage.set(materialPath, entry);
      }
    }
  }

  const result = { set: [], cleared: [], mixed: [], checked: 0 };
  for (const [materialPath, entry] of usage) {
    if (!effectDeclares(materialPath)) continue;
    result.checked++;
    const { text, json } = readJson(materialPath);
    const defines = Array.isArray(json._defines) && json._defines.length ? json._defines : [{}];
    const want = entry.noColor > 0 && entry.colored === 0;
    if (entry.noColor > 0 && entry.colored > 0) result.mixed.push(path.relative(cocosRoot, materialPath).replace(/\\/g, '/'));
    const has = defines.some(d => d && d[DEFINE]);
    if (want === has) continue;
    for (const d of defines) {
      if (!d) continue;
      if (want) d[DEFINE] = true;
      else delete d[DEFINE];
    }
    json._defines = defines;
    (want ? result.set : result.cleared).push(path.relative(cocosRoot, materialPath).replace(/\\/g, '/'));
    if (!dryRun) writeJsonLike(materialPath, text, json);
  }
  return result;
}

module.exports = { bindMeshVertexColor, fbxHasVertexColors, DEFINE };
