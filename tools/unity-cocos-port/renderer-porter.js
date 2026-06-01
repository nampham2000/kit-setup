'use strict';

const fs = require('fs');
const path = require('path');
const { toPosix, sanitizeFileId } = require('./core-utils');

module.exports = function createRendererPorter(deps) {
  const {
    resolveUnityMaterialUuids,
    resolveUnityMaterialUuid,
    resolveUnityBuiltinMeshUuid,
    importedUnityAssetPath,
    copyUnityAssetToCocos,
    handleMissingModel,
    resolveLibraryAssetUuid,
    recordPendingMeshRepair,
    getField,
    getNestedList,
    unityRefGuid,
  } = deps;

  function emitSyntheticModelRenderer(gameObject, nodeId, builder, reporter, options, unityDb, cocosDb) {
    const modelAsset = gameObject.syntheticModelAsset;
    const meshNameHint = gameObject.syntheticModelName || gameObject.name;
    const componentId = `synthetic-model-${modelAsset.guid || modelAsset.uuid || gameObject.fileId}`;
    const componentFileId = `cmp-model-${sanitizeFileId(gameObject.name)}`;
    const resolved = cocosDb.resolveModelMeshByStem(modelAsset.stem, gameObject.syntheticModelName || gameObject.name);
    const overrideMaterialUuids = gameObject.syntheticModelMaterialOverrideGroups?.[0]?.materialAssets?.length
      ? resolveUnityMaterialUuids(gameObject.syntheticModelMaterialOverrideGroups[0].materialAssets, options, unityDb, cocosDb, reporter, gameObject.name)
      : [];
    if (resolved?.meshUuid) {
      builder.addMeshRenderer(
        nodeId,
        componentId,
        resolved.meshUuid,
        overrideMaterialUuids.length ? overrideMaterialUuids : (resolved.materialUuids || (resolved.materialUuid ? [resolved.materialUuid] : [])),
        componentFileId,
      );
      reporter.low('NESTED_MODEL_RENDERER_CREATED', modelAsset.relativePath, gameObject.name, 'Nested model asset resolved to Cocos MeshRenderer', resolved.source);
      return;
    }

    const missing = handleMissingModel(modelAsset, reporter, options, { autoCopy: true, severity: 'low', meshNameHint });
    if (missing.resolved?.meshUuid) {
      builder.addMeshRenderer(
        nodeId,
        componentId,
        missing.resolved.meshUuid,
        overrideMaterialUuids.length ? overrideMaterialUuids : (missing.resolved.materialUuids || (missing.resolved.materialUuid ? [missing.resolved.materialUuid] : [])),
        componentFileId,
      );
      reporter.low(
        missing.pendingImport ? 'NESTED_MODEL_PENDING_MESH_WIRED' : 'NESTED_MODEL_RENDERER_CREATED',
        modelAsset.relativePath,
        gameObject.name,
        missing.pendingImport
          ? 'Nested model asset was wired to a stable pending Cocos mesh sub-asset; Creator import will materialize it'
          : 'Nested model asset resolved to Cocos MeshRenderer',
        missing.resolved.source,
      );
      return;
    }
    if (missing.pendingImport) {
      builder.addMeshRenderer(
        nodeId,
        componentId,
        '',
        overrideMaterialUuids.length ? overrideMaterialUuids : [],
        componentFileId,
      );
      recordPendingMeshRepair(options, options.out, componentFileId, modelAsset.stem, meshNameHint, modelAsset.relativePath);
      reporter.low(
        'NESTED_MODEL_PENDING_IMPORT',
        modelAsset.relativePath,
        gameObject.name,
        'Nested model asset was copied/prepared for import; MeshRenderer kept with empty mesh slot until Cocos generates mesh sub-assets',
        missing.detail || ''
      );
      return;
    }
    reporter.medium('NESTED_MODEL_UNRESOLVED', modelAsset.relativePath, gameObject.name, 'Nested model node was preserved, but no Cocos mesh sub-asset is available yet');
  }

  function emitMeshRenderer(gameObject, nodeId, componentId, doc, model, builder, reporter, options, unityDb, cocosDb) {
    const meshFilterId = gameObject.components.find((id) => model.componentDocs.get(id)?.classId === 33);
    const meshFilter = meshFilterId ? model.componentDocs.get(meshFilterId) : null;
    const meshRef = meshFilter ? getField(meshFilter, 'm_Mesh') : null;
    const materialRefs = getNestedList(doc, 'm_Materials');
    const hasExplicitMaterialSlots = materialRefs.length > 0;

    const meshAsset = unityDb.get(unityRefGuid(meshRef));
    const materialAssets = materialRefs.map((materialRef) => unityDb.get(unityRefGuid(materialRef)) || null);
    let meshUuid = '';
    let materialUuids = [];
    let meshPendingImport = false;
    const componentFileId = `cmp-mesh-renderer-${componentId}`;
    const materialHints = materialAssets.map((materialAsset) => materialAsset?.stem || '');

    const builtinMeshUuid = resolveUnityBuiltinMeshUuid(meshRef, gameObject.name);
    if (builtinMeshUuid) {
      meshUuid = builtinMeshUuid;
      reporter.low(
        'MODEL_PRIMITIVE_FALLBACK_USED',
        `UnityBuiltin/Mesh/${deps.unityRefFileId(meshRef)}`,
        gameObject.name,
        'Unity built-in mesh was mapped to a Cocos built-in primitive mesh',
        builtinMeshUuid,
      );
    }

    if (meshAsset && !meshUuid) {
      const resolved = cocosDb.resolveModelMeshByStem(meshAsset.stem, gameObject.name);
      if (resolved) {
        meshUuid = resolved.meshUuid;
        if (hasExplicitMaterialSlots) {
          const resolvedMaterials = cocosDb.resolveModelMaterialUuidsByStem(meshAsset.stem, materialHints);
          materialUuids = resolvedMaterials?.materialUuids || resolved.materialUuids || (resolved.materialUuid ? [resolved.materialUuid] : []);
        }
        if (resolved.fallbackExt !== meshAsset.ext && ['.fbx', '.gltf', '.glb'].includes(resolved.fallbackExt)) {
          reporter.low('MODEL_FALLBACK_USED', meshAsset.relativePath, resolved.source, `Model was resolved through ${resolved.fallbackExt} fallback`);
        }
      } else {
        if (meshAsset.ext === '.asset') {
          const importedDest = importedUnityAssetPath(meshAsset, options);
          if (importedDest && fs.existsSync(importedDest)) {
            meshUuid = resolveLibraryAssetUuid(importedDest, options, 'cc.Mesh', { forceReload: true });
          }
          if (!meshUuid) {
            const copiedDest = copyUnityAssetToCocos(meshAsset, options, reporter, 'model', 'medium', { deferNeedsImportReport: true, meshNameHint: gameObject.name });
            if (copiedDest) {
              meshUuid = resolveLibraryAssetUuid(copiedDest, options, 'cc.Mesh', { forceReload: true });
              if (meshUuid) {
                reporter.low('MODEL_LIBRARY_ASSET_USED', meshAsset.relativePath, toPosix(path.relative(options.cocosRoot, copiedDest)), 'Model asset was resolved from the current Cocos library import');
              }
            }
          }
          if (!meshUuid) {
            meshUuid = deps.resolveBuiltinPrimitiveMeshUuid(gameObject.name, meshAsset.stem);
            if (meshUuid) {
              reporter.low('MODEL_PRIMITIVE_FALLBACK_USED', meshAsset.relativePath, gameObject.name, 'Unity primitive mesh was mapped to a Cocos built-in primitive mesh');
            }
          }
        }
        if (!meshUuid) {
          const missing = handleMissingModel(meshAsset, reporter, options, { autoCopy: true, meshNameHint: gameObject.name });
          meshPendingImport = Boolean(missing.pendingImport);
          if (missing.resolved?.meshUuid) {
            meshUuid = missing.resolved.meshUuid;
            meshPendingImport = Boolean(missing.pendingImport);
            if (hasExplicitMaterialSlots) {
              materialUuids = missing.resolved.materialUuids || (missing.resolved.materialUuid ? [missing.resolved.materialUuid] : materialUuids);
            }
          }
        }
      }
    }

    if (materialAssets.length) {
      const explicitMaterialUuids = materialAssets.map((materialAsset) => {
        if (!materialAsset) return '';
        return resolveUnityMaterialUuid(materialAsset, options, unityDb, cocosDb, reporter, gameObject.name);
      });
      materialUuids = materialAssets
        .map((materialAsset, index) => explicitMaterialUuids[index] || materialUuids[index] || '')
        .filter(Boolean);
    }

    if (!meshUuid && meshPendingImport && meshAsset) {
      recordPendingMeshRepair(options, options.out, componentFileId, meshAsset.stem, gameObject.name, meshAsset.relativePath);
    }
    if (!meshUuid && !meshPendingImport) reporter.high('MESH_UNRESOLVED', model.file, gameObject.name, 'MeshRenderer has no resolved Cocos mesh');
    builder.addMeshRenderer(nodeId, componentId, meshUuid, materialUuids, componentFileId);
  }

  return {
    emitSyntheticModelRenderer,
    emitMeshRenderer,
  };
};
