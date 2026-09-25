'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityParticleLimitVelocity', 'UnityParticleLimitVelocityAdapter'];

// Source state the Cocos module cannot hold. Unity serializes this module's
// flag as `separateAxis`; drag is not mapped by the converter.
function particleLimitVelocityContract(particle = {}) {
  const module = particle.ClampVelocityModule || {};
  const drag = module.drag && typeof module.drag === 'object' ? module.drag : {};
  return {
    enabled: Number(module.enabled) === 1,
    separateAxes: Number(module.separateAxis ?? module.separateAxes ?? 0) === 1,
    dampen: Number(module.dampen ?? 0),
    drag: { minMaxState: Number(drag.minMaxState ?? 0), scalar: Number(drag.scalar ?? 0) },
    animatedVelocity: ['VelocityModule', 'NoiseModule'].some((key) => Number(particle[key]?.enabled) === 1),
  };
}

function unsupportedLimitVelocityReasons(spec) {
  return spec.drag.minMaxState !== 0 || spec.drag.scalar !== 0 ? ['drag'] : [];
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
        `Unity Limit Velocity ${reasons.join(', ')} is not ported; only the measured dampen rule is bound.`);
    }
    if (!classId) {
      reporter.high('PARTICLE_LIMIT_VELOCITY_ADAPTER_REQUIRED', options.src || '', name,
        'AssetDB must import assets/script/UnityParticleLimitVelocityAdapter.ts; refresh and rerun porter.');
      continue;
    }
    builder.addComponent(p.node.__id__, classId, { source: { __id__: id } }, null, `cmp-unity-limit-velocity-${id}`);
    if (p.unityLimitVelocityContract.animatedVelocity) {
      reporter.medium('PARTICLE_LIMIT_VELOCITY_COMPOSITION_UNMEASURED', options.src || '', name,
        'Velocity/Noise animated velocity keeps the Cocos composition with the limit; only the dampen rule is measured.');
    }
    reporter.low('PARTICLE_LIMIT_VELOCITY_ADAPTER_BOUND', options.src || '', name,
      'Unity frame-rate independent Limit Velocity dampen attached; live visual acceptance still required.');
  }
}

module.exports = { particleLimitVelocityContract, unsupportedLimitVelocityReasons, stageLimitVelocityRuntime, attachLimitVelocityRuntime };
