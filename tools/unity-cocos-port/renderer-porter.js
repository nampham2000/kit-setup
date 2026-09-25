'use strict';

const { sanitizeFileId } = require('./core-utils');

const MODEL_FILE_EXTENSIONS = new Set(['.fbx', '.gltf', '.glb']);

module.exports = function createRendererPorter(deps) {
  const {
    resolveUnityMaterialUuids,
    resolveUnityMaterialUuid,
    resolveUnityBuiltinMeshUuid,
    handleMissingModel,
    recordPendingMeshRepair,
    getField,
    getNestedList,
    unityRefGuid,
  } = deps;

  function normalizeMaterialName(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\.material$/i, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  function orderedExternalMaterialAssets(gameObject, resolvedModel) {
    const remaps = (gameObject.syntheticModelExternalMaterialRemaps || [])
      .filter(entry => entry?.materialAsset);
    if (!remaps.length) return [];
    const materialNames = resolvedModel?.materialNames || [];
    if (!materialNames.length) return remaps.map(entry => entry.materialAsset);

    const unused = new Set(remaps.map((_, index) => index));
    return materialNames.map(materialName => {
      const normalizedSlot = normalizeMaterialName(materialName);
      let matchIndex = -1;
      for (const index of unused) {
        const normalizedRemap = normalizeMaterialName(remaps[index].name);
        if (normalizedRemap === normalizedSlot
          || normalizedSlot.includes(normalizedRemap)
          || normalizedRemap.includes(normalizedSlot)) {
          matchIndex = index;
          break;
        }
      }
      if (matchIndex < 0 && unused.size === 1) matchIndex = unused.values().next().value;
      if (matchIndex < 0) return null;
      unused.delete(matchIndex);
      return remaps[matchIndex].materialAsset;
    }).filter(Boolean);
  }

  function resolveSyntheticMaterialOverrides(gameObject, resolvedModel, options, unityDb, cocosDb, reporter) {
    const explicitAssets = gameObject.syntheticModelMaterialOverrideGroups?.[0]?.materialAssets || [];
    const externalAssets = explicitAssets.length ? [] : orderedExternalMaterialAssets(gameObject, resolvedModel);
    const assets = explicitAssets.length ? explicitAssets : externalAssets;
    if (!assets.length) return [];
    const uuids = resolveUnityMaterialUuids(assets, options, unityDb, cocosDb, reporter, gameObject.name);
    if (externalAssets.length && uuids.length) {
      reporter.low(
        'MODEL_EXTERNAL_MATERIAL_REMAP_WIRED',
        gameObject.syntheticModelAsset?.relativePath || '',
        gameObject.name,
        `Unity ModelImporter externalObjects remap replaced ${uuids.length} embedded FBX material slot(s)`,
        externalAssets.map(asset => asset.relativePath || asset.path || asset.stem || '').join(', '),
      );
    }
    return uuids;
  }

  function emitSyntheticModelRenderer(gameObject, nodeId, builder, reporter, options, unityDb, cocosDb) {
    const modelAsset = gameObject.syntheticModelAsset;
    const importScale = typeof deps.unityModelImportScale === 'function' ? deps.unityModelImportScale(modelAsset) : 1;
    if (importScale !== 1) {
      reporter.medium(
        'MODEL_IMPORT_SCALE_UNPORTED',
        modelAsset?.relativePath || '',
        gameObject.name,
        `Unity ModelImporter scale factor ${importScale} is baked into Unity's mesh data but not into the Cocos import; verify this model's size`,
      );
    }
    const meshNameHint = gameObject.syntheticModelName || gameObject.name;
    const componentId = `synthetic-model-${modelAsset.guid || modelAsset.uuid || gameObject.fileId}`;
    const componentFileId = `cmp-model-${sanitizeFileId(gameObject.name)}`;
    const requiredExt = modelAsset.ext === '.asset' ? '.fbx' : modelAsset.ext;
    const resolved = cocosDb.resolveModelMeshByStem(modelAsset.stem, gameObject.syntheticModelName || gameObject.name, requiredExt);
    if (resolved?.meshUuid) {
      const overrideMaterialUuids = resolveSyntheticMaterialOverrides(
        gameObject, resolved, options, unityDb, cocosDb, reporter,
      );
      builder.addMeshRenderer(
        nodeId,
        componentId,
        resolved.meshUuid,
        overrideMaterialUuids.length ? overrideMaterialUuids : (resolved.materialUuids || (resolved.materialUuid ? [resolved.materialUuid] : [])),
        componentFileId,
        { castShadows: true, receiveShadows: true },
      );
      reporter.low('NESTED_MODEL_RENDERER_CREATED', modelAsset.relativePath, gameObject.name, 'Nested model asset resolved to Cocos MeshRenderer', resolved.source);
      return;
    }

    const missing = handleMissingModel(modelAsset, reporter, options, { autoCopy: true, severity: 'low', meshNameHint });
    if (missing.resolved?.meshUuid) {
      const overrideMaterialUuids = resolveSyntheticMaterialOverrides(
        gameObject, missing.resolved, options, unityDb, cocosDb, reporter,
      );
      builder.addMeshRenderer(
        nodeId,
        componentId,
        missing.resolved.meshUuid,
        overrideMaterialUuids.length ? overrideMaterialUuids : (missing.resolved.materialUuids || (missing.resolved.materialUuid ? [missing.resolved.materialUuid] : [])),
        componentFileId,
        { castShadows: true, receiveShadows: true },
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
      const overrideMaterialUuids = resolveSyntheticMaterialOverrides(
        gameObject, missing.resolved, options, unityDb, cocosDb, reporter,
      );
      builder.addMeshRenderer(
        nodeId,
        componentId,
        '',
        overrideMaterialUuids.length ? overrideMaterialUuids : [],
        componentFileId,
        { castShadows: true, receiveShadows: true },
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
      const requiredExt = meshAsset.ext === '.asset' ? '.fbx' : meshAsset.ext;
      const resolved = cocosDb.resolveModelMeshByStem(meshAsset.stem, gameObject.name, requiredExt, deps.unityRefFileId(meshRef));
      if (resolved) {
        meshUuid = resolved.meshUuid;
        if (hasExplicitMaterialSlots) {
          const resolvedMaterials = cocosDb.resolveModelMaterialUuidsByStem(meshAsset.stem, materialHints, requiredExt);
          materialUuids = resolvedMaterials?.materialUuids || resolved.materialUuids || (resolved.materialUuid ? [resolved.materialUuid] : []);
        }
        if (resolved.fallbackExt !== meshAsset.ext && ['.fbx', '.gltf', '.glb'].includes(resolved.fallbackExt)) {
          reporter.low('MODEL_FALLBACK_USED', meshAsset.relativePath, resolved.source, `Model was resolved through ${resolved.fallbackExt} fallback`);
        }
      } else {
        // A Unity Mesh .asset is serialized YAML that no Cocos importer reads: handleMissingModel
        // exports it straight to FBX (FBX-only model pipeline) instead of copying the raw file.
        const missing = handleMissingModel(meshAsset, reporter, options, { autoCopy: true, meshNameHint: gameObject.name });
        meshPendingImport = Boolean(missing.pendingImport);
        if (missing.resolved?.meshUuid) {
          meshUuid = missing.resolved.meshUuid;
          if (hasExplicitMaterialSlots) {
            materialUuids = missing.resolved.materialUuids || (missing.resolved.materialUuid ? [missing.resolved.materialUuid] : materialUuids);
          }
        }
        // A name-matched built-in primitive only approximates the mesh; use it when export failed.
        if (!meshUuid && !meshPendingImport && meshAsset.ext === '.asset') {
          meshUuid = deps.resolveBuiltinPrimitiveMeshUuid(gameObject.name, meshAsset.stem);
          if (meshUuid) {
            reporter.low('MODEL_PRIMITIVE_FALLBACK_USED', meshAsset.relativePath, gameObject.name, 'Unity Mesh .asset could not be exported to FBX; a name-matched Cocos built-in primitive mesh was used');
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

    // Unity mirrors FBX/glTF mesh data on import (x -> -x) while Cocos keeps the file basis, so under
    // the regular Unity -> Cocos node conversion (z -> -z) the mesh would appear turned 180 degrees
    // about its local Y. Host the renderer on a basis child; the node keeps its authored transform.
    let rendererNodeId = nodeId;
    const modelFileMesh = Boolean(!builtinMeshUuid && meshAsset
      && MODEL_FILE_EXTENSIONS.has(String(meshAsset.ext || '').toLowerCase())
      && (meshUuid || meshPendingImport));
    if (modelFileMesh && typeof builder.addMeshBasisNode === 'function') {
      // Unity bakes ModelImporter.globalScale into the mesh data; the Cocos import does not.
      const importScale = typeof deps.unityModelImportScale === 'function' ? deps.unityModelImportScale(meshAsset) : 1;
      rendererNodeId = builder.addMeshBasisNode(nodeId, componentFileId, importScale);
      reporter.low(
        'MODEL_MESH_FORWARD_AXIS_CORRECTED',
        meshAsset.relativePath,
        gameObject.name,
        `FBX mesh referenced by a MeshFilter was placed on a Unity-to-Cocos basis child (180 degrees about Y, import scale ${importScale})`,
      );
    }
    builder.addMeshRenderer(rendererNodeId, componentId, meshUuid, materialUuids, componentFileId, {
      castShadows: Number(getField(doc, 'm_CastShadows', 1) || 0) !== 0,
      receiveShadows: Number(getField(doc, 'm_ReceiveShadows', 1) || 0) !== 0,
    });
  }

  return {
    emitSyntheticModelRenderer,
    emitMeshRenderer,
  };
};
