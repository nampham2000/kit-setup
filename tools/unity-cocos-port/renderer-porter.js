'use strict';

const fs = require('fs');
const path = require('path');
const { toPosix, sanitizeFileId } = require('./core-utils');
const { unityModelImportBasis, unityModelMeshName } = require('./model-import-basis');
const { cocosSlotsForUnitySlots } = require('./fbx-submesh-order');
const { requestModelMeshBasis } = require('./model-mesh-basis-binding');
const { rebaseSkinnedSkeleton } = require('./fbx-skeleton-basis');
const { reportModelMeshResolution } = require('./model-mesh-resolution');

// Unity Renderer.m_Enabled (MeshRenderer, SkinnedMeshRenderer): a disabled renderer draws nothing
// (collider-only pieces keep their MeshFilter), so the Cocos component starts disabled too.
function unityRendererEnabled(getField, doc) {
  return Number(getField(doc, 'm_Enabled', 1) ?? 1) !== 0;
}

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
    fbxMeshOwnerNode = ({ nodeId }) => nodeId,
  } = deps;

  // A Cocos FBX mesh drawn under a converted Unity transform needs the basis diag(-k, k, -k). MeshRenderers get it
  // from the UnityModelMeshBasis runtime (ModelImporter.globalScale k). The one case it does not cover is a pivot
  // the Cocos importer baked into the vertices (Tanks! LevelMoon: 4 of 108 meshes): with Unity mesh-bounds evidence
  // and k = 1, fbxMeshOwnerNode mounts the renderer on a Ry(180) * T(-pivot) carrier instead, which also owns a
  // MeshCollider of that mesh. Importer settings without a measured basis are reported high by requestModelMeshBasis.
  function fbxBasisRoute(modelAsset) {
    const basis = unityModelImportBasis(modelAsset);
    if (!basis) return { pivotCarrier: false, request: false };
    return { pivotCarrier: !basis.supported || basis.scale === 1, request: true };
  }

  function meshRendererOwner(args) {
    const route = fbxBasisRoute(args.modelAsset);
    const ownerNodeId = route.pivotCarrier ? fbxMeshOwnerNode({ ...args, requirePivot: true }) : args.nodeId;
    const carrier = ownerNodeId !== args.nodeId;
    const basis = unityModelImportBasis(args.modelAsset);
    return { ownerNodeId, requestBasis: route.request && (!carrier || !basis?.supported) };
  }

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

  // Unity-MCP evidence (--unity-object-map): the materials Unity actually resolved for the model's single
  // renderer (ModelImporter name search, remaps or embedded fallback).
  function evidenceMaterialAssets(gameObject, options, unityDb) {
    const model = options?.unityObjectMap?.[gameObject.syntheticModelAsset?.guid || ''];
    if (!model) return [];
    const renderers = Object.values(model.objects || {})
      .filter((object) => /Renderer$/.test(String(object?.type || '')) && Array.isArray(object.materials));
    if (renderers.length !== 1) return [];
    return renderers[0].materials.map((material) => (material?.guid ? unityDb?.get(material.guid) || null : null));
  }

  // Unity material slot i draws Unity sub-mesh i; the Cocos primitive order of the
  // same FBX mesh differs (fbx-submesh-order.js). Returns the slots in Cocos order.
  function cocosMaterialSlots(modelAsset, modelName, unitySlots, reporter, label) {
    if (!modelAsset || String(modelAsset.ext || '').toLowerCase() !== '.fbx' || unitySlots.length < 1) return unitySlots;
    const slots = cocosSlotsForUnitySlots(modelAsset.path, modelName, unitySlots);
    if (!slots) return unitySlots;
    reporter.low('FBX_SUBMESH_MATERIALS_REORDERED', modelAsset.relativePath || '', label,
      `Unity sub-mesh material slots (${unitySlots.length}) were mapped onto ${slots.length} Cocos primitive(s) by FBX material object`);
    return slots;
  }

  function resolveSyntheticMaterialOverrides(gameObject, resolvedModel, options, unityDb, cocosDb, reporter) {
    const explicitAssets = gameObject.syntheticModelMaterialOverrideGroups?.[0]?.materialAssets || [];
    const evidenceAssets = explicitAssets.length ? [] : evidenceMaterialAssets(gameObject, options, unityDb);
    const externalAssets = explicitAssets.length || evidenceAssets.some(Boolean)
      ? []
      : orderedExternalMaterialAssets(gameObject, resolvedModel);
    const assets = explicitAssets.length ? explicitAssets : evidenceAssets.some(Boolean) ? evidenceAssets.filter(Boolean) : externalAssets;
    if (!assets.length) return [];
    let uuids = resolveUnityMaterialUuids(assets, options, unityDb, cocosDb, reporter, gameObject.name);
    if (explicitAssets.length) {
      uuids = cocosMaterialSlots(gameObject.syntheticModelAsset, gameObject.syntheticModelName || gameObject.name, uuids, reporter, gameObject.name);
    }
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
    const meshNameHint = gameObject.syntheticModelName || gameObject.name;
    const componentId = `synthetic-model-${modelAsset.guid || modelAsset.uuid || gameObject.fileId}`;
    const componentFileId = `cmp-model-${sanitizeFileId(gameObject.name)}`;
    const requiredExt = modelAsset.ext === '.asset' ? '.fbx' : modelAsset.ext;
    const resolved = cocosDb.resolveModelMeshByStem(modelAsset.stem, gameObject.syntheticModelName || gameObject.name, requiredExt);
    reportModelMeshResolution(reporter, resolved, modelAsset.relativePath, gameObject.name);
    if (resolved?.meshUuid) {
      const overrideMaterialUuids = resolveSyntheticMaterialOverrides(
        gameObject, resolved, options, unityDb, cocosDb, reporter,
      );
      const syntheticOwner = meshRendererOwner({ builder, nodeId, gameObject, modelAsset, meshUuid: resolved.meshUuid, meshNameHint, seed: componentId, reporter, options });
      const rendererId = builder.addMeshRenderer(
        syntheticOwner.ownerNodeId,
        componentId,
        resolved.meshUuid,
        overrideMaterialUuids.length ? overrideMaterialUuids : (resolved.materialUuids || (resolved.materialUuid ? [resolved.materialUuid] : [])),
        componentFileId,
        { castShadows: true, receiveShadows: true },
      );
      if (syntheticOwner.requestBasis) requestModelMeshBasis(builder, reporter, options, nodeId, rendererId, modelAsset, gameObject.name);
      reporter.low('NESTED_MODEL_RENDERER_CREATED', modelAsset.relativePath, gameObject.name, 'Nested model asset resolved to Cocos MeshRenderer', resolved.source);
      return;
    }

    const missing = handleMissingModel(modelAsset, reporter, options, { autoCopy: true, severity: 'low', meshNameHint });
    if (missing.resolved?.meshUuid) {
      const overrideMaterialUuids = resolveSyntheticMaterialOverrides(
        gameObject, missing.resolved, options, unityDb, cocosDb, reporter,
      );
      const syntheticOwner = meshRendererOwner({ builder, nodeId, gameObject, modelAsset, meshUuid: missing.resolved.meshUuid, meshNameHint, seed: componentId, reporter, options });
      const rendererId = builder.addMeshRenderer(
        syntheticOwner.ownerNodeId,
        componentId,
        missing.resolved.meshUuid,
        overrideMaterialUuids.length ? overrideMaterialUuids : (missing.resolved.materialUuids || (missing.resolved.materialUuid ? [missing.resolved.materialUuid] : [])),
        componentFileId,
        { castShadows: true, receiveShadows: true },
      );
      if (syntheticOwner.requestBasis) requestModelMeshBasis(builder, reporter, options, nodeId, rendererId, modelAsset, gameObject.name);
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

  /** A TextMeshPro (3D) component on the same GameObject: it builds the MeshRenderer's mesh at runtime. */
  function hasTextMeshProText(gameObject, model) {
    return gameObject.components.some((id) => {
      const component = model.componentDocs.get(id);
      return component?.classId === 114
        && getField(component, 'm_fontAsset', null) !== null
        && getField(component, 'm_text', null) !== null;
    });
  }

  function emitMeshRenderer(gameObject, nodeId, componentId, doc, model, builder, reporter, options, unityDb, cocosDb) {
    // TextMeshPro fills this renderer with a glyph mesh at runtime and draws it with its SDF font
    // material. The text itself is ported as a cc.Label by the script porter; emitting the renderer
    // would only add an empty mesh plus a transpiled TMP_SDF effect that Cocos cannot compile.
    if (hasTextMeshProText(gameObject, model)) {
      reporter.low(
        'TMP_MESH_RENDERER_SKIPPED',
        model.file,
        gameObject.name,
        'TextMeshPro builds this MeshRenderer at runtime; the text is ported as a cc.Label, so the renderer and its TMP SDF material are not emitted',
      );
      return;
    }
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
    let meshReported = false;
    let resolvedPrimitiveCount = null;
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

    // A multi-mesh FBX is addressed by mesh file ID; the GameObject name ("Lid")
    // need not match the mesh name ("Object001") and would fall back to mesh 0.
    const unityMeshName = meshAsset && !builtinMeshUuid ? unityModelMeshName(meshAsset, deps.unityRefFileId(meshRef)) : '';
    if (meshAsset && !meshUuid) {
      const requiredExt = meshAsset.ext === '.asset' ? '.fbx' : meshAsset.ext;
      const resolved = cocosDb.resolveModelMeshByStem(meshAsset.stem, unityMeshName || gameObject.name, requiredExt, deps.unityRefFileId(meshRef));
      meshReported = reportModelMeshResolution(reporter, resolved, model.file, gameObject.name) && !resolved.meshUuid;
      if (resolved) {
        resolvedPrimitiveCount = resolved.primitiveCount ?? null;
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
        const missing = handleMissingModel(meshAsset, reporter, options, { autoCopy: true, meshNameHint: unityMeshName || gameObject.name });
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

    if (meshAsset && !builtinMeshUuid && materialUuids.length && !materialUuids.includes('')) {
      materialUuids = cocosMaterialSlots(meshAsset, unityMeshName || gameObject.name, materialUuids, reporter, gameObject.name);
    }

    if (!meshUuid && meshPendingImport && meshAsset) {
      recordPendingMeshRepair(options, options.out, componentFileId, meshAsset.stem, gameObject.name, meshAsset.relativePath);
    }
    if (!meshUuid && !meshPendingImport && !meshReported) reporter.high('MESH_UNRESOLVED', model.file, gameObject.name, 'MeshRenderer has no resolved Cocos mesh');
    // Geometry cross-check: Unity draws a submesh only when a material slot covers it, while a Cocos
    // primitive without a material renders with the magenta missing-material. A mismatch means either the
    // wrong mesh sub-asset was bound or the renderer needs an explicit decision.
    if (meshUuid && hasExplicitMaterialSlots && Number.isInteger(resolvedPrimitiveCount) && resolvedPrimitiveCount > materialRefs.length) {
      reporter.high('MESH_PRIMITIVES_EXCEED_MATERIAL_SLOTS', model.file, gameObject.name,
        `Bound Cocos mesh has ${resolvedPrimitiveCount} primitives but the Unity renderer has ${materialRefs.length} material slot(s); the extra primitives render magenta in Cocos`,
        meshUuid);
    }
    const fbxOwner = meshUuid && !builtinMeshUuid && meshAsset
      ? meshRendererOwner({
        builder,
        nodeId,
        gameObject,
        modelAsset: meshAsset,
        meshUuid,
        unityMeshFileId: deps.unityRefFileId(meshRef),
        meshNameHint: gameObject.name,
        seed: componentId,
        reporter,
        options,
      })
      : null;
    const ownerNodeId = fbxOwner
      ? fbxOwner.ownerNodeId
      : builtinMeshUuid && deps.builtinPrimitiveOwnerNode
        ? deps.builtinPrimitiveOwnerNode({ builder, nodeId, meshRef, meshUuid, gameObject, seed: componentId, reporter })
        : nodeId;
    const rendererId = builder.addMeshRenderer(ownerNodeId, componentId, meshUuid, materialUuids, componentFileId, {
      castShadows: Number(getField(doc, 'm_CastShadows', 1) || 0) !== 0,
      receiveShadows: Number(getField(doc, 'm_ReceiveShadows', 1) || 0) !== 0,
      enabled: unityRendererEnabled(getField, doc),
    });
    if (meshAsset && !builtinMeshUuid && (meshUuid || meshPendingImport) && (fbxOwner ? fbxOwner.requestBasis : fbxBasisRoute(meshAsset).request)) {
      requestModelMeshBasis(builder, reporter, options, nodeId, rendererId, meshAsset, gameObject.name);
    }
  }

  // Node reached from `rootId` by a Cocos skeleton joint path ("Alpha:Hips/Alpha:Spine").
  function nodeAtPath(builder, rootId, jointPath) {
    let current = rootId;
    for (const name of String(jointPath || '').split('/').filter(Boolean)) {
      const next = (builder.objects[current]?._children || []).map((ref) => ref?.__id__)
        .find((id) => builder.objects[id]?._name === name);
      if (!Number.isInteger(next)) return null;
      current = next;
    }
    return current;
  }

  function parentNodeId(builder, nodeId) {
    const id = builder.objects[nodeId]?._parent?.__id__;
    return Number.isInteger(id) ? id : null;
  }

  // Unity SkinnedMeshRenderer on an unpacked model instance. The Cocos model prefab
  // pairs the imported mesh with a skeleton whose joint paths are relative to the
  // model root; that root is the ancestor from which every joint path resolves.
  // The bind poses stay in FBX space while the scene conversion puts every bone in
  // R*W*R^-1 (R = Ry(180)), which splits the mesh at each joint; attachRealtimeSkinning
  // rebases the skeleton into FBX space (fbx-skeleton-basis.js).
  function emitSkinnedMeshRenderer(gameObject, nodeId, componentId, doc, model, builder, reporter, options, unityDb, cocosDb) {
    const meshRef = getField(doc, 'm_Mesh');
    const meshAsset = unityDb.get(unityRefGuid(meshRef));
    const componentFileId = `cmp-skinned-mesh-renderer-${componentId}`;
    if (!meshAsset || !['.fbx', '.gltf', '.glb'].includes(meshAsset.ext)) {
      reporter.high('SKINNED_MESH_UNRESOLVED', model.file, gameObject.name, 'SkinnedMeshRenderer mesh is not an imported model sub-asset');
      return;
    }
    const meshName = unityModelMeshName(meshAsset, deps.unityRefFileId(meshRef)) || gameObject.name;
    let resolved = cocosDb.resolveModelMeshByStem(meshAsset.stem, meshName, meshAsset.ext, deps.unityRefFileId(meshRef));
    if (reportModelMeshResolution(reporter, resolved, model.file, gameObject.name) && !resolved.meshUuid) return;
    if (!resolved) {
      const missing = handleMissingModel(meshAsset, reporter, options, { autoCopy: true, meshNameHint: meshName });
      resolved = missing.resolved || null;
      if (!resolved?.meshUuid) {
        reporter.medium('SKINNED_MESH_PENDING_IMPORT', meshAsset.relativePath, gameObject.name,
          'Model copied for AssetDB import; refresh and rerun the porter to bind the skinned mesh.');
        return;
      }
    }
    const skin = cocosDb.resolveModelSkinByMesh(meshAsset.stem, resolved.meshUuid, resolved.fallbackExt || meshAsset.ext);
    if (!skin?.skeletonUuid || !skin.joints.length) {
      reporter.high('SKINNED_MESH_SKELETON_UNRESOLVED', meshAsset.relativePath, gameObject.name,
        'The imported Cocos model has no skeleton for this mesh; refresh AssetDB and rerun the porter.');
      return;
    }
    let skinningRoot = parentNodeId(builder, nodeId);
    while (Number.isInteger(skinningRoot) && !skin.joints.every((joint) => Number.isInteger(nodeAtPath(builder, skinningRoot, joint)))) {
      skinningRoot = parentNodeId(builder, skinningRoot);
    }
    if (!Number.isInteger(skinningRoot)) {
      reporter.high('SKINNED_MESH_ROOT_UNRESOLVED', model.file, gameObject.name,
        `No ancestor resolves every skeleton joint path (first: ${skin.joints[0]}); the ported bone hierarchy differs from the model.`);
      return;
    }
    // Slot i stays slot i: an unresolved Unity slot falls back to the model's own
    // material at that index (as for MeshRenderer), then FBX sub-mesh order is remapped.
    const modelMaterials = resolved.materialUuids || [];
    const materialRefs = getNestedList(doc, 'm_Materials');
    let materialUuids = materialRefs.length ? materialRefs.map((materialRef, index) => {
      const materialAsset = unityDb.get(unityRefGuid(materialRef));
      return (materialAsset ? resolveUnityMaterialUuid(materialAsset, options, unityDb, cocosDb, reporter, gameObject.name) : '') || modelMaterials[index] || '';
    }) : modelMaterials.slice();
    if (materialUuids.length && !materialUuids.includes('')) {
      materialUuids = cocosMaterialSlots(meshAsset, meshName, materialUuids, reporter, gameObject.name);
    } else if (materialUuids.includes('')) {
      reporter.medium('SKINNED_MESH_MATERIAL_SLOT_EMPTY', meshAsset.relativePath, gameObject.name,
        'A SkinnedMeshRenderer material slot resolved to no Unity or model material; the slot renders with the default material.');
    }
    // Nodes of the model's own hierarchy (every joint path prefix and the renderer's chain up to the
    // root) switch to the FBX frame in attachRealtimeSkinning; other children are attachments.
    if (!builder.fbxSkeletonNodes) builder.fbxSkeletonNodes = new Map();
    const fbxNodes = builder.fbxSkeletonNodes.get(skinningRoot) || new Set();
    for (const joint of skin.joints) {
      const segments = String(joint).split('/').filter(Boolean);
      for (let i = 1; i <= segments.length; i++) {
        const id = nodeAtPath(builder, skinningRoot, segments.slice(0, i).join('/'));
        if (Number.isInteger(id)) fbxNodes.add(id);
      }
    }
    for (let id = nodeId; Number.isInteger(id) && id !== skinningRoot; id = parentNodeId(builder, id)) fbxNodes.add(id);
    builder.fbxSkeletonNodes.set(skinningRoot, fbxNodes);
    builder.addSkinnedMeshRenderer(nodeId, componentId, resolved.meshUuid, materialUuids, skin.skeletonUuid, skinningRoot, componentFileId, {
      castShadows: Number(getField(doc, 'm_CastShadows', 1) || 0) !== 0,
      receiveShadows: Number(getField(doc, 'm_ReceiveShadows', 1) || 0) !== 0,
      enabled: unityRendererEnabled(getField, doc),
    });
    // Bone basis and bind pose are carried over structurally; skinning parity needs a visual check.
    reporter.medium('SKINNED_MESH_BOUND', meshAsset.relativePath, gameObject.name,
      `SkinnedMeshRenderer bound to the imported skeleton (${skin.joints.length} joints) under ${builder.objects[skinningRoot]?._name || 'root'}; verify the deformation visually.`);
  }

  // Cocos SkinnedMeshRenderer defaults to BakedSkinningModel, which samples joint
  // textures baked by a SkeletalAnimation and ignores bone transforms driven by an
  // AnimationController or Animation. Every skinning root therefore gets a
  // SkeletalAnimation with useBakedAnimation=false (the ported Animation component is
  // converted in place; SkeletalAnimation extends it), after all components exist.
  function attachRealtimeSkinning(builder, reporter) {
    const roots = new Map();
    for (const object of builder.objects) {
      if (object?.__type__ !== 'cc.SkinnedMeshRenderer') continue;
      const rootId = object._skinningRoot?.__id__;
      if (Number.isInteger(rootId)) roots.set(rootId, (roots.get(rootId) || 0) + 1);
    }
    for (const [rootId, renderers] of roots) {
      const root = builder.objects[rootId];
      const animation = (root._components || []).map((ref) => builder.objects[ref.__id__])
        .find((component) => component?.__type__ === 'cc.Animation' || component?.__type__ === 'cc.SkeletalAnimation');
      if (animation) {
        animation.__type__ = 'cc.SkeletalAnimation';
        animation._useBakedAnimation = false;
        if (!Array.isArray(animation._sockets)) animation._sockets = [];
      } else {
        builder.addComponent(rootId, 'cc.SkeletalAnimation', { playOnLoad: false, _clips: [], _defaultClip: null, _useBakedAnimation: false, _sockets: [] },
          null, `cmp-skeletal-animation-${rootId}`);
      }
      reporter.low('SKINNED_MESH_REALTIME_SKINNING', '', root._name || '', `${renderers} skinned renderer(s) use real-time skinning under ${root._name || 'root'}.`);
      const fbxNodes = builder.fbxSkeletonNodes?.get(rootId);
      if (fbxNodes?.size && !builder.fbxSkeletonRebased?.has(rootId)) {
        const rebased = rebaseSkinnedSkeleton(builder.objects, rootId, fbxNodes);
        if (!builder.fbxSkeletonRebased) builder.fbxSkeletonRebased = new Set();
        builder.fbxSkeletonRebased.add(rootId);
        reporter.medium('SKINNED_SKELETON_FBX_FRAME', '', root._name || '',
          `Skeleton under ${root._name || 'root'} rebased to the FBX frame (${rebased.joints} model nodes, ${rebased.attachments} attachments, root * Ry(180)). `
          + 'Unity-authored bone curves (.anim, humanoid bakes) on this rig must use the FBX-frame conversion (fbx-skeleton-basis fbxBoneLocal).');
      }
    }
  }

  return {
    emitSyntheticModelRenderer,
    emitMeshRenderer,
    emitSkinnedMeshRenderer,
    attachRealtimeSkinning,
  };
};
