'use strict';
const { matchUnitySubAssetName } = require('./unity-file-id');

// Unity addresses an FBX mesh by a deterministic fileID, int64(xxHash64("Type:Mesh->" + name + i)),
// where `name` is the Unity mesh name (Unity names an FBX mesh after the node that carries it) and
// `i` counts earlier meshes with the same name. Cocos names the imported mesh sub-assets after the
// FBX geometry, which may be unnamed: the FBX-glTF converter then emits "Scene-<n>.mesh", so the
// fileID cannot be matched against Cocos mesh names. The imported Cocos scene prefab (gltf-scene
// sub-asset) keeps the FBX node names and binds each node's MeshRenderer to its mesh sub-asset, so
// hashing the renderer node names reproduces Unity's mesh names deterministically.

const RENDERER_TYPES = new Set(['cc.MeshRenderer', 'cc.SkinnedMeshRenderer']);

/**
 * Ordered mesh-carrying nodes of an imported Cocos model scene prefab (library JSON array):
 * [{ nodeName, meshUuid }] in depth-first child order from the prefab root (FBX node order).
 */
function sceneMeshNodes(objects) {
  if (!Array.isArray(objects)) return [];
  const rootId = objects[0]?.data?.__id__;
  if (!Number.isInteger(rootId)) return [];
  const renderersByNode = new Map();
  for (const object of objects) {
    if (!RENDERER_TYPES.has(object?.__type__)) continue;
    const nodeId = object.node?.__id__;
    const meshUuid = object._mesh?.__uuid__ || '';
    if (Number.isInteger(nodeId) && meshUuid && !renderersByNode.has(nodeId)) renderersByNode.set(nodeId, meshUuid);
  }
  const result = [];
  const seen = new Set();
  const visit = (id) => {
    if (!Number.isInteger(id) || seen.has(id)) return;
    seen.add(id);
    const node = objects[id];
    if (!node) return;
    if (renderersByNode.has(id)) result.push({ nodeName: String(node._name || ''), meshUuid: renderersByNode.get(id) });
    for (const child of node._children || []) visit(child?.__id__);
  };
  visit(rootId);
  return result;
}

/**
 * Resolves a Unity mesh fileID to a Cocos mesh uuid through the scene prefab node names.
 * Returns { meshUuid, nodeName, index } or null. Distinct nodes sharing one mesh collapse
 * to a single Unity mesh (Unity names the shared mesh after its first node).
 */
function meshUuidByUnitySceneNode(nodes, unityFileId) {
  if (!unityFileId || !nodes.length) return null;
  const firstNodeOfMesh = [];
  const seenMeshes = new Set();
  for (const node of nodes) {
    if (seenMeshes.has(node.meshUuid)) continue;
    seenMeshes.add(node.meshUuid);
    firstNodeOfMesh.push(node);
  }
  const names = [...new Set(firstNodeOfMesh.map((node) => node.nodeName))];
  const match = matchUnitySubAssetName('Mesh', names, unityFileId);
  if (!match) return null;
  const sameName = firstNodeOfMesh.filter((node) => node.nodeName === match.name);
  const node = sameName[match.index];
  if (!node) return null;
  return { meshUuid: node.meshUuid, nodeName: node.nodeName, index: match.index };
}

/** Unique scene node whose name equals `name` exactly (legacy fileIDToRecycleName tables). */
function meshUuidBySceneNodeName(nodes, name) {
  const wanted = String(name || '');
  if (!wanted) return null;
  const meshes = new Set(nodes.filter((node) => node.nodeName === wanted).map((node) => node.meshUuid));
  if (meshes.size !== 1) return null;
  return { meshUuid: [...meshes][0], nodeName: wanted };
}

/**
 * Reports a mesh resolution that is not backed by deterministic evidence. `resolved` is the
 * result of CocosAssetDatabase.resolveModelMeshByStem. Returns true when a `high` was reported.
 */
function reportModelMeshResolution(reporter, resolved, file, objectName) {
  if (!resolved || !reporter?.high) return false;
  if (resolved.meshMatch === 'unresolved') {
    reporter.high('MODEL_MESH_SUBASSET_UNRESOLVED', file, objectName,
      `Unity mesh fileID ${resolved.unityFileId} matches none of the ${resolved.meshCount} Cocos mesh sub-assets of ${resolved.source} `
      + '(neither the mesh names nor the imported scene node names hash to it); the mesh is left unbound instead of binding the first mesh',
      resolved.source);
    return true;
  }
  if (resolved.meshMatch === 'first-fallback') {
    reporter.high('MODEL_MESH_SUBASSET_AMBIGUOUS', file, objectName,
      `No Unity mesh fileID or name identifies one of the ${resolved.meshCount} Cocos mesh sub-assets of ${resolved.source}; `
      + 'the first mesh was bound and must be verified against the Unity mesh',
      resolved.meshUuid);
    return true;
  }
  return false;
}

module.exports = { sceneMeshNodes, meshUuidByUnitySceneNode, meshUuidBySceneNodeName, reportModelMeshResolution };
