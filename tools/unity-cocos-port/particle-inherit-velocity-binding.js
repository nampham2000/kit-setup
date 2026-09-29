'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compressUuid } = require('./core-utils');
const names = ['UnityParticleInheritVelocity', 'UnityParticleInheritVelocityAdapter'];

// Unity InheritVelocityModule (fixtures/inherit-velocity-native.json, Unity 6000.3.1f1).
// Cocos 3.8.8 has no such module, so it used to be dropped silently. Measured:
// - Local simulation: no effect (no runtime needed).
// - World, Initial, constant k: base velocity += k * emitter velocity at birth (bound here).
// - Current constant, and any curve (both modes then behave alike: animated velocity =
//   curve(normalized age) * emitter velocity): not bound yet, reported high.
function particleInheritVelocityContract(particle = {}) {
  const module = particle.InheritVelocityModule || {};
  const curve = module.m_Curve || {};
  const enabled = Number(module.enabled) === 1;
  const world = Number(particle.moveWithTransform) === 1;
  const mode = Number(module.m_Mode || 0);
  const constant = Number(curve.minMaxState || 0) === 0;
  const multiplier = Number(curve.scalar || 0);
  return {
    enabled,
    world,
    mode,
    constant,
    multiplier,
    bindable: enabled && world && mode === 0 && constant && multiplier !== 0,
    noop: !enabled || !world || (constant && multiplier === 0),
  };
}

function stageInheritVelocityRuntime(options) {
  if (options.dryRun) return;
  for (const name of names) {
    const target = path.join(options.cocosRoot, 'assets/script', `${name}.ts`);
    const text = fs.readFileSync(path.join(__dirname, 'runtime', `${name}.ts`), 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // AssetDB owns .meta creation and UUIDs; a first import needs a refresh and another porter pass.
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text);
  }
}

function attachInheritVelocityRuntime(builder, reporter, options) {
  const particles = builder.objects.map((p, id) => ({ p, id }))
    .filter(({ p }) => p?.__type__ === 'cc.ParticleSystem' && p.unityInheritVelocityContract?.enabled);
  if (!particles.length) return;
  let classId = '';
  let bound = 0;
  for (const { p, id } of particles) {
    const spec = p.unityInheritVelocityContract;
    const name = builder.objects[p.node.__id__]?._name || '';
    if (spec.noop) {
      reporter.low('PARTICLE_INHERIT_VELOCITY_NOOP', options.src || '', name,
        'Unity InheritVelocity has no effect in Local simulation (or with a zero multiplier); nothing to bind.');
      continue;
    }
    if (!spec.bindable) {
      reporter.high('PARTICLE_INHERIT_VELOCITY_UNSUPPORTED', options.src || '', name,
        `Unity InheritVelocity ${spec.mode === 1 ? 'Current' : 'Initial'} mode with a ${spec.constant ? 'constant' : 'curve'} multiplier is not bound; particles lose the emitter velocity.`);
      continue;
    }
    if (!classId) {
      stageInheritVelocityRuntime(options);
      classId = builder.cocosDb?.findScriptClass?.('UnityParticleInheritVelocityAdapter')?.classId || '';
      const meta = path.join(options.cocosRoot, 'assets/script/UnityParticleInheritVelocityAdapter.ts.meta');
      if (!classId && fs.existsSync(meta)) { try { classId = compressUuid(JSON.parse(fs.readFileSync(meta, 'utf8')).uuid); } catch { classId = ''; } }
    }
    if (!classId) {
      reporter.high('PARTICLE_INHERIT_VELOCITY_ADAPTER_REQUIRED', options.src || '', name,
        'AssetDB must import assets/script/UnityParticleInheritVelocityAdapter.ts; refresh and rerun porter.');
      continue;
    }
    builder.addComponent(p.node.__id__, classId, { source: { __id__: id }, multiplier: spec.multiplier },
      null, `cmp-unity-inherit-velocity-${id}`);
    bound++;
  }
  if (bound) {
    reporter.low('PARTICLE_INHERIT_VELOCITY_BOUND', options.src || '', `${bound} system(s)`,
      'Unity InheritVelocity (Initial, constant) adds multiplier * emitter velocity at birth; live visual acceptance still required.');
  }
}

module.exports = { particleInheritVelocityContract, stageInheritVelocityRuntime, attachInheritVelocityRuntime };
