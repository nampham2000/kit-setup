'use strict';

// Unity flips triangle winding for a renderer whose world matrix has a negative
// determinant (odd count of negative scale axes); Cocos 3.8.8 does not, so the
// mirrored mesh renders inside out. Rotation has determinant +1, so the sign of a
// transform chain is the product of the local scale determinants. This module
// finds renderer nodes whose prefab-local chain is mirrored in a generated Cocos
// prefab builder graph. The runtime adapter (runtime/UnityMirroredCulling.ts)
// re-checks the world sign every frame, so ancestors added at runtime are covered
// there; this pass only decides where the porter attaches it.

const RENDERER_TYPES = new Set(['cc.MeshRenderer', 'cc.SkinnedMeshRenderer']);
// Unity class ids: MeshRenderer 23, SkinnedMeshRenderer 137, PrefabInstance 1001.
const UNITY_RENDERER_CLASS_IDS = new Set([23, 137]);

function refId(ref) {
  const id = Number(ref?.__id__);
  return Number.isInteger(id) ? id : null;
}

function scaleDeterminant(scale) {
  if (!scale) return 1;
  const x = Number(scale.x ?? 1);
  const y = Number(scale.y ?? 1);
  const z = Number(scale.z ?? 1);
  return x * y * z;
}

/** Local scale of a node; nested prefab instance roots carry it as a property override. */
function nodeLocalScale(builder, nodeId) {
  const objects = builder?.objects || [];
  const node = objects[nodeId];
  if (!node) return null;
  const nested = builder?.nestedPrefabInstanceByNode?.get?.(nodeId);
  if (nested) {
    const instance = objects[nested.instanceId];
    for (const ref of instance?.propertyOverrides || []) {
      const override = objects[refId(ref)];
      if (!override || override.__type__ !== 'CCPropertyOverrideInfo') continue;
      const path = override.propertyPath || [];
      if (path.length !== 1 || path[0] !== '_lscale') continue;
      const target = objects[refId(override.targetInfo)];
      const localIds = target?.localID || [];
      if (localIds.length === 1 && localIds[0] === nested.rootLocalId) return override.value || null;
    }
    return null;
  }
  return node._lscale || null;
}

/** Sign (-1, 0 or 1) of the determinant of the node's prefab-local world transform chain. */
function prefabChainDeterminantSign(builder, nodeId) {
  const objects = builder?.objects || [];
  let sign = 1;
  const seen = new Set();
  for (let id = nodeId; id !== null && id !== undefined && !seen.has(id); id = refId(objects[id]?._parent)) {
    seen.add(id);
    if (objects[id]?.__type__ !== 'cc.Node') break;
    const det = scaleDeterminant(nodeLocalScale(builder, id));
    if (det === 0 || !Number.isFinite(det)) return 0;
    if (det < 0) sign = -sign;
  }
  return sign;
}

function nodeRendererTypes(builder, nodeId) {
  const objects = builder?.objects || [];
  const types = [];
  for (const ref of objects[nodeId]?._components || []) {
    const type = objects[refId(ref)]?.__type__;
    if (RENDERER_TYPES.has(type)) types.push(type);
  }
  return types;
}

/** Whether a Unity prefab model may contain mesh renderers (own, nested prefab or model instance). */
function unityModelMayHaveRenderers(model) {
  if (!model) return true;
  for (const doc of model.componentDocs?.values?.() || []) {
    if (UNITY_RENDERER_CLASS_IDS.has(Number(doc?.classId))) return true;
  }
  for (const doc of model.byId?.values?.() || []) {
    if (Number(doc?.classId) === 1001) return true;
  }
  for (const gameObject of model.gameObjects?.values?.() || []) {
    if (gameObject?.syntheticModelAsset || gameObject?.nestedPrefab) return true;
  }
  return false;
}

/**
 * Renderer nodes (and nested prefab instance roots that may hold renderers)
 * whose prefab-local chain has a negative determinant.
 * Returns [{ nodeId, includeDescendants, rendererTypes }].
 */
function findMirroredRendererNodes(builder) {
  const objects = builder?.objects || [];
  const result = [];
  const hints = builder?.nestedPrefabRendererHint;
  for (let nodeId = 0; nodeId < objects.length; nodeId++) {
    if (objects[nodeId]?.__type__ !== 'cc.Node') continue;
    const nested = builder?.nestedPrefabInstanceByNode?.has?.(nodeId);
    const rendererTypes = nodeRendererTypes(builder, nodeId);
    if (!nested && rendererTypes.length === 0) continue;
    if (nested && hints?.has?.(nodeId) && !hints.get(nodeId)) continue;
    if (prefabChainDeterminantSign(builder, nodeId) >= 0) continue;
    result.push({ nodeId, includeDescendants: !!nested, rendererTypes });
  }
  return result;
}

module.exports = {
  RENDERER_TYPES,
  scaleDeterminant,
  nodeLocalScale,
  prefabChainDeterminantSign,
  unityModelMayHaveRenderers,
  findMirroredRendererNodes,
};
