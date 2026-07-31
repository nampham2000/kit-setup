'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT_DIR, COCOS_MATERIAL_IMPORTER_VERSION } = require('./constants');
const {
  toPosix,
  stableUuid,
  compressUuid,
  ensureDir,
  readJsonIfExists,
  vec3,
  color,
  cocosRef,
  cocosUuid,
} = require('./core-utils');
const { parseUnityParticleDoc } = require('./particle-system-converter');

const RUNTIME_DIR = path.join(__dirname, 'runtime');
const SCRIPT_TARGET_DIR = path.join('assets', 'scripts');

const SUB_EMITTER_TYPE = {
  birth: 0,
  death: 2,
};

const RUNTIME_SCRIPTS = {
  particleSubEmitterFollower: {
    className: 'UnityParticleSubEmitterFollower',
    entryClassName: 'UnityParticleSubEmitterEntry',
    missingCode: 'PARTICLE_SUB_EMITTER_FOLLOWER_TEMPLATE_MISSING',
    missingMessage: 'Unity particle sub-emitter runtime script template is missing; generated prefabs cannot attach the helper component',
  },
  particleHierarchyTransformSync: {
    className: 'UnityParticleHierarchyTransformSync',
    entryClassName: 'UnityParticleHierarchyTransformSyncEntry',
    missingCode: 'PARTICLE_HIERARCHY_TRANSFORM_SYNC_TEMPLATE_MISSING',
    missingMessage: 'Unity particle hierarchy transform sync runtime script template is missing; generated prefabs cannot attach the helper component',
  },
  particleRateOverDistanceEmitter: {
    className: 'UnityParticleRateOverDistanceEmitter',
    missingCode: 'PARTICLE_RATE_OVER_DISTANCE_EMITTER_TEMPLATE_MISSING',
    missingMessage: 'Unity particle Rate over Distance needs a runtime script adapter, but the template is missing',
  },
  spriteRendererColorAdapter: {
    className: 'UnitySpriteRendererColorAdapter',
    missingCode: 'SPRITE_RENDERER_COLOR_ADAPTER_TEMPLATE_MISSING',
    missingMessage: 'Unity SpriteRenderer color animation needs a runtime script adapter, but the template is missing',
  },
};

const SPRITE_RENDERER_COLOR_EFFECT = path.join('assets', 'effects', 'UnitySpriteRendererColor.effect');
const SPRITE_RENDERER_COLOR_EFFECT_TEMPLATE = path.join(RUNTIME_DIR, 'UnitySpriteRendererColor.effect');
const SPRITE_RENDERER_COLOR_MATERIAL = path.join('assets', 'materials', 'UnitySpriteRendererColor.mtl');
const SPRITE_RENDERER_COLOR_OPAQUE_MATERIAL = path.join('assets', 'materials', 'UnitySpriteRendererColorOpaque.mtl');
const SPRITE_RENDERER_COLOR_GLOW_MATERIAL = path.join('assets', 'materials', 'UnitySpriteRendererGlow.mtl');

function scriptTargetPath(script) {
  return path.join(SCRIPT_TARGET_DIR, `${script.className}.ts`);
}

function scriptTemplatePath(script) {
  return path.join(RUNTIME_DIR, `${script.className}.ts`);
}

function scriptRuntimeSeed(script) {
  return `unity-cocos-port-runtime-script:${script.className}`;
}

function readRuntimeScriptClassId(script, cocosDb) {
  const scriptRecord = cocosDb?.findScriptClass?.(script.className);
  if (scriptRecord?.classId) return scriptRecord.classId;

  const root = cocosDb?.root || ROOT_DIR;
  const scriptMeta = readJsonIfExists(path.join(root, `${scriptTargetPath(script)}.meta`));
  return scriptMeta?.uuid ? compressUuid(scriptMeta.uuid) : '';
}

function writeStableRuntimeScript(script, options, reporter, ensureDirectoryMetas) {
  if (options.dryRun) return;

  const templateFile = scriptTemplatePath(script);
  if (!fs.existsSync(templateFile)) {
    reporter?.medium(script.missingCode, templateFile, '', script.missingMessage);
    return;
  }

  const targetFile = path.join(options.cocosRoot, scriptTargetPath(script));
  const targetDir = path.dirname(targetFile);
  ensureDir(targetDir);
  ensureDirectoryMetas(targetDir, path.join(options.cocosRoot, 'assets'));

  const sourceText = fs.readFileSync(templateFile, 'utf8');
  const targetText = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : '';
  if (sourceText !== targetText) fs.writeFileSync(targetFile, sourceText, 'utf8');

  const metaFile = `${targetFile}.meta`;
  const existing = readJsonIfExists(metaFile) || {};
  const meta = {
    ver: existing.ver || '4.0.24',
    importer: existing.importer || 'typescript',
    imported: existing.imported ?? true,
    uuid: existing.uuid || stableUuid(scriptRuntimeSeed(script)),
    files: Array.isArray(existing.files) ? existing.files : [],
    subMetas: {},
    userData: { ...(existing.userData || {}) },
  };
  if (JSON.stringify(existing) !== JSON.stringify(meta)) {
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }
}

function objectByRef(objects, ref) {
  const id = Number(ref?.__id__);
  return Number.isInteger(id) ? objects[id] : null;
}

function setCocosCurveConstant(objects, owner, prop, value) {
  const curve = objectByRef(objects, owner?.[prop]);
  if (!curve) return false;
  curve.mode = 0;
  curve.multiplier = 1;
  curve.constant = value;
  delete curve.constantMin;
  delete curve.constantMax;
  delete curve.spline;
  delete curve.splineMin;
  delete curve.splineMax;
  return true;
}

function unitySubEmitterEntries(doc) {
  const data = parseUnityParticleDoc(doc);
  const module = data?.SubModule;
  if (!module || !Number(module.enabled || 0)) return [];
  return Array.isArray(module.subEmitters) ? module.subEmitters : [];
}

function subEmitterTypeName(type) {
  if (type === SUB_EMITTER_TYPE.birth) return 'Birth';
  if (type === SUB_EMITTER_TYPE.death) return 'Death';
  return `type ${type}`;
}

function findSubEmitterFollowerComponent(builder, sourceNode, followerTypeIds, sourceParticleId) {
  for (const componentRef of sourceNode._components || []) {
    const componentId = Number(componentRef?.__id__);
    const component = Number.isInteger(componentId) ? builder.objects[componentId] : null;
    if (!component || !followerTypeIds.has(component.__type__)) continue;
    if (Number(component.source?.__id__) !== sourceParticleId) continue;
    return componentId;
  }
  return null;
}

function hasSubEmitterEntry(component, type, subEmitterParticleId) {
  return (component.entries || []).some((entry) => (
    Number(entry?.type) === type
    && Number(entry?.subEmitter?.__id__) === subEmitterParticleId
  ));
}

function makeSubEmitterEntry(script, type, entry, subEmitterParticleId, subEmitterNodeId) {
  const emitProbability = Math.max(0, Math.min(1, Number(entry?.emitProbability ?? 1)));
  return {
    __type__: script.entryClassName,
    type,
    subEmitter: cocosRef(subEmitterParticleId),
    inherit: Number(entry?.properties || 0),
    emitProbability,
    subEmitterNode: cocosRef(subEmitterNodeId),
    emitRatePerParticle: type === SUB_EMITTER_TYPE.birth ? 36 : 0,
    particlesPerSample: 1,
    maxSourceParticles: 32,
    deathBurstCount: 1,
    playSubEmitterOnEnable: type === SUB_EMITTER_TYPE.birth,
  };
}

function vec3Magnitude(value) {
  return Math.abs(Number(value?.x || 0)) + Math.abs(Number(value?.y || 0)) + Math.abs(Number(value?.z || 0));
}

function nodeHasParticleSystemComponent(builder, nodeId) {
  const node = builder?.objects?.[nodeId];
  if (!node || node.__type__ !== 'cc.Node') return false;
  return (node._components || []).some((componentRef) => {
    const componentId = Number(componentRef?.__id__);
    return builder.objects[componentId]?.__type__ === 'cc.ParticleSystem';
  });
}

function makeHierarchySyncEntry(script, nodeId, node) {
  const euler = node?._euler || {};
  return {
    __type__: script.entryClassName,
    target: cocosRef(nodeId),
    baseEuler: vec3(Number(euler.x || 0), Number(euler.y || 0), Number(euler.z || 0)),
  };
}

function nodeHasComponentType(builder, nodeId, type) {
  const node = builder?.objects?.[nodeId];
  if (!node || node.__type__ !== 'cc.Node') return false;
  return (node._components || []).some((componentRef) => {
    const componentId = Number(componentRef?.__id__);
    return builder.objects[componentId]?.__type__ === type;
  });
}

function createRuntimeComponentPorter(deps) {
  const ensureDirectoryMetas = deps.ensureDirectoryMetas;
  const syncImportedMaterialLibraryCache = deps.syncImportedMaterialLibraryCache;

  function ensureRuntimeScript(script, options, reporter) {
    return writeStableRuntimeScript(script, options, reporter, ensureDirectoryMetas);
  }

  function ensureSpriteRendererColorAssets(options, reporter) {
    if (options.dryRun) return;

    if (!fs.existsSync(SPRITE_RENDERER_COLOR_EFFECT_TEMPLATE)) {
      reporter?.medium(
        'SPRITE_RENDERER_COLOR_EFFECT_TEMPLATE_MISSING',
        SPRITE_RENDERER_COLOR_EFFECT_TEMPLATE,
        '',
        'Unity SpriteRenderer color adapter needs a tint-capable SpriteRenderer effect, but the template is missing'
      );
      return;
    }

    const effectFile = path.join(options.cocosRoot, SPRITE_RENDERER_COLOR_EFFECT);
    const effectDir = path.dirname(effectFile);
    ensureDir(effectDir);
    ensureDirectoryMetas(effectDir, path.join(options.cocosRoot, 'assets'));

    const effectText = fs.readFileSync(SPRITE_RENDERER_COLOR_EFFECT_TEMPLATE, 'utf8');
    const currentEffectText = fs.existsSync(effectFile) ? fs.readFileSync(effectFile, 'utf8') : '';
    if (effectText !== currentEffectText) fs.writeFileSync(effectFile, effectText, 'utf8');

    const effectMetaFile = `${effectFile}.meta`;
    const existingEffectMeta = readJsonIfExists(effectMetaFile) || {};
    const effectMeta = {
      ver: existingEffectMeta.ver || '1.7.1',
      importer: existingEffectMeta.importer || 'effect',
      imported: existingEffectMeta.imported ?? true,
      uuid: existingEffectMeta.uuid || stableUuid('unity-cocos-port-runtime-effect:UnitySpriteRendererColor'),
      files: Array.isArray(existingEffectMeta.files) ? existingEffectMeta.files : ['.json'],
      subMetas: {},
      userData: { ...(existingEffectMeta.userData || {}) },
    };
    if (JSON.stringify(existingEffectMeta) !== JSON.stringify(effectMeta)) {
      fs.writeFileSync(effectMetaFile, `${JSON.stringify(effectMeta, null, 2)}\n`, 'utf8');
    }

    const materialFile = path.join(options.cocosRoot, SPRITE_RENDERER_COLOR_MATERIAL);
    const materialDir = path.dirname(materialFile);
    ensureDir(materialDir);
    ensureDirectoryMetas(materialDir, path.join(options.cocosRoot, 'assets'));

    const materialData = {
      __type__: 'cc.Material',
      _name: 'UnitySpriteRendererColor',
      _objFlags: 0,
      __editorExtras__: {},
      _native: '',
      _effectAsset: cocosUuid(effectMeta.uuid, 'cc.EffectAsset'),
      _techIdx: 0,
      _defines: [{}],
      _states: [{
        rasterizerState: {},
        depthStencilState: {},
        blendState: { targets: [{}] },
      }],
      _props: [{
        mainColor: color(255, 255, 255, 255),
      }],
    };
    fs.writeFileSync(materialFile, `${JSON.stringify(materialData, null, 2)}\n`, 'utf8');

    const materialMetaFile = `${materialFile}.meta`;
    const existingMaterialMeta = readJsonIfExists(materialMetaFile) || {};
    const materialMeta = {
      ver: existingMaterialMeta.ver || COCOS_MATERIAL_IMPORTER_VERSION,
      importer: existingMaterialMeta.importer || 'material',
      imported: existingMaterialMeta.imported ?? true,
      uuid: existingMaterialMeta.uuid || stableUuid('unity-cocos-port-runtime-material:UnitySpriteRendererColor'),
      files: Array.isArray(existingMaterialMeta.files) ? existingMaterialMeta.files : ['.json'],
      subMetas: {},
      userData: { ...(existingMaterialMeta.userData || {}) },
    };
    if (JSON.stringify(existingMaterialMeta) !== JSON.stringify(materialMeta)) {
      fs.writeFileSync(materialMetaFile, `${JSON.stringify(materialMeta, null, 2)}\n`, 'utf8');
    }
    syncImportedMaterialLibraryCache(materialData, materialMeta, options);

    const opaqueMaterialFile = path.join(options.cocosRoot, SPRITE_RENDERER_COLOR_OPAQUE_MATERIAL);
    const opaqueMaterialData = {
      ...materialData,
      _name: 'UnitySpriteRendererColorOpaque',
      _techIdx: 1,
      _defines: [{}, {}],
      _states: [
        {
          rasterizerState: {},
          depthStencilState: {},
          blendState: { targets: [{}] },
        },
        {
          rasterizerState: {},
          depthStencilState: {},
          blendState: { targets: [{}] },
        },
      ],
      _props: [
        { mainColor: color(255, 255, 255, 255) },
        { mainColor: color(255, 255, 255, 255) },
      ],
    };
    fs.writeFileSync(opaqueMaterialFile, `${JSON.stringify(opaqueMaterialData, null, 2)}\n`, 'utf8');

    const opaqueMaterialMetaFile = `${opaqueMaterialFile}.meta`;
    const existingOpaqueMaterialMeta = readJsonIfExists(opaqueMaterialMetaFile) || {};
    const opaqueMaterialMeta = {
      ver: existingOpaqueMaterialMeta.ver || COCOS_MATERIAL_IMPORTER_VERSION,
      importer: existingOpaqueMaterialMeta.importer || 'material',
      imported: existingOpaqueMaterialMeta.imported ?? true,
      uuid: existingOpaqueMaterialMeta.uuid || stableUuid('unity-cocos-port-runtime-material:UnitySpriteRendererColorOpaque'),
      files: Array.isArray(existingOpaqueMaterialMeta.files) ? existingOpaqueMaterialMeta.files : ['.json'],
      subMetas: {},
      userData: { ...(existingOpaqueMaterialMeta.userData || {}) },
    };
    if (JSON.stringify(existingOpaqueMaterialMeta) !== JSON.stringify(opaqueMaterialMeta)) {
      fs.writeFileSync(opaqueMaterialMetaFile, `${JSON.stringify(opaqueMaterialMeta, null, 2)}\n`, 'utf8');
    }
    syncImportedMaterialLibraryCache(opaqueMaterialData, opaqueMaterialMeta, options);

    const glowMaterialFile = path.join(options.cocosRoot, SPRITE_RENDERER_COLOR_GLOW_MATERIAL);
    const glowMaterialData = {
      ...materialData,
      _name: 'UnitySpriteRendererGlow',
      _techIdx: 2,
      _defines: [{}, {}, {}],
      _states: [
        {
          rasterizerState: {},
          depthStencilState: {},
          blendState: { targets: [{}] },
        },
        {
          rasterizerState: {},
          depthStencilState: {},
          blendState: { targets: [{}] },
        },
        {
          rasterizerState: {},
          depthStencilState: {},
          blendState: { targets: [{}] },
        },
      ],
      _props: [
        { mainColor: color(255, 255, 255, 255) },
        { mainColor: color(255, 255, 255, 255) },
        { mainColor: color(75, 55, 157, 255) },
      ],
    };
    fs.writeFileSync(glowMaterialFile, `${JSON.stringify(glowMaterialData, null, 2)}\n`, 'utf8');

    const glowMaterialMetaFile = `${glowMaterialFile}.meta`;
    const existingGlowMaterialMeta = readJsonIfExists(glowMaterialMetaFile) || {};
    const glowMaterialMeta = {
      ver: existingGlowMaterialMeta.ver || COCOS_MATERIAL_IMPORTER_VERSION,
      importer: existingGlowMaterialMeta.importer || 'material',
      imported: existingGlowMaterialMeta.imported ?? true,
      uuid: existingGlowMaterialMeta.uuid || stableUuid('unity-cocos-port-runtime-material:UnitySpriteRendererGlow'),
      files: Array.isArray(existingGlowMaterialMeta.files) ? existingGlowMaterialMeta.files : ['.json'],
      subMetas: {},
      userData: { ...(existingGlowMaterialMeta.userData || {}) },
    };
    if (JSON.stringify(existingGlowMaterialMeta) !== JSON.stringify(glowMaterialMeta)) {
      fs.writeFileSync(glowMaterialMetaFile, `${JSON.stringify(glowMaterialMeta, null, 2)}\n`, 'utf8');
    }
    syncImportedMaterialLibraryCache(glowMaterialData, glowMaterialMeta, options);
  }

  function spriteRendererColorMaterialUuid(options, opaque, glow) {
    const assetPath = glow
      ? SPRITE_RENDERER_COLOR_GLOW_MATERIAL
      : opaque
        ? SPRITE_RENDERER_COLOR_OPAQUE_MATERIAL
        : SPRITE_RENDERER_COLOR_MATERIAL;
    const seed = glow
      ? 'UnitySpriteRendererGlow'
      : opaque
        ? 'UnitySpriteRendererColorOpaque'
        : 'UnitySpriteRendererColor';
    const meta = readJsonIfExists(path.join(options.cocosRoot || ROOT_DIR, `${assetPath}.meta`));
    return meta?.uuid || stableUuid(`unity-cocos-port-runtime-material:${seed}`);
  }

  function attachParticleSubEmitterFollowers(model, builder, reporter) {
    const script = RUNTIME_SCRIPTS.particleSubEmitterFollower;
    const followerClassId = readRuntimeScriptClassId(script, builder.cocosDb);
    const followerTypeIds = new Set([followerClassId, script.className].filter(Boolean));

    for (const [componentId, doc] of model.componentDocs.entries()) {
      const classId = Number(doc?.classId || 0);
      if (classId !== 198 && classId !== 223) continue;

      const sourceParticleId = builder.componentMap.get(componentId);
      const sourceParticle = builder.objects[sourceParticleId];
      const sourceNodeId = Number(sourceParticle?.node?.__id__);
      const sourceNode = Number.isInteger(sourceNodeId) ? builder.objects[sourceNodeId] : null;
      if (!sourceParticle || !sourceNode) continue;

      for (const entry of unitySubEmitterEntries(doc)) {
        const type = Number(entry?.type || 0);
        if (type !== SUB_EMITTER_TYPE.birth && type !== SUB_EMITTER_TYPE.death) {
          reporter.low(
            'PARTICLE_SUB_EMITTER_TYPE_UNSUPPORTED',
            model.file,
            sourceNode._name || '',
            `Unity ${subEmitterTypeName(type)} Sub Emitter is not approximated yet`
          );
          continue;
        }
        if (Number(entry?.emitProbability ?? 1) <= 0) continue;

        const subEmitterFileId = String(entry?.emitter?.fileID || '');
        const subEmitterParticleId = builder.componentMap.get(subEmitterFileId);
        const subEmitterParticle = builder.objects[subEmitterParticleId];
        const subEmitterNodeId = Number(subEmitterParticle?.node?.__id__);
        const subEmitterNode = Number.isInteger(subEmitterNodeId) ? builder.objects[subEmitterNodeId] : null;
        if (!subEmitterParticle || !subEmitterNode) continue;

        if (!followerClassId) {
          reporter.medium(
            'PARTICLE_SUB_EMITTER_FOLLOWER_SCRIPT_MISSING',
            model.file,
            sourceNode._name || '',
            `Unity ${subEmitterTypeName(type)} Sub Emitter needs ${toPosix(scriptTargetPath(script))} but the script was not found in Cocos assets`
          );
          continue;
        }

        let followerComponentId = findSubEmitterFollowerComponent(builder, sourceNode, followerTypeIds, sourceParticleId);
        if (followerComponentId == null) {
          followerComponentId = builder.addComponent(sourceNodeId, followerClassId, {
            source: cocosRef(sourceParticleId),
            entries: [],
          }, null, `cmp-unity-sub-emitter-follower-${componentId}`);
        }

        const followerComponent = builder.objects[followerComponentId];
        if (!Array.isArray(followerComponent.entries)) followerComponent.entries = [];
        if (hasSubEmitterEntry(followerComponent, type, subEmitterParticleId)) continue;

        subEmitterParticle._simulationSpace = 0;
        subEmitterParticle.playOnAwake = false;
        subEmitterParticle.loop = type === SUB_EMITTER_TYPE.birth;
        if (type === SUB_EMITTER_TYPE.death) subEmitterNode._active = false;
        setCocosCurveConstant(builder.objects, subEmitterParticle, 'rateOverTime', 0);
        setCocosCurveConstant(builder.objects, subEmitterParticle, 'rateOverDistance', 0);

        followerComponent.entries.push(makeSubEmitterEntry(script, type, entry, subEmitterParticleId, subEmitterNodeId));

        reporter.low(
          'PARTICLE_SUB_EMITTER_FOLLOWER',
          model.file,
          sourceNode._name || '',
          `Unity ${subEmitterTypeName(type)} Sub Emitter is approximated by ${script.className} targeting ${subEmitterNode._name || 'sub-emitter'}`
        );
      }
    }
  }

  function attachParticleHierarchyTransformSync(builder, reporter) {
    const rootNodeId = 1;
    const rootNode = builder?.objects?.[rootNodeId];
    if (!rootNode || rootNode.__type__ !== 'cc.Node') return;
    if (vec3Magnitude(rootNode._euler) < 1e-4) return;

    const entryNodes = (rootNode._children || [])
      .map((childRef) => Number(childRef?.__id__))
      .filter((childId) => Number.isInteger(childId))
      .map((childId) => ({ childId, node: builder.objects[childId] }))
      .filter(({ node }) => node?.__type__ === 'cc.Node')
      .filter(({ childId, node }) => nodeHasParticleSystemComponent(builder, childId) && vec3Magnitude(node._lpos) < 1e-4);

    if (!entryNodes.length) return;

    const script = RUNTIME_SCRIPTS.particleHierarchyTransformSync;
    const helperClassId = readRuntimeScriptClassId(script, builder.cocosDb);
    if (!helperClassId) {
      reporter.medium(
        'PARTICLE_HIERARCHY_TRANSFORM_SYNC_SCRIPT_MISSING',
        '',
        rootNode._name || '',
        `Rotated particle root needs ${toPosix(scriptTargetPath(script))} but the script was not found in Cocos assets`
      );
      return;
    }

    builder.addComponent(rootNodeId, helperClassId, {
      entries: entryNodes.map(({ childId, node }) => makeHierarchySyncEntry(script, childId, node)),
    }, null, `cmp-unity-particle-hierarchy-sync-${rootNode._name || rootNodeId}`);

    reporter.low(
      'PARTICLE_HIERARCHY_TRANSFORM_SYNC',
      '',
      rootNode._name || '',
      `Attached ${script.className} to mirror root rotation onto ${entryNodes.length} child particle node(s)`
    );
  }

  function attachParticleRateOverDistanceEmitters(model, builder, reporter) {
    const script = RUNTIME_SCRIPTS.particleRateOverDistanceEmitter;
    const helperClassId = readRuntimeScriptClassId(script, builder.cocosDb);

    for (const [componentId, doc] of model.componentDocs.entries()) {
      const classId = Number(doc?.classId || 0);
      if (classId !== 198 && classId !== 223) continue;

      const data = parseUnityParticleDoc(doc);
      const rateRange = data?.EmissionModule?.rateOverDistance;
      if (Number(rateRange?.minMaxState || 0) !== 0) continue;

      const rateOverDistance = Number(rateRange?.scalar || 0);
      if (!(rateOverDistance > 0)) continue;

      const particleId = builder.componentMap.get(componentId);
      const particle = builder.objects[particleId];
      const nodeId = Number(particle?.node?.__id__);
      const node = Number.isInteger(nodeId) ? builder.objects[nodeId] : null;
      if (!particle || !node) continue;

      if (!helperClassId) {
        reporter.medium(
          'PARTICLE_RATE_OVER_DISTANCE_EMITTER_SCRIPT_MISSING',
          model.file,
          node._name || '',
          `Unity Rate over Distance needs ${toPosix(scriptTargetPath(script))} but the script was not found in Cocos assets`
        );
        continue;
      }

      setCocosCurveConstant(builder.objects, particle, 'rateOverDistance', 0);
      if (!nodeHasComponentType(builder, nodeId, helperClassId)) {
        builder.addComponent(nodeId, helperClassId, {
          particleSystem: cocosRef(particleId),
          rateOverDistance,
        }, null, `cmp-unity-particle-rate-over-distance-${componentId}`);
      }

      reporter.low(
        'PARTICLE_RATE_OVER_DISTANCE_EMITTER',
        model.file,
        node._name || '',
        `Attached ${script.className} to distribute ${rateOverDistance} particle(s) per world unit along high-speed movement`
      );
    }
  }

  function attachUnitySpriteRendererColorAdapter(nodeId, unityComponentId, spriteRendererId, builder, reporter, opaque = false, glow = false) {
    const script = RUNTIME_SCRIPTS.spriteRendererColorAdapter;
    const adapterClassId = readRuntimeScriptClassId(script, builder.cocosDb);
    const node = builder.objects[nodeId];
    const spriteRenderer = builder.objects[spriteRendererId];
    if (!node || !spriteRenderer) return;

    if (!adapterClassId) {
      reporter.medium(
        'SPRITE_RENDERER_COLOR_ADAPTER_SCRIPT_MISSING',
        '',
        node._name || '',
        `Unity SpriteRenderer color animation needs ${toPosix(scriptTargetPath(script))} but the script was not found in Cocos assets`
      );
      return;
    }

    if (nodeHasComponentType(builder, nodeId, adapterClassId)) return;

    const sourceColor = spriteRenderer._color || {};
    const tintMaterialUuid = spriteRendererColorMaterialUuid(builder.options || {}, opaque, glow);
    if (tintMaterialUuid) spriteRenderer._materials = [cocosUuid(tintMaterialUuid, 'cc.Material')];

    builder.addComponent(nodeId, adapterClassId, {
      color: color(
        Number(sourceColor.r ?? 255),
        Number(sourceColor.g ?? 255),
        Number(sourceColor.b ?? 255),
        Number(sourceColor.a ?? 255)
      ),
      applyMaterialColor: !glow,
    }, null, `cmp-unity-sprite-renderer-color-${unityComponentId}`);
  }

  return {
    ensureParticleSubEmitterFollowerScript: (options, reporter) => ensureRuntimeScript(RUNTIME_SCRIPTS.particleSubEmitterFollower, options, reporter),
    ensureParticleHierarchyTransformSyncScript: (options, reporter) => ensureRuntimeScript(RUNTIME_SCRIPTS.particleHierarchyTransformSync, options, reporter),
    ensureParticleRateOverDistanceEmitterScript: (options, reporter) => ensureRuntimeScript(RUNTIME_SCRIPTS.particleRateOverDistanceEmitter, options, reporter),
    ensureSpriteRendererColorAdapterScript: (options, reporter) => ensureRuntimeScript(RUNTIME_SCRIPTS.spriteRendererColorAdapter, options, reporter),
    ensureSpriteRendererColorAssets,
    attachParticleSubEmitterFollowers,
    attachParticleHierarchyTransformSync,
    attachParticleRateOverDistanceEmitters,
    attachUnitySpriteRendererColorAdapter,
  };
}

module.exports = createRuntimeComponentPorter;
