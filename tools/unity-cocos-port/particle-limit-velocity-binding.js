'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityParticleLimitVelocity', 'UnityParticleLimitVelocityAdapter'];
// Runtime capability consumed by the Orbit/Noise bindings: the limit acts on stored +
// animated velocity and stores only the non-animated part (velocity-limit-composition-native.json).
const LIMIT_VELOCITY_COMPOSITION = 'animated-velocity-before-limit';

// Source state the Cocos module cannot hold. Unity serializes this module's
// flag as `separateAxis`; drag is not mapped by the converter. Unity applies the
// Velocity module speed modifier after the limit, Cocos before it.
function particleLimitVelocityContract(particle = {}) {
  const module = particle.ClampVelocityModule || {};
  const drag = module.drag && typeof module.drag === 'object' ? module.drag : {};
  const velocity = particle.VelocityModule || {};
  const speed = Number(velocity.enabled) === 1 && velocity.speedModifier && typeof velocity.speedModifier === 'object' ? velocity.speedModifier : {};
  return {
    enabled: Number(module.enabled) === 1,
    separateAxes: Number(module.separateAxis ?? module.separateAxes ?? 0) === 1,
    dampen: Number(module.dampen ?? 0),
    drag: { minMaxState: Number(drag.minMaxState ?? 0), scalar: Number(drag.scalar ?? 0) },
    animatedVelocity: ['VelocityModule', 'NoiseModule'].some((key) => Number(particle[key]?.enabled) === 1),
    speedModifier: { minMaxState: Number(speed.minMaxState ?? 0), scalar: Number(speed.scalar ?? 1) },
  };
}

function unsupportedLimitVelocityReasons(spec) {
  const reasons = spec.drag.minMaxState !== 0 || spec.drag.scalar !== 0 ? ['drag'] : [];
  if (spec.speedModifier && (spec.speedModifier.minMaxState !== 0 || spec.speedModifier.scalar !== 1)) reasons.push('speed-modifier');
  return reasons;
}

function stageLimitVelocityRuntime(options) {
  if (options.dryRun) return;
  for (const name of names) {
    const target = path.join(options.cocosRoot, 'assets/script', `${name}.ts`);
    const text = fs.readFileSync(path.join(__dirname, 'runtime', `${name}.ts`), 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text);
    // AssetDB owns .meta creation and UUIDs. A first import needs a refresh
    // and another porter pass; never fabricate a script UUID here.
  }
}

function attachLimitVelocityRuntime(builder, reporter, options) {
  const particles = builder.objects.map((p, id) => ({ p, id })).filter(({ p }) => p?.unityLimitVelocityContract?.enabled);
  if (!particles.length) return;
  stageLimitVelocityRuntime(options);
  let classId = builder.cocosDb?.findScriptClass?.('UnityParticleLimitVelocityAdapter')?.classId;
  const meta = path.join(options.cocosRoot, 'assets/script/UnityParticleLimitVelocityAdapter.ts.meta');
  if (!classId && fs.existsSync(meta)) classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid);
  for (const { p, id } of particles) {
    const name = builder.objects[p.node.__id__]?._name || '';
    const reasons = unsupportedLimitVelocityReasons(p.unityLimitVelocityContract);
    if (reasons.length) {
      reporter.high('PARTICLE_LIMIT_VELOCITY_ADAPTER_REQUIRED', options.src || '', name,
        `Unity Limit Velocity ${reasons.join(', ')} is not ported; only the measured dampen and animated-velocity composition are bound.`);
    }
    if (!classId) {
      reporter.high('PARTICLE_LIMIT_VELOCITY_ADAPTER_REQUIRED', options.src || '', name,
        'AssetDB must import assets/script/UnityParticleLimitVelocityAdapter.ts; refresh and rerun porter.');
      continue;
    }
    builder.addComponent(p.node.__id__, classId, { source: { __id__: id } }, null, `cmp-unity-limit-velocity-${id}`);
    reporter.low('PARTICLE_LIMIT_VELOCITY_ADAPTER_BOUND', options.src || '', name,
      'Unity frame-rate independent Limit Velocity dampen and animated-velocity composition attached; live visual acceptance still required.');
  }
}

module.exports = { LIMIT_VELOCITY_COMPOSITION, particleLimitVelocityContract, unsupportedLimitVelocityReasons, stageLimitVelocityRuntime, attachLimitVelocityRuntime };
