'use strict';

const {
  applyParticleRendererMesh,
  applyParticleRendererMaterial,
  applyUnityParticleSystemToCocos,
  parseUnityRendererDoc,
  parseUnityParticleDoc,
} = require('./particle-system-converter');

const UNITY_BUILTIN_RESOURCE_GUID = '0000000000000000f000000000000000';
const UNITY_DEFAULT_PARTICLE_SYSTEM_MATERIAL_FILE_ID = '10308';
const COCOS_PARTICLE_ADD_MATERIAL_UUID = 'ea7478b0-408d-4052-b703-f0d2355e095f';

module.exports = function createParticlePorter(deps = {}) {
  const {
    handleMissingModel,
    recordPendingMeshRepair,
    resolveUnityBuiltinMeshUuid,
    resolveUnityParticleMaterial,
    unityRefGuid,
    unityRefFileId,
  } = deps;

  function rendererMaterialRefs(rendererDoc) {
    const rendererData = parseUnityRendererDoc(rendererDoc);
    const materials = Array.isArray(rendererData.m_Materials) ? rendererData.m_Materials : [];
    return materials.filter((item) => item && typeof item === 'object' && String(item.guid || '').trim());
  }

  function isUnityDefaultParticleSystemMaterial(materialRef) {
    if (!materialRef || typeof materialRef !== 'object') return false;
    return String(materialRef.guid || '').trim().toLowerCase() === UNITY_BUILTIN_RESOURCE_GUID
      && String(materialRef.fileID || materialRef.fileId || '').trim() === UNITY_DEFAULT_PARTICLE_SYSTEM_MATERIAL_FILE_ID;
  }

  function firstRendererMeshRef(rendererDoc) {
    const rendererData = parseUnityRendererDoc(rendererDoc);
    if (Number(rendererData?.m_RenderMode) !== 4) return null;
    for (const key of ['m_Mesh', 'm_Mesh1', 'm_Mesh2', 'm_Mesh3']) {
      const ref = rendererData?.[key];
      if (!ref || typeof ref !== 'object') continue;
      if (String(ref.fileID || '') === '0') continue;
      if (String(ref.guid || '').trim() || String(ref.fileID || '').trim()) return ref;
    }
    return null;
  }

  function resolveParticleRendererMesh(meshRef, gameObject, componentId, reporter, options, unityDb, cocosDb) {
    if (!meshRef) return { meshUuid: '', pendingImport: false, meshAsset: null };

    const builtinMeshUuid = resolveUnityBuiltinMeshUuid
      ? resolveUnityBuiltinMeshUuid(meshRef, gameObject?.name || '')
      : '';
    if (builtinMeshUuid) {
      reporter.low(
        'PARTICLE_MESH_PRIMITIVE_FALLBACK_USED',
        `UnityBuiltin/Mesh/${unityRefFileId ? unityRefFileId(meshRef) : String(meshRef.fileID || '')}`,
        gameObject?.name || '',
        'Unity particle renderer built-in mesh was mapped to a Cocos built-in primitive mesh',
        builtinMeshUuid,
      );
      return { meshUuid: builtinMeshUuid, pendingImport: false, meshAsset: null };
    }

    const meshAsset = unityRefGuid && unityDb?.get ? unityDb.get(unityRefGuid(meshRef)) : null;
    if (!meshAsset) return { meshUuid: '', pendingImport: false, meshAsset: null };

    const meshNameHint = meshAsset.stem || gameObject?.name || '';
    const resolved = cocosDb?.resolveModelMeshByStem
      ? cocosDb.resolveModelMeshByStem(meshAsset.stem, meshNameHint, meshAsset.ext === '.asset' ? '.fbx' : meshAsset.ext)
      : null;
    if (resolved?.meshUuid) {
      return { meshUuid: resolved.meshUuid, pendingImport: false, meshAsset, source: resolved.source };
    }

    const missing = handleMissingModel
      ? handleMissingModel(meshAsset, reporter, options, { autoCopy: true, severity: 'low', meshNameHint })
      : null;
    if (missing?.resolved?.meshUuid) {
      return { meshUuid: missing.resolved.meshUuid, pendingImport: Boolean(missing.pendingImport), meshAsset, source: missing.resolved.source };
    }

    if (missing?.pendingImport && recordPendingMeshRepair) {
      recordPendingMeshRepair(
        options,
        options.out,
        `cmp-particle-system-${componentId}`,
        meshAsset.stem,
        meshNameHint,
        meshAsset.relativePath,
      );
    }

    return { meshUuid: '', pendingImport: Boolean(missing?.pendingImport), meshAsset };
  }

  function emitParticleSystem(nodeId, componentId, doc, gameObject, builder, reporter, options, unityDb, cocosDb, rendererDoc = null) {
    const particleId = builder.addParticleSystemFromTemplate(nodeId, componentId, doc, `cmp-particle-system-${componentId}`);
    if (particleId) {
      const result = applyUnityParticleSystemToCocos(builder, particleId, doc, rendererDoc);
      const alignmentData = parseUnityRendererDoc(rendererDoc);
      const alignment = Number(alignmentData.m_RenderAlignment || 0);
      if ((alignment === 2 && Number(alignmentData.m_RenderMode || 0) !== 4) || (alignment !== 0 && alignment !== 2)) {
        reporter.high('PARTICLE_RENDER_ALIGNMENT_ADAPTER_REQUIRED', options.src || '', gameObject?.name || '',
          `Unity render alignment ${alignment} requires a source-frame shader adapter; Cocos built-in billboards use camera axes. Validate the generated effect in Preview.`);
      }
      const meshRef = firstRendererMeshRef(rendererDoc);
      const mesh = resolveParticleRendererMesh(meshRef, gameObject, componentId, reporter, options, unityDb, cocosDb);
      if (mesh.meshUuid && applyParticleRendererMesh(builder, particleId, mesh.meshUuid)) {
        reporter.low(
          'PARTICLE_MESH_RESOLVED',
          mesh.source || mesh.meshAsset?.relativePath || '',
          gameObject?.name || '',
          'Unity ParticleSystemRenderer mesh was wired to the Cocos ParticleSystemRenderer mesh slot',
          mesh.meshUuid,
        );
      } else if (meshRef && !mesh.pendingImport) {
        reporter.medium(
          'PARTICLE_MESH_UNRESOLVED',
          mesh.meshAsset?.relativePath || '',
          gameObject?.name || '',
          'Unity ParticleSystemRenderer uses Mesh render mode but no Cocos mesh sub-asset could be resolved',
        );
      }

      const materialRefs = rendererMaterialRefs(rendererDoc);
      const materialRef = materialRefs[0] || null;
      const usedBuiltInDefaultParticleMaterial = isUnityDefaultParticleSystemMaterial(materialRef);
      if (usedBuiltInDefaultParticleMaterial) {
        applyParticleRendererMaterial(builder, particleId, COCOS_PARTICLE_ADD_MATERIAL_UUID);
        reporter.low(
          'PARTICLE_DEFAULT_MATERIAL_MAPPED',
          'UnityBuiltin/Default-ParticleSystem',
          gameObject?.name || '',
          'Unity built-in Default-ParticleSystem material was mapped to Cocos particle-add.mtl',
          COCOS_PARTICLE_ADD_MATERIAL_UUID,
        );
      }
      const materialAsset = !usedBuiltInDefaultParticleMaterial && materialRef?.guid && unityDb?.get
        ? unityDb.get(String(materialRef.guid))
        : null;
      const uv = parseUnityParticleDoc(doc).UVModule;
      let spriteTextureAsset = null;
      if (Number(uv?.enabled) !== 0 && Number(uv?.mode) === 1) {
        const sprites = (uv.sprites || []).map(entry => entry.sprite);
        const ref = sprites[0];
        const asset = sprites.length === 1 && String(ref?.fileID) === '21300000'
          ? unityDb?.get(String(ref.guid)) : null;
        if (asset && /\.(png|jpe?g|tga)$/i.test(asset.path) && materialAsset) {
          spriteTextureAsset = asset;
        } else {
          reporter.high('PARTICLE_SPRITE_SHEET_UNRESOLVED', options.src || '', gameObject?.name || '',
            'Sprite-mode UV animation requires one whole-image sprite and a converted material. Multiple/sliced sprites need atlas baking; grid tiles were not substituted.');
        }
      }
      const particleMaterial = resolveUnityParticleMaterial && materialAsset
        ? resolveUnityParticleMaterial(materialAsset, options, unityDb, reporter, gameObject?.name || '', spriteTextureAsset)
        : null;
      if (particleMaterial?.materialUuid) {
        applyParticleRendererMaterial(builder, particleId, particleMaterial.materialUuid, particleMaterial.textureUuid);
        reporter.low(
          'PARTICLE_MATERIAL_CONVERTED',
          materialAsset.relativePath,
          gameObject?.name || '',
          'Unity particle material was converted and wired to the Cocos ParticleSystemRenderer CPU material slot',
          particleMaterial.file || particleMaterial.materialUuid,
        );
      }
      const particleData = parseUnityParticleDoc(doc);
      const trailMaterialRef = Number(particleData.TrailModule?.enabled) !== 0 ? materialRefs[1] : null;
      const trailMaterialAsset = trailMaterialRef?.guid && unityDb?.get
        ? unityDb.get(String(trailMaterialRef.guid))
        : null;
      const trailMaterial = resolveUnityParticleMaterial && trailMaterialAsset
        ? resolveUnityParticleMaterial(trailMaterialAsset, options, unityDb, reporter, gameObject?.name || '', null, 'trail')
        : null;
      if (trailMaterial?.materialUuid && applyParticleRendererMaterial(
        builder,
        particleId,
        trailMaterial.materialUuid,
        '',
        1,
      )) {
        reporter.low(
          'PARTICLE_TRAIL_MATERIAL_CONVERTED',
          trailMaterialAsset.relativePath,
          gameObject?.name || '',
          'Unity ParticleSystemRenderer trail material was converted and wired to Cocos material slot 1',
          trailMaterial.file || trailMaterial.materialUuid,
        );
      } else if (trailMaterialRef) {
        reporter.high(
          'PARTICLE_TRAIL_MATERIAL_UNRESOLVED',
          trailMaterialAsset?.relativePath || '',
          gameObject?.name || '',
          'Unity particle trails require renderer material slot 1, but the trail material could not be converted',
        );
      }
      reporter.low(
        'PARTICLE_CONVERTED',
        '',
        '',
        `Unity ParticleSystem was converted using a Cocos particle template with ${result.applied} mapped property groups`
      );
    } else {
      reporter.medium('PARTICLE_TEMPLATE_MISSING', '', '', 'No Cocos particle template prefab or library particle preset was found; Unity ParticleSystem skipped');
    }
    return particleId || 0;
  }

  return { emitParticleSystem };
};
