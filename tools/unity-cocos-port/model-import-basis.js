'use strict';
const fs = require('node:fs');

// Unity and Cocos import the same FBX file into different bases. Unity's importer
// reflects X (FBX is right-handed, Unity left-handed) and multiplies vertices and
// node positions by ModelImporter.globalScale; the Cocos FBX importer keeps the
// file's right-handed axes and ignores globalScale. Both apply the file unit scale
// and keep the Z-up -> Y-up conversion in node transforms (Unity with
// bakeAxisConversion off). Measured on the ten ARPG Effects FBX meshes against
// Unity's imported data (fixtures/model-import-basis.json): every Cocos vertex is
// Unity's (-x, y, z) / globalScale to 1e-7 of the mesh diagonal, and every node
// transform is Unity's reflected through X with its position / globalScale.
// The porter reflects Z for Unity transforms, so a Cocos FBX mesh drawn under a
// converted Unity transform needs diag(-k, k, -k) = (Y180 turn) * k, k = globalScale.

const MESH_CLASS_ID = '43';
const RENDERER_CLASS_ID = '23';

function readModelImporterMeta(modelAsset) {
  const file = modelAsset?.path ? `${modelAsset.path}.meta` : '';
  if (!file || !fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  if (!lines.some((line) => /^ModelImporter:\s*$/.test(line))) return null;
  const meshes = {};
  const meshNames = new Map();
  const rendererNames = new Map();
  let section = '';
  let pending = null;
  for (const line of lines) {
    const header = /^ {2}(\w+):\s*(.*)$/.exec(line);
    if (header) {
      section = header[1];
      pending = null;
      continue;
    }
    if (section === 'meshes') {
      const field = /^ {4}(\w+):\s*(.*?)\s*$/.exec(line);
      if (field) meshes[field[1]] = field[2];
    } else if (section === 'fileIDToRecycleName') {
      // Legacy table: "    4300002: Object001". Mesh file IDs are 43xxxxx.
      const entry = /^ {4}(-?\d+):\s*(.*?)\s*$/.exec(line);
      if (entry && /^43\d{5}$/.test(entry[1])) meshNames.set(entry[1], entry[2]);
      if (entry && /^23\d{5}$/.test(entry[1])) rendererNames.set(entry[1], entry[2]);
    } else if (section === 'internalIDToNameTable') {
      // "  - first:\n      43: 4300000\n    second: Name"
      if (/^ {2}- first:\s*$/.test(line)) { pending = null; continue; }
      const first = /^ {6}(\d+):\s*(-?\d+)\s*$/.exec(line);
      if (first) { pending = { classId: first[1], fileId: first[2] }; continue; }
      const second = /^ {4}second:\s*(.*?)\s*$/.exec(line);
      if (second && pending?.classId === MESH_CLASS_ID) meshNames.set(pending.fileId, second[1]);
      if (second && pending?.classId === RENDERER_CLASS_ID) rendererNames.set(pending.fileId, second[1]);
      if (second) pending = null;
    }
  }
  const number = (value, fallback) => {
    const parsed = Number(value);
    return value == null || value === '' || !Number.isFinite(parsed) ? fallback : parsed;
  };
  return {
    globalScale: number(meshes.globalScale, 1),
    useFileScale: number(meshes.useFileScale, 1) !== 0,
    bakeAxisConversion: number(meshes.bakeAxisConversion, 0) !== 0,
    preserveHierarchy: number(meshes.preserveHierarchy, 0) !== 0,
    meshNames,
    rendererNames,
  };
}

/**
 * The measured Unity -> Cocos FBX import basis for one model asset, or null when
 * the asset is not an FBX model. `supported` is false for importer settings whose
 * basis was not measured (the caller must report them instead of guessing).
 */
function unityModelImportBasis(modelAsset) {
  if (!modelAsset || String(modelAsset.ext || '').toLowerCase() !== '.fbx') return null;
  const meta = readModelImporterMeta(modelAsset);
  if (!meta) return { supported: false, scale: 1, preserveHierarchy: false, reasons: ['ModelImporter meta is missing'] };
  const reasons = [];
  if (!meta.useFileScale) reasons.push('useFileScale=0 keeps raw file units in Unity while Cocos converts them');
  if (meta.bakeAxisConversion) reasons.push('bakeAxisConversion=1 bakes the axis rotation into Unity vertices');
  if (!(meta.globalScale > 0)) reasons.push(`globalScale=${meta.globalScale} is not a positive scale`);
  return {
    supported: reasons.length === 0,
    scale: meta.globalScale > 0 ? meta.globalScale : 1,
    preserveHierarchy: meta.preserveHierarchy,
    reasons,
  };
}

/** Unity mesh sub-asset name for a model mesh file ID (both importer name tables). */
function unityModelMeshName(modelAsset, fileId) {
  const id = String(fileId ?? '').trim();
  if (!id || !modelAsset) return '';
  return readModelImporterMeta(modelAsset)?.meshNames.get(id) || '';
}

/** FBX node name of a Unity model renderer file ID ("//RootNode" is the merged root). */
function unityModelRendererName(modelAsset, fileId) {
  const id = String(fileId ?? '').trim();
  if (!id || !modelAsset) return '';
  return readModelImporterMeta(modelAsset)?.rendererNames.get(id) || '';
}

module.exports = { readModelImporterMeta, unityModelImportBasis, unityModelMeshName, unityModelRendererName };
