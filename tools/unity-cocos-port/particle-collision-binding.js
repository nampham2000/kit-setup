'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityParticleCollision', 'UnityParticleCollisionAdapter'];
const COLLISION_SUB_EMITTER = 1;

// Unity Collision module (serialized as CollisionModule) plus its Collision sub-emitters.
// Cocos has no particle collision; UnityParticleCollision casts each particle's step
// against the scene's physics colliders (World type only).
function curveScalar(curve, fallback) {
  if (!curve || typeof curve !== 'object') return { value: fallback, constant: true };
  return { value: Number(curve.scalar ?? fallback), constant: Number(curve.minMaxState ?? 0) === 0 };
}

function particleCollisionContract(particle = {}) {
  const module = particle.CollisionModule || {};
  const dampen = curveScalar(module.m_Dampen, 0);
  const bounce = curveScalar(module.m_Bounce, 1);
  const lifetimeLoss = curveScalar(module.m_EnergyLossOnCollision, 0);
  const sub = particle.SubModule || {};
  const subEmitters = Number(sub.enabled) === 1 && Array.isArray(sub.subEmitters)
    ? sub.subEmitters.filter((entry) => Number(entry?.type) === COLLISION_SUB_EMITTER)
      .map((entry) => ({
        fileId: String(entry?.emitter?.fileID || ''),
        probability: Math.max(0, Math.min(1, Number(entry?.emitProbability ?? 1))),
        // SubEmitterProperties bit 0: InheritColor.
        inheritColor: (Number(entry?.properties || 0) & 1) === 1,
        unsupportedProperties: Number(entry?.properties || 0) & ~1,
      }))
    : [];
  return {
    enabled: Number(module.enabled) === 1,
    type: Number(module.type ?? 0),
    mode2D: Number(module.collisionMode ?? 0) === 1,
    messages: Number(module.collisionMessages ?? 0) === 1,
    dampen: dampen.value, bounce: bounce.value, lifetimeLoss: lifetimeLoss.value,
    curves: [['dampen', dampen], ['bounce', bounce], ['lifetime loss', lifetimeLoss]].filter(([, v]) => !v.constant).map(([n]) => n),
    minKillSpeed: Number(module.minKillSpeed ?? 0),
    maxKillSpeed: Number(module.maxKillSpeed ?? 10000),
    radiusScale: Number(module.radiusScale ?? 1),
    subEmitters,
  };
}

function burstRange(builder, particle) {
  let min = 0, max = 0;
  for (const ref of particle.bursts || []) {
    const burst = builder.objects[ref?.__id__];
    const count = builder.objects[burst?.count?.__id__];
    if (!count) continue;
    const lo = Number(count.mode === 3 ? count.constantMin : count.constant) * Number(count.multiplier ?? 1);
    const hi = Number(count.mode === 3 ? count.constantMax : count.constant) * Number(count.multiplier ?? 1);
    if (Number.isFinite(lo) && Number.isFinite(hi)) { min += lo; max += hi; }
  }
  return { countMin: min, countMax: max };
}

function stageCollisionRuntime(options) {
  if (options.dryRun) return;
  for (const name of names) {
    const target = path.join(options.cocosRoot, 'assets/script', `${name}.ts`);
    const text = fs.readFileSync(path.join(__dirname, 'runtime', `${name}.ts`), 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // AssetDB owns .meta creation and UUIDs; a first import needs a refresh and another porter pass.
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text);
  }
}

function attachCollisionRuntime(builder, reporter, options) {
  const particles = builder.objects.map((p, id) => ({ p, id })).filter(({ p }) => p?.unityCollisionContract?.enabled);
  if (!particles.length) return;
  stageCollisionRuntime(options);
  let classId = builder.cocosDb?.findScriptClass?.('UnityParticleCollisionAdapter')?.classId;
  const meta = path.join(options.cocosRoot, 'assets/script/UnityParticleCollisionAdapter.ts.meta');
  if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
  for (const { p, id } of particles) {
    const spec = p.unityCollisionContract;
    const name = builder.objects[p.node.__id__]?._name || '';
    const blockers = [];
    if (spec.type !== 1) blockers.push('Planes type (plane transforms are not bound)');
    if (spec.mode2D) blockers.push('2D collision mode');
    if (blockers.length) {
      reporter.high('PARTICLE_COLLISION_UNSUPPORTED', options.src || '', name, `Unity particle collision ${blockers.join(', ')} is not ported; particles pass through geometry.`);
      continue;
    }
    if (spec.messages) {
      reporter.low('PARTICLE_COLLISION_MESSAGES_EVENT', options.src || '', name,
        "OnParticleCollision is delivered as node event 'unity-particle-collision' (intersection, normal); the receiving script must be ported to listen to it.");
    }
    if (spec.curves.length) {
      reporter.medium('PARTICLE_COLLISION_CURVE_APPROXIMATED', options.src || '', name, `Collision ${spec.curves.join(', ')} curve uses its scalar.`);
    }
    const targets = [];
    const subEmitters = [];
    for (const entry of spec.subEmitters) {
      const targetId = builder.componentMap.get(entry.fileId);
      const target = builder.objects[targetId];
      if (target?.__type__ !== 'cc.ParticleSystem') {
        reporter.high('PARTICLE_COLLISION_SUB_EMITTER_UNRESOLVED', options.src || '', name, `Collision sub-emitter ${entry.fileId} has no ported particle system.`);
        continue;
      }
      if (entry.unsupportedProperties) {
        reporter.medium('PARTICLE_COLLISION_SUB_EMITTER_PROPERTIES', options.src || '', name, `Sub-emitter inherit flags ${entry.unsupportedProperties} beyond color are not ported.`);
      }
      // Driven by the parent's collisions only (UnityParticleCollision clears its own emission).
      target.playOnAwake = false;
      targets.push({ __id__: targetId });
      subEmitters.push({ probability: entry.probability, inheritColor: entry.inheritColor, ...burstRange(builder, target) });
    }
    if (!classId) {
      reporter.high('PARTICLE_COLLISION_ADAPTER_REQUIRED', options.src || '', name,
        'AssetDB must import assets/script/UnityParticleCollisionAdapter.ts; refresh and rerun porter.');
      continue;
    }
    builder.addComponent(p.node.__id__, classId, {
      source: { __id__: id },
      targets,
      sourceContract: JSON.stringify({
        dampen: spec.dampen, bounce: spec.bounce, lifetimeLoss: spec.lifetimeLoss,
        minKillSpeed: spec.minKillSpeed, maxKillSpeed: spec.maxKillSpeed, radiusScale: spec.radiusScale, subEmitters, messages: spec.messages,
      }),
    }, null, `cmp-unity-collision-${id}`);
    reporter.low('PARTICLE_COLLISION_ADAPTER_BOUND', options.src || '', name,
      `Unity World collision bound against scene physics colliders with ${targets.length} collision sub-emitter(s); needs ported colliders and live preview acceptance.`);
  }
}

module.exports = { particleCollisionContract, stageCollisionRuntime, attachCollisionRuntime };
