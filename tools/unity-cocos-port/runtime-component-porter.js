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
const SCRIPT_TARGET_DIR = path.join('assets', 'script');
const LEGACY_SCRIPT_TARGET_DIR = path.join('assets', 'scripts');

const SUB_EMITTER_TYPE = {
  birth: 0,
  death: 2,
};

const RUNTIME_SCRIPTS = {
  particleRendererVisibility: {
    className: 'UnityParticleRendererVisibility',
    missingCode: 'PARTICLE_RENDERER_VISIBILITY_TEMPLATE_MISSING',
    missingMessage: 'Disabled Unity particle renderers need a visibility adapter that preserves simulation',
  },
  uiLayout: {
    className: 'UnityFixedLayoutGroup',
    missingCode: 'UI_LAYOUT_TEMPLATE_MISSING',
    missingMessage: 'Unity fixed-size layout requires its runtime adapter',
  },
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
  particlePrewarm: {
    className: 'UnityParticlePrewarm',
    missingCode: 'PARTICLE_PREWARM_TEMPLATE_MISSING',
    missingMessage: 'Unity prewarm needs a fine-stepped prewarm adapter, but the template is missing',
  },
  particleModuleSpace: {
    className: 'UnityParticleModuleSpace',
    missingCode: 'PARTICLE_MODULE_SPACE_TEMPLATE_MISSING',
    missingMessage: 'Local/world-space velocity, force and limit-velocity modules need a space adapter, but the template is missing',
  },
  particleDepthSort: {
    className: 'UnityParticleDepthSort',
    missingCode: 'PARTICLE_DEPTH_SORT_TEMPLATE_MISSING',
    missingMessage: 'Unity back-to-front particle sorting needs its runtime adapter, but the template is missing',
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

function legacyScriptTargetPath(script) {
  return path.join(LEGACY_SCRIPT_TARGET_DIR, `${script.className}.ts`);
}

function scriptTemplatePath(script) {
  return path.join(RUNTIME_DIR, `${script.className}.ts`);
}

function scriptRuntimeSeed(script) {
  return `unity-cocos-port-runtime-script:${script.className}`;
}

function findRuntimeScriptAlternatives(cocosRoot, script, targetFile) {
  const scriptRoot = path.join(cocosRoot, SCRIPT_TARGET_DIR);
  if (!fs.existsSync(scriptRoot)) return [];
  const result = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name === `${script.className}.ts` && path.resolve(absolute) !== path.resolve(targetFile)) result.push(absolute);
    }
  };
  visit(scriptRoot);
  return result;
}

function assetTreeReferencesScriptUuid(cocosRoot, uuid) {
  if (!uuid) return false;
  const classId = compressUuid(uuid);
  const assetsRoot = path.join(cocosRoot, 'assets');
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (visit(absolute)) return true;
      } else if (entry.isFile() && /\.(prefab|scene)$/i.test(entry.name)) {
        if (fs.readFileSync(absolute, 'utf8').includes(classId)) return true;
      }
    }
    return false;
  };
  return fs.existsSync(assetsRoot) && visit(assetsRoot);
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

  const sourceText = fs.readFileSync(templateFile, 'utf8');
  const targetFile = path.join(options.cocosRoot, scriptTargetPath(script));
  const legacyFile = path.join(options.cocosRoot, legacyScriptTargetPath(script));
  const legacyMetaFile = `${legacyFile}.meta`;
  const legacyExists = fs.existsSync(legacyFile) || fs.existsSync(legacyMetaFile);
  const legacyText = fs.existsSync(legacyFile) ? fs.readFileSync(legacyFile, 'utf8') : '';
  const legacyMeta = readJsonIfExists(legacyMetaFile) || {};
  const targetMetaFile = `${targetFile}.meta`;
  const targetMeta = readJsonIfExists(targetMetaFile) || {};
  const alternatives = findRuntimeScriptAlternatives(options.cocosRoot, script, targetFile);

  if (alternatives.length > 0) {
    if (targetMeta.uuid && sourceText === (fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : '')) {
      const alternativeMeta = readJsonIfExists(`${alternatives[0]}.meta`) || {};
      const sharesExistingUuid = Boolean(alternativeMeta.uuid && alternativeMeta.uuid === targetMeta.uuid);
      if (!sharesExistingUuid && assetTreeReferencesScriptUuid(options.cocosRoot, targetMeta.uuid)) {
        reporter?.high(
          'RUNTIME_SCRIPT_DUPLICATE_CLASS_REFERENCED',
          targetFile,
          alternatives[0],
          `Generated ${script.className} duplicates an existing ccclass and is still referenced by a prefab; migrate those references before removing it`,
        );
        return;
      }
      fs.unlinkSync(targetFile);
      fs.unlinkSync(targetMetaFile);
    }
    reporter?.low(
      'RUNTIME_SCRIPT_EXISTING_CANONICAL_REUSED',
      alternatives[0],
      targetFile,
      `Reused existing ${script.className} under assets/script and skipped a duplicate ccclass registration`,
    );
    return;
  }

  if (legacyMeta.uuid && targetMeta.uuid && legacyMeta.uuid !== targetMeta.uuid) {
    reporter?.high(
      'RUNTIME_SCRIPT_UUID_CONFLICT',
      legacyMetaFile,
      targetMetaFile,
      `Refusing to remove legacy ${script.className}: canonical and legacy scripts have different UUIDs, so existing prefab references need an explicit migration`,
    );
    return;
  }

  if (legacyExists && legacyText && legacyText !== sourceText) {
    reporter?.high(
      'RUNTIME_SCRIPT_LEGACY_CUSTOMIZED',
      legacyFile,
      targetFile,
      `Refusing to migrate customized ${script.className} from assets/scripts; reconcile it with the shared runtime template before porting`,
    );
    return;
  }

  const targetDir = path.dirname(targetFile);
  ensureDir(targetDir);
  ensureDirectoryMetas(targetDir, path.join(options.cocosRoot, 'assets'));

  const targetText = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : '';
  if (sourceText !== targetText) fs.writeFileSync(targetFile, sourceText, 'utf8');

  const existing = Object.keys(targetMeta).length ? targetMeta : legacyMeta;
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
    fs.writeFileSync(targetMetaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  } else if (!fs.existsSync(targetMetaFile)) {
    fs.writeFileSync(targetMetaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }

  if (legacyExists) {
    if (fs.existsSync(legacyFile)) fs.unlinkSync(legacyFile);
    if (fs.existsSync(legacyMetaFile)) fs.unlinkSync(legacyMetaFile);
    const legacyDir = path.dirname(legacyFile);
    if (fs.existsSync(legacyDir) && fs.readdirSync(legacyDir).length === 0) {
      fs.rmdirSync(legacyDir);
      const legacyDirMeta = `${legacyDir}.meta`;
      if (fs.existsSync(legacyDirMeta)) fs.unlinkSync(legacyDirMeta);
    }
    reporter?.low(
      'RUNTIME_SCRIPT_CANONICAL_PATH_MIGRATED',
      legacyFile,
      targetFile,
      `Migrated ${script.className} to canonical assets/script while preserving its script UUID`,
    );
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

// A Unity Birth sub-emitter instance runs the sub-emitter system's own emission timeline per parent particle:
// rate over time, bursts, duration and looping come from the sub-emitter's main/emission modules.
function unitySubEmitterTimeline(subEmitterDoc) {
  const data = subEmitterDoc ? parseUnityParticleDoc(subEmitterDoc) : null;
  const emission = data?.EmissionModule || {};
  const rate = emission.rateOverTime || {};
  const approximations = [];
  if (Number(rate.minMaxState || 0) !== 0) approximations.push('rate over time curve uses its multiplier');
  const bursts = (Array.isArray(emission.m_Bursts) ? emission.m_Bursts : []).map((burst) => {
    const count = burst?.countCurve || {};
    if (Number(count.minMaxState || 0) !== 0) approximations.push('burst count curve uses its multiplier');
    if (Number(burst?.cycleCount ?? 1) !== 1) approximations.push('burst cycles beyond the first are ignored');
    return { time: Number(burst?.time || 0), count: Number(count.scalar ?? 0) * Math.max(0, Math.min(1, Number(burst?.probability ?? 1))) };
  });
  return {
    found: Boolean(data),
    rate: Number(rate.scalar || 0),
    duration: Number(data?.lengthInSec || 0),
    looping: data ? Boolean(Number(data.looping ?? 1)) : true,
    bursts,
    approximations,
  };
}

function quatMultiply(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function nodeWorldQuat(builder, nodeId) {
  let rotation = { x: 0, y: 0, z: 0, w: 1 };
  for (let id = nodeId, guard = 0; Number.isInteger(id) && guard < 256; guard++) {
    const node = builder.objects[id];
    if (!node || node.__type__ !== 'cc.Node') break;
    const local = node._lrot || { x: 0, y: 0, z: 0, w: 1 };
    rotation = quatMultiply({ x: Number(local.x || 0), y: Number(local.y || 0), z: Number(local.z || 0), w: Number(local.w ?? 1) }, rotation);
    id = Number(node._parent?.__id__);
  }
  return rotation;
}

// Angle between two nodes' emitter forwards (-Z), in degrees.
function emitterForwardAngle(builder, nodeA, nodeB) {
  const forward = (q) => ({ x: -2 * (q.x * q.z + q.w * q.y), y: -2 * (q.y * q.z - q.w * q.x), z: -(1 - 2 * (q.x * q.x + q.y * q.y)) });
  const a = forward(nodeWorldQuat(builder, nodeA));
  const b = forward(nodeWorldQuat(builder, nodeB));
  return Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) * 180 / Math.PI;
}

// Unity turns a Birth instance by FromTo(parent system forward, parent velocity); the runtime reproduces that rule,
// which was measured on sub-emitters whose forward stays close to their parent system's forward.
const SUB_EMITTER_ALIGNMENT_VALIDATED_DEGREES = 20;

// Unity sorts a renderer by its bounds centre. A procedural-mode ParticleSystem (Local space, not part of a
// sub-emitter pair, no modules that make particle motion unpredictable) reports analytic bounds covering every
// particle it can emit over its lifetime, so its centre does not move with the random draws of a given burst
// (Tanks! shell flash: always emitter + half its travel, behind the rising smoke). Measured on Unity 6
// (proceduralSimulationSupported + ParticleSystemRenderer.bounds): per axis the envelope is the shape extent plus the
// start-direction extremes times max speed x max lifetime, united with itself dropped by gravity over the lifetime.
const UNITY_GRAVITY = 9.81;
const PROCEDURAL_BREAKING_MODULES = ['NoiseModule', 'CollisionModule', 'TriggerModule', 'ExternalForcesModule', 'ClampVelocityModule',
  'InheritVelocityModule', 'TrailModule', 'LightsModule', 'VelocityModule', 'ForceModule', 'SubModule'];

function curveMax(curve, fallback) {
  const state = Number(curve?.minMaxState ?? 0);
  if (state !== 0 && state !== 3) return null;
  const scalar = Number(curve?.scalar ?? fallback);
  return state === 3 ? Math.max(scalar, Number(curve?.minScalar ?? scalar)) : scalar;
}

function curveMin(curve, fallback) {
  const state = Number(curve?.minMaxState ?? 0);
  const scalar = Number(curve?.scalar ?? fallback);
  return state === 3 ? Math.min(scalar, Number(curve?.minScalar ?? scalar)) : scalar;
}

function unityProceduralEnvelope(data) {
  if (!data || Number(data.moveWithTransform ?? 0) !== 0) return null;
  if (PROCEDURAL_BREAKING_MODULES.some((key) => Number(data[key]?.enabled || 0))) return null;
  const emission = data.EmissionModule || {};
  if (Number(emission.rateOverDistance?.scalar || 0) > 0) return null;
  const initial = data.InitialModule || {};
  const speed = curveMax(initial.startSpeed, 5);
  const life = curveMax(initial.startLifetime, 5);
  const gravity = curveMax(initial.gravityModifier, 0);
  if (speed == null || life == null || gravity == null || curveMin(initial.startSpeed, 5) < 0) return null;
  const shape = data.ShapeModule || {};
  let pos = [[0, 0], [0, 0], [0, 0]];
  let dir = [[0, 0], [0, 0], [1, 1]];
  if (Number(shape.enabled || 0)) {
    const zero = (v, d) => ['x', 'y', 'z'].every((k) => Math.abs(Number(v?.[k] ?? d) - d) < 1e-6);
    if (!zero(shape.m_Position, 0) || !zero(shape.m_Rotation, 0) || !zero(shape.m_Scale, 1)) return null;
    const r = Number(shape.radius?.value ?? shape.radius ?? 1);
    const arc = Number(shape.arc?.value ?? 360);
    const type = Number(shape.type);
    const disk = [[-r, r], [-r, r], [0, 0]];
    if (type === 4 || type === 7) { // cone base / cone shell: disk, directions within the cone angle
      const a = Number(shape.angle || 0) * Math.PI / 180;
      pos = disk; dir = [[-Math.sin(a), Math.sin(a)], [-Math.sin(a), Math.sin(a)], [Math.cos(a), 1]];
    } else if (type === 0 || type === 1) { // sphere
      pos = [[-r, r], [-r, r], [-r, r]]; dir = [[-1, 1], [-1, 1], [-1, 1]];
    } else if (type === 2 || type === 3) { // hemisphere toward +Z
      pos = [[-r, r], [-r, r], [0, r]]; dir = [[-1, 1], [-1, 1], [0, 1]];
    } else if ((type === 10 || type === 11) && arc >= 360) { // circle in XY, radial directions
      pos = disk; dir = [[-1, 1], [-1, 1], [0, 0]];
    } else {
      return null;
    }
  }
  const travel = speed * life;
  const min = pos.map(([lo], axis) => lo + Math.min(0, dir[axis][0] * travel));
  const max = pos.map(([, hi], axis) => hi + Math.max(0, dir[axis][1] * travel));
  return { min, max, gravityDrop: 0.5 * UNITY_GRAVITY * gravity * life * life };
}

function unitySubEmitterComponentIds(model) {
  const ids = new Set();
  for (const [componentId, doc] of model?.componentDocs?.entries?.() || []) {
    const classId = Number(doc?.classId || 0);
    if (classId !== 198 && classId !== 223) continue;
    const entries = unitySubEmitterEntries(doc);
    if (!entries.length) continue;
    ids.add(String(componentId));
    for (const entry of entries) ids.add(String(entry?.emitter?.fileID || ''));
  }
  return ids;
}

function makeSubEmitterEntry(script, type, entry, subEmitterParticleId, subEmitterNodeId, timeline) {
  const emitProbability = Math.max(0, Math.min(1, Number(entry?.emitProbability ?? 1)));
  const birth = type === SUB_EMITTER_TYPE.birth;
  return {
    __type__: script.entryClassName,
    type,
    subEmitter: cocosRef(subEmitterParticleId),
    inherit: Number(entry?.properties || 0),
    emitProbability,
    subEmitterNode: cocosRef(subEmitterNodeId),
    emitRatePerParticle: birth ? timeline.rate : 0,
    emitterDuration: birth ? timeline.duration : 0,
    emitterLooping: birth ? timeline.looping : true,
    burstTimes: birth ? timeline.bursts.map((burst) => burst.time) : [],
    burstCounts: birth ? timeline.bursts.map((burst) => burst.count) : [],
    particlesPerSample: 1,
    maxSourceParticles: 32,
    deathBurstCount: 1,
    playSubEmitterOnEnable: birth,
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
        const timeline = unitySubEmitterTimeline(model.componentDocs.get(subEmitterFileId));
        if (type === SUB_EMITTER_TYPE.birth && !timeline.found) {
          reporter.high('PARTICLE_SUB_EMITTER_TIMELINE_MISSING', model.file, subEmitterNode._name || '',
            'Unity Birth sub-emitter source document was not found; its per-parent emission rate cannot be ported');
        }
        const forwardAngle = emitterForwardAngle(builder, sourceNodeId, subEmitterNodeId);
        if (type === SUB_EMITTER_TYPE.birth && forwardAngle > SUB_EMITTER_ALIGNMENT_VALIDATED_DEGREES) {
          reporter.medium('PARTICLE_SUB_EMITTER_ALIGNMENT_UNVALIDATED', model.file, subEmitterNode._name || '',
            `Sub-emitter forward is ${forwardAngle.toFixed(0)} deg from its parent system's; Unity's parent-velocity alignment is only validated within ${SUB_EMITTER_ALIGNMENT_VALIDATED_DEGREES} deg`);
        }
        if (type === SUB_EMITTER_TYPE.birth && timeline.approximations.length) {
          reporter.medium('PARTICLE_SUB_EMITTER_TIMELINE_APPROXIMATED', model.file, subEmitterNode._name || '',
            'Unity Birth sub-emitter timeline approximated: ' + [...new Set(timeline.approximations)].join('; '));
        }
        setCocosCurveConstant(builder.objects, subEmitterParticle, 'rateOverTime', 0);
        setCocosCurveConstant(builder.objects, subEmitterParticle, 'rateOverDistance', 0);
        // The follower replays the bursts per parent instance; the looping native system would fire them on its own clock.
        if (type === SUB_EMITTER_TYPE.birth) subEmitterParticle.bursts = [];

        followerComponent.entries.push(makeSubEmitterEntry(script, type, entry, subEmitterParticleId, subEmitterNodeId, timeline));

        reporter.low(
          'PARTICLE_SUB_EMITTER_FOLLOWER',
          model.file,
          sourceNode._name || '',
          `Unity ${subEmitterTypeName(type)} Sub Emitter is approximated by ${script.className} targeting ${subEmitterNode._name || 'sub-emitter'}`
        );
      }
    }
  }

  function attachParticleRendererVisibility(builder, reporter) {
    const script=RUNTIME_SCRIPTS.particleRendererVisibility;
    const hidden=builder.objects.map((particle,id)=>({particle,id})).filter(({particle})=>particle?.unityRendererHidden);
    if(!hidden.length)return;
    const classId=readRuntimeScriptClassId(script,builder.cocosDb);
    if(!classId) {
      reporter.high('PARTICLE_RENDERER_VISIBILITY_SCRIPT_MISSING','','',script.missingMessage);
      return;
    }
    for(const {particle,id} of hidden)builder.addComponent(particle.node.__id__,classId,
      {source:cocosRef(id),rendererVisible:false,trailsVisible:particle.unityTrailsVisible},null,`cmp-unity-particle-visibility-${id}`);
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

  // Unity sorts every transparent ParticleSystemRenderer back to front by its particle bounds; Cocos sorts by
  // priority then pass hash. Attach UnityParticleDepthSort to each particle-system root (a node with a ParticleSystem
  // and no ParticleSystem ancestor) so every ported system gets a distance-derived priority.
  function attachParticleDepthSort(builder, reporter, model = null) {
    const script = RUNTIME_SCRIPTS.particleDepthSort;
    const roots = [];
    const walk = (nodeId, underParticle) => {
      const node = builder.objects[nodeId];
      if (!node || node.__type__ !== 'cc.Node') return;
      const hasParticle = nodeHasParticleSystemComponent(builder, nodeId);
      if (hasParticle && !underParticle) roots.push(nodeId);
      for (const childRef of node._children || []) walk(Number(childRef?.__id__), underParticle || hasParticle);
    };
    walk(1, false);
    // Unity procedural-mode systems sort by analytic bounds; everything else by its live particles.
    const envelopes = new Map();
    const subEmitterIds = unitySubEmitterComponentIds(model);
    for (const [componentId, doc] of model?.componentDocs?.entries?.() || []) {
      const classId = Number(doc?.classId || 0);
      if ((classId !== 198 && classId !== 223) || subEmitterIds.has(String(componentId))) continue;
      const particleId = builder.componentMap?.get(componentId) ?? builder.componentMap?.get(String(componentId));
      const envelope = unityProceduralEnvelope(parseUnityParticleDoc(doc));
      if (envelope && builder.objects[particleId]?.__type__ === 'cc.ParticleSystem') envelopes.set(particleId, envelope);
    }
    const subtreeSystems = (nodeId, out = []) => {
      const node = builder.objects[nodeId];
      if (!node || node.__type__ !== 'cc.Node') return out;
      for (const ref of node._components || []) {
        const id = Number(ref?.__id__);
        if (envelopes.has(id)) out.push(id);
      }
      for (const childRef of node._children || []) subtreeSystems(Number(childRef?.__id__), out);
      return out;
    };
    if (!roots.length) return;
    const helperClassId = readRuntimeScriptClassId(script, builder.cocosDb);
    if (!helperClassId) {
      reporter.medium('PARTICLE_DEPTH_SORT_SCRIPT_MISSING', '', builder.objects[1]?._name || '',
        `Particle sorting needs ${toPosix(scriptTargetPath(script))} but the script was not found in Cocos assets`);
      return;
    }
    for (const nodeId of roots) {
      if (nodeHasComponentType(builder, nodeId, helperClassId)) continue;
      // Unity local space -> Cocos local space mirrors Z.
      const systems = subtreeSystems(nodeId);
      const props = systems.length ? {
        proceduralSystems: systems.map((id) => cocosRef(id)),
        proceduralMins: systems.map((id) => { const e = envelopes.get(id); return vec3(e.min[0], e.min[1], -e.max[2]); }),
        proceduralMaxs: systems.map((id) => { const e = envelopes.get(id); return vec3(e.max[0], e.max[1], -e.min[2]); }),
        proceduralGravityDrops: systems.map((id) => envelopes.get(id).gravityDrop),
      } : {};
      builder.addComponent(nodeId, helperClassId, props, null, `cmp-unity-particle-depth-sort-${nodeId}`);
    }
    reporter.low('PARTICLE_DEPTH_SORT', '', builder.objects[1]?._name || '',
      `Attached ${script.className} to ${roots.length} particle root(s) for Unity back-to-front transparent sorting`);
  }

  // Unity prewarm simulates one full cycle; Cocos steps it at 1 s. Nodes with a prewarmed system get the
  // fine-stepped UnityParticlePrewarm adapter (installed in onLoad, before the system plays).
  function attachParticlePrewarm(builder, reporter) {
    const script = RUNTIME_SCRIPTS.particlePrewarm;
    const nodeIds = [];
    for (const object of builder.objects) {
      if (object?.__type__ !== 'cc.ParticleSystem' || object._prewarm !== true) continue;
      const nodeId = Number(object.node?.__id__);
      if (Number.isInteger(nodeId) && !nodeIds.includes(nodeId)) nodeIds.push(nodeId);
    }
    if (!nodeIds.length) return;
    const helperClassId = readRuntimeScriptClassId(script, builder.cocosDb);
    if (!helperClassId) {
      reporter.medium('PARTICLE_PREWARM_SCRIPT_MISSING', '', builder.objects[1]?._name || '',
        'Prewarmed particle systems need ' + toPosix(scriptTargetPath(script)) + ' but the script was not found in Cocos assets');
      return;
    }
    for (const nodeId of nodeIds) {
      if (!nodeHasComponentType(builder, nodeId, helperClassId)) builder.addComponent(nodeId, helperClassId, {}, null, 'cmp-unity-particle-prewarm-' + nodeId);
    }
    reporter.low('PARTICLE_PREWARM_ADAPTER', '', builder.objects[1]?._name || '',
      'Attached ' + script.className + ' to ' + nodeIds.length + ' prewarmed particle system(s)');
  }

  // Cocos 3.8.8 never refreshes a module's space rotation (see runtime/UnityParticleModuleSpace.ts), so every system
  // with an enabled Velocity/Force/Limit Velocity module in the other space gets the adapter.
  function attachParticleModuleSpace(builder, reporter) {
    const script = RUNTIME_SCRIPTS.particleModuleSpace;
    const targets = [];
    builder.objects.forEach((object, particleId) => {
      if (object?.__type__ !== 'cc.ParticleSystem') return;
      const space = Number(object._simulationSpace ?? 1);
      const mismatched = ['_velocityOvertimeModule', '_forceOvertimeModule', '_limitVelocityOvertimeModule']
        .map((key) => objectByRef(builder.objects, object[key]))
        .some((module) => module && module._enable === true && Number(module.space ?? 1) !== space);
      const nodeId = Number(object.node?.__id__);
      if (mismatched && Number.isInteger(nodeId)) targets.push({ particleId, nodeId });
    });
    if (!targets.length) return;
    const helperClassId = readRuntimeScriptClassId(script, builder.cocosDb);
    if (!helperClassId) {
      reporter.medium('PARTICLE_MODULE_SPACE_SCRIPT_MISSING', '', builder.objects[1]?._name || '',
        'Particle modules simulated in the other space need ' + toPosix(scriptTargetPath(script)) + ' but the script was not found in Cocos assets');
      return;
    }
    for (const { particleId, nodeId } of targets) {
      if (!nodeHasComponentType(builder, nodeId, helperClassId)) {
        builder.addComponent(nodeId, helperClassId, { particleSystem: cocosRef(particleId) }, null, 'cmp-unity-particle-module-space-' + particleId);
      }
    }
    reporter.low('PARTICLE_MODULE_SPACE_ADAPTER', '', builder.objects[1]?._name || '',
      'Attached ' + script.className + ' to ' + targets.length + ' particle system(s) with a velocity/force module in the other space');
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

      // The Unity doc holds the SOURCE prefab value. When this system came from a
      // nested PrefabInstance, the effective rate is whatever the flattening pass
      // already wrote onto the Cocos curve, so prefer that.
      const emittedCurve = objectByRef(builder.objects, particle.rateOverDistance);
      const effectiveRate = Number(emittedCurve?.constant);
      const rate = Number.isFinite(effectiveRate) && effectiveRate > 0
        ? effectiveRate
        : rateOverDistance;

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
          rateOverDistance: rate,
        }, null, `cmp-unity-particle-rate-over-distance-${componentId}`);
      }

      reporter.low(
        'PARTICLE_RATE_OVER_DISTANCE_EMITTER',
        model.file,
        node._name || '',
        `Attached ${script.className} to distribute ${rate} particle(s) per world unit along high-speed movement`
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
    ensureParticleRendererVisibilityScript: (options, reporter) => ensureRuntimeScript(RUNTIME_SCRIPTS.particleRendererVisibility, options, reporter),
    attachParticleRendererVisibility,
    ensureParticleSubEmitterFollowerScript: (options, reporter) => ensureRuntimeScript(RUNTIME_SCRIPTS.particleSubEmitterFollower, options, reporter),
    ensureUiLayoutScript: (options, reporter, cocosDb) => {
      const script = RUNTIME_SCRIPTS.uiLayout;
      ensureRuntimeScript(script, options, reporter);
      return readRuntimeScriptClassId(script, cocosDb)
        || (options.dryRun ? compressUuid(stableUuid(scriptRuntimeSeed(script))) : '');
    },
    ensureParticleHierarchyTransformSyncScript: (options, reporter) => ensureRuntimeScript(RUNTIME_SCRIPTS.particleHierarchyTransformSync, options, reporter),
    ensureParticleRateOverDistanceEmitterScript: (options, reporter) => ensureRuntimeScript(RUNTIME_SCRIPTS.particleRateOverDistanceEmitter, options, reporter),
    ensureSpriteRendererColorAdapterScript: (options, reporter) => ensureRuntimeScript(RUNTIME_SCRIPTS.spriteRendererColorAdapter, options, reporter),
    ensureParticleDepthSortScript: (options, reporter) => ensureRuntimeScript(RUNTIME_SCRIPTS.particleDepthSort, options, reporter),
    ensureParticlePrewarmScript: (options, reporter) => ensureRuntimeScript(RUNTIME_SCRIPTS.particlePrewarm, options, reporter),
    ensureParticleModuleSpaceScript: (options, reporter) => ensureRuntimeScript(RUNTIME_SCRIPTS.particleModuleSpace, options, reporter),
    attachParticlePrewarm,
    attachParticleModuleSpace,
    attachParticleDepthSort,
    ensureSpriteRendererColorAssets,
    attachParticleSubEmitterFollowers,
    attachParticleHierarchyTransformSync,
    attachParticleRateOverDistanceEmitters,
    attachUnitySpriteRendererColorAdapter,
  };
}

module.exports = createRuntimeComponentPorter;
module.exports.unityProceduralEnvelope = unityProceduralEnvelope;
