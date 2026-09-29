'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');

// Unity WindZone (class 182) and the particle External Forces module that it drives.
// The force law is native-measured (fixtures/wind-zone-native.json, runtime/UnityWindZone.ts).
const WIND_ZONE_RUNTIME = ['UnityWindZone'];
const EXTERNAL_FORCES_RUNTIME = ['UnityWindZone', 'UnityParticleExternalForces', 'UnityParticleExternalForcesAdapter'];
const ALL_LAYERS = 4294967295;

function stageRuntime(options, names) {
  if (options.dryRun) return;
  for (const name of names) {
    const target = path.join(options.cocosRoot, 'assets/script', `${name}.ts`);
    const text = fs.readFileSync(path.join(__dirname, 'runtime', `${name}.ts`), 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text);
    // AssetDB owns .meta creation and UUIDs: a first import needs a refresh and another porter pass.
  }
}

function scriptClassId(cocosDb, cocosRoot, name) {
  let classId = cocosDb?.findScriptClass?.(name)?.classId;
  const meta = path.join(cocosRoot, 'assets/script', `${name}.ts.meta`);
  if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
  return classId || null;
}

/** Source state of ExternalForcesModule (serialized Unity 2017+ shape; multiplierCurve on newer versions). */
function particleExternalForcesContract(particle = {}) {
  const module = particle.ExternalForcesModule || {};
  const curve = module.multiplierCurve && typeof module.multiplierCurve === 'object' ? module.multiplierCurve : null;
  const bits = module.influenceMask && typeof module.influenceMask === 'object' ? Number(module.influenceMask.m_Bits ?? ALL_LAYERS) : ALL_LAYERS;
  const list = Array.isArray(module.influenceList) ? module.influenceList.length : 0;
  return {
    enabled: Number(module.enabled) === 1,
    multiplier: Number(curve ? curve.scalar ?? 1 : module.multiplier ?? 1),
    multiplierMode: curve ? Number(curve.minMaxState ?? 0) : 0,
    influenceFilter: Number(module.influenceFilter ?? 0),
    influenceMask: bits >>> 0,
    influenceList: list,
  };
}

function unsupportedExternalForcesReasons(spec) {
  const reasons = [];
  if (spec.multiplierMode !== 0) reasons.push('multiplier-curve');
  if (spec.influenceFilter !== 0 || spec.influenceMask !== ALL_LAYERS) reasons.push('influence-filter');
  return reasons;
}

/** Dispatcher handler for Unity WindZone (class 182). */
function emitWindZone(ctx, getField) {
  const { nodeId, componentId, doc, builder, reporter, options, cocosDb, model, gameObject } = ctx;
  stageRuntime(options, WIND_ZONE_RUNTIME);
  const classId = scriptClassId(cocosDb || builder.cocosDb, options.cocosRoot, 'UnityWindZone');
  if (!classId) {
    reporter.high('WIND_ZONE_RUNTIME_REQUIRED', model.file, gameObject.name,
      'AssetDB must import assets/script/UnityWindZone.ts; refresh and rerun porter.');
    return null;
  }
  const number = (key, fallback) => { const v = Number(getField(doc, key, fallback)); return Number.isFinite(v) ? v : fallback; };
  builder.addComponent(nodeId, classId, {
    mode: number('m_Mode', 0), radius: number('m_Radius', 20), windMain: number('m_WindMain', 1),
    windTurbulence: number('m_WindTurbulence', 1), windPulseMagnitude: number('m_WindPulseMagnitude', 0.5),
    windPulseFrequency: number('m_WindPulseFrequency', 0.01),
  }, componentId, `cmp-unity-wind-zone-${componentId}`);
  reporter.low('WIND_ZONE_BOUND', model.file, gameObject.name,
    'Unity WindZone ported as UnityWindZone; it moves particles whose External Forces module is enabled (native-measured law).');
  return true;
}

function attachExternalForcesRuntime(builder, reporter, options) {
  const particles = builder.objects.map((p, id) => ({ p, id })).filter(({ p }) => p?.unityExternalForcesContract?.enabled);
  if (!particles.length) return;
  stageRuntime(options, EXTERNAL_FORCES_RUNTIME);
  const classId = scriptClassId(builder.cocosDb, options.cocosRoot, 'UnityParticleExternalForcesAdapter');
  for (const { p, id } of particles) {
    const name = builder.objects[p.node.__id__]?._name || '';
    const spec = p.unityExternalForcesContract;
    const reasons = unsupportedExternalForcesReasons(spec);
    if (reasons.length) {
      reporter.high('PARTICLE_EXTERNAL_FORCES_UNSUPPORTED', options.src || '', name,
        `Unity External Forces ${reasons.join(', ')} is not ported; the module was not bound.`);
      continue;
    }
    if (!classId) {
      reporter.high('PARTICLE_EXTERNAL_FORCES_ADAPTER_REQUIRED', options.src || '', name,
        'AssetDB must import assets/script/UnityParticleExternalForcesAdapter.ts; refresh and rerun porter.');
      continue;
    }
    builder.addComponent(p.node.__id__, classId, { source: { __id__: id }, multiplier: spec.multiplier }, null, `cmp-unity-external-forces-${id}`);
    reporter.low('PARTICLE_EXTERNAL_FORCES_BOUND', options.src || '', name,
      `Unity External Forces (multiplier ${spec.multiplier}) attached; WindZones anywhere in the scene move these particles.`);
  }
}

module.exports = { particleExternalForcesContract, unsupportedExternalForcesReasons, emitWindZone, attachExternalForcesRuntime, stageRuntime };
