'use strict';

// Unity and Cocos import the same FBX mesh into different local spaces:
//   - Unity converts the file to its left-handed frame by negating X of every vertex;
//   - Cocos (FBX-glTF-conv) keeps the right-handed data and may bake a node pivot into the vertices that
//     Unity keeps on the node instead.
// So v_cocos = negX(v_unity) + t. The regular Unity -> Cocos transform conversion mirrors Z, which means a
// Cocos mesh attached directly to a converted Unity node must sit under the local basis
//   X = Ry(180) * T(-t)      (X * v_cocos == mirrorZ(v_unity))
// Linked model prefabs already receive the same Ry(180) on their mounted root (NESTED_MODEL_FORWARD_BASIS).
// This module covers meshes attached straight to a Unity node: unpacked FBX parts and single-mesh model
// roots collapsed into the prefab root. Tanks! measured 104/108 meshes as pure negX (t = 0); the rest carry
// a baked pivot that only Unity mesh-bounds evidence (--unity-object-map) can recover.

const CARRIER_ROTATION = Object.freeze({ x: 0, y: 1, z: 0, w: 0 }); // Cocos-space Ry(180)
const CARRIER_EULER = Object.freeze({ x: 0, y: 180, z: 0 });
const CARRIER_NAME_SUFFIX = ' (FBX mesh)';

function toVector(value) {
  if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0, z: Number(value[2]) || 0 };
  const v = value || {};
  return { x: Number(v.x) || 0, y: Number(v.y) || 0, z: Number(v.z) || 0 };
}

function normalizeBounds(bounds) {
  if (!bounds) return null;
  const min = bounds.min ?? bounds.minPosition;
  const max = bounds.max ?? bounds.maxPosition;
  if (!min || !max) return null;
  return { min: toVector(min), max: toVector(max) };
}

function center(bounds) {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
}

function size(bounds) {
  return {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  };
}

/**
 * Pivot t of v_cocos = negX(v_unity) + t, from the two mesh-local AABBs (an axis negation plus a translation
 * maps an AABB exactly onto an AABB). Without Unity evidence, or when the extents disagree (the importers
 * baked something other than a pivot), t falls back to zero and `verified` is false.
 */
function deriveFbxMeshPivot({ unityBounds, cocosBounds, tolerance = 0.002 } = {}) {
  const zero = { x: 0, y: 0, z: 0 };
  const cocos = normalizeBounds(cocosBounds);
  const unity = normalizeBounds(unityBounds);
  if (!cocos) return { translation: zero, verified: false, reason: 'cocos-bounds-missing' };
  if (!unity) return { translation: zero, verified: false, reason: 'unity-evidence-missing' };
  const su = size(unity);
  const sc = size(cocos);
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(su[axis] - sc[axis]) > tolerance * (1 + Math.abs(su[axis]))) {
      return { translation: zero, verified: false, reason: `extent-mismatch-${axis}` };
    }
  }
  const cu = center(unity);
  const cc = center(cocos);
  const clean = (n) => (Math.abs(n) < 1e-6 ? 0 : n);
  return {
    translation: { x: clean(cc.x + cu.x), y: clean(cc.y - cu.y), z: clean(cc.z - cu.z) },
    verified: true,
    reason: 'bounds-evidence',
  };
}

/** Cocos-space local transform of the carrier node that holds the Cocos mesh: Ry(180) * T(-t). */
function fbxMeshCarrierTransform(translation) {
  const t = toVector(translation);
  const clean = (n) => (Math.abs(n) < 1e-9 ? 0 : n);
  return {
    // -Ry(180) * t = (t.x, -t.y, t.z)
    position: { x: clean(t.x), y: clean(-t.y), z: clean(t.z) },
    rotation: { ...CARRIER_ROTATION },
    euler: { ...CARRIER_EULER },
  };
}

function isFbxModelAsset(asset) {
  return String(asset?.ext || asset?.path || '').toLowerCase().endsWith('.fbx');
}

/** Unity mesh-local bounds from unity-model-objects evidence: exact fileID first, else the model's only mesh or a name match. */
function unityMeshBoundsFromObjectMap(objectMap, modelGuid, { fileId = '', meshName = '' } = {}) {
  const objects = objectMap?.[modelGuid]?.objects;
  if (!objects) return null;
  if (fileId && objects[String(fileId)]?.bounds) return objects[String(fileId)].bounds;
  const meshes = Object.values(objects).filter((object) => object?.type === 'Mesh' && object.bounds);
  if (meshes.length === 1) return meshes[0].bounds;
  const key = String(meshName || '').toLowerCase().replace(/\.mesh$/, '').replace(/[^a-z0-9]/g, '');
  if (!key) return null;
  const named = meshes.filter((object) => String(object.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === key);
  return named.length === 1 ? named[0].bounds : null;
}

module.exports = {
  CARRIER_NAME_SUFFIX,
  deriveFbxMeshPivot,
  fbxMeshCarrierTransform,
  isFbxModelAsset,
  unityMeshBoundsFromObjectMap,
};
