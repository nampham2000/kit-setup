'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const { unityModelImportBasis } = require('./model-import-basis');

const RUNTIME = 'UnityModelMeshBasis';

/**
 * Records that a renderer component draws a Cocos FBX mesh under a converted Unity
 * transform. Returns the basis, or null when the mesh is not an FBX model mesh.
 */
function requestModelMeshBasis(builder, reporter, options, nodeId, rendererId, meshAsset, label) {
  const basis = unityModelImportBasis(meshAsset);
  if (!basis || !Number.isInteger(nodeId) || !Number.isInteger(rendererId)) return null;
  if (!basis.supported) {
    reporter.high('UNITY_MODEL_IMPORT_BASIS_UNMEASURED', meshAsset.relativePath || '', label || '',
      `Unity ModelImporter settings have no measured Cocos basis: ${basis.reasons.join('; ')}`);
    return null;
  }
  (builder.modelMeshBasisRequests ||= []).push({ nodeId, rendererId, scale: basis.scale, source: meshAsset.relativePath || '', label: label || '' });
  return basis;
}

/**
 * Detaches the basis bound to one renderer (a scene override replaced its mesh after
 * the nested prefab was built). The prefab clone only copies reachable objects.
 */
function removeModelMeshBasis(builder, rendererId) {
  const renderer = builder.objects[rendererId];
  const node = builder.objects[renderer?.node?.__id__];
  if (!node?._components) return 0;
  const before = node._components.length;
  node._components = node._components.filter((ref) => {
    const component = builder.objects[ref?.__id__];
    const fileId = builder.objects[component?.__prefab?.__id__]?.fileId || '';
    return !(component?.source?.__id__ === rendererId && fileId.startsWith('cmp-unity-model-basis-'));
  });
  builder.modelMeshBasisRequests = (builder.modelMeshBasisRequests || []).filter((request) => request.rendererId !== rendererId);
  return before - node._components.length;
}

function stageModelMeshBasisRuntime(options) {
  if (options.dryRun) return;
  const target = path.join(options.cocosRoot, 'assets/script', `${RUNTIME}.ts`);
  const text = fs.readFileSync(path.join(__dirname, 'runtime', `${RUNTIME}.ts`), 'utf8');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // AssetDB owns .meta creation and UUIDs; a first import needs a refresh and another porter pass.
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text);
}

function attachModelMeshBasisRuntime(builder, reporter, options) {
  const requests = builder.modelMeshBasisRequests || [];
  if (!requests.length) return;
  stageModelMeshBasisRuntime(options);
  let classId = builder.cocosDb?.findScriptClass?.(RUNTIME)?.classId;
  const meta = path.join(options.cocosRoot, 'assets/script', `${RUNTIME}.ts.meta`);
  if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
  for (const request of requests) {
    if (!classId) {
      reporter.high('UNITY_MODEL_MESH_BASIS_ADAPTER_REQUIRED', request.source, request.label,
        `FBX mesh needs assets/script/${RUNTIME}.ts imported by AssetDB (Unity draws it reflected and scaled by ${request.scale}); refresh and rerun porter.`);
      continue;
    }
    builder.addComponent(request.nodeId, classId, {
      source: { __id__: request.rendererId },
      scale: request.scale,
    }, null, `cmp-unity-model-basis-${request.rendererId}`);
    reporter.low('UNITY_MODEL_MESH_BASIS_BOUND', request.source, request.label,
      `Cocos FBX mesh re-expressed in Unity's import basis diag(-k, k, -k), k = ${request.scale}`);
  }
  builder.modelMeshBasisRequests = [];
}

module.exports = { requestModelMeshBasis, removeModelMeshBasis, stageModelMeshBasisRuntime, attachModelMeshBasisRuntime };
