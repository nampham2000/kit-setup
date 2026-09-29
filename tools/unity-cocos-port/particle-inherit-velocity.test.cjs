'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), test = require('node:test'), assert = require('node:assert/strict'), ts = require('typescript');
const native = require('./fixtures/inherit-velocity-native.json');
const { particleInheritVelocityContract, attachInheritVelocityRuntime } = require('./particle-inherit-velocity-binding');

class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  static set(o, x, y, z) { o.x = x; o.y = y; o.z = z; return o; }
  static subtract(o, a, b) { o.x = a.x - b.x; o.y = a.y - b.y; o.z = a.z - b.z; return o; }
  static multiplyScalar(o, a, s) { o.x = a.x * s; o.y = a.y * s; o.z = a.z * s; return o; }
  static scaleAndAdd(o, a, b, s) { o.x = a.x + b.x * s; o.y = a.y + b.y * s; o.z = a.z + b.z * s; return o; }
}
const runtime = {};
new Function('exports', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'runtime/UnityParticleInheritVelocity.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText)(runtime, () => ({ Vec3, ParticleSystem: class {} }));
const byName = name => native.cases.find(c => c.name === name);
const close = (a, b, eps = 1e-4) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test('native fixture binds its Unity producer', () => {
  const producer = fs.readFileSync(path.join(__dirname, 'fixtures/capture-inherit-velocity.cs'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(producer).digest('hex'), native.sourceProbeSha256);
});

test('Unity: Initial constant adds k * emitter velocity to the base velocity; Local simulation is unaffected', () => {
  for (const [name, k] of [['initial-constant', 0.5], ['initial-negative', -0.1]]) {
    const c = byName(name), expected = c.emitterVelocity.map(v => v * k);
    for (const frame of c.frames) for (const p of frame.particles) {
      assert.ok(close(p.velocity, expected), `${name} step ${frame.step}: ${p.velocity} vs ${expected}`);
      assert.ok(close(p.animatedVelocity, [0, 0, 0]), `${name} keeps animated velocity zero`);
    }
  }
  for (const frame of byName('initial-local').frames) for (const p of frame.particles) assert.ok(close(p.velocity, [0, 0, 0]) && close(p.animatedVelocity, [0, 0, 0]));
  // Documented, not bound: Current writes animated velocity; curves evaluate at normalized age in both modes.
  for (const frame of byName('current-constant').frames) for (const p of frame.particles) assert.ok(close(p.animatedVelocity, [1.5, 0, 2]) && close(p.velocity, [0, 0, 0]));
  const ramp = byName('initial-ramp'), rampCurrent = byName('current-ramp');
  ramp.frames.forEach((frame, i) => frame.particles.forEach((p, j) => assert.ok(close(p.animatedVelocity, rampCurrent.frames[i].particles[j].animatedVelocity, 1e-6), 'curve Initial == curve Current')));
});

test('runtime reproduces the native Initial velocity through the Z reflection', () => {
  for (const [name, k] of [['initial-constant', 0.5], ['initial-negative', -0.1]]) {
    const c = byName(name), dt = c.dt, unityV = c.emitterVelocity;
    // Cocos world = Unity world with Z reflected.
    const position = new Vec3();
    const node = { getWorldPosition(out) { return out.set(position); } };
    const processor = { setNewParticle() {} };
    const system = { node, processor };
    const inherit = new runtime.UnityParticleInheritVelocity(system, k);
    inherit.track();
    for (let step = 1; step <= 3; step++) {
      position.x += unityV[0] * dt; position.y += unityV[1] * dt; position.z += -unityV[2] * dt;
      inherit.frameDelta = dt;
      const particle = { velocity: new Vec3(), ultimateVelocity: new Vec3() };
      processor.setNewParticle(particle);
      const unity = [particle.velocity.x, particle.velocity.y, -particle.velocity.z];
      const nativeParticle = c.frames.find(f => f.particles.length).particles[0];
      assert.ok(close(unity, nativeParticle.velocity), `${name} step ${step}: ${unity} vs ${nativeParticle.velocity}`);
      assert.ok(close([particle.ultimateVelocity.x, particle.ultimateVelocity.y, particle.ultimateVelocity.z], [particle.velocity.x, particle.velocity.y, particle.velocity.z]));
      inherit.track();
    }
    inherit.destroy();
  }
});

test('contract: World Initial constant binds, Local is a no-op, Current and curves are reported', () => {
  const doc = (space, mode, minMaxState, scalar) => ({ moveWithTransform: space, InheritVelocityModule: { enabled: 1, m_Mode: mode, m_Curve: { minMaxState, scalar } } });
  assert.equal(particleInheritVelocityContract(doc(1, 0, 0, -0.1)).bindable, true);
  assert.equal(particleInheritVelocityContract(doc(0, 0, 0, 0.5)).noop, true);
  for (const spec of [doc(1, 1, 0, 0.5), doc(1, 0, 3, 1)].map(particleInheritVelocityContract)) assert.ok(!spec.bindable && !spec.noop);
  const events = [];
  const reporter = { low: c => events.push(c), medium: c => events.push(c), high: c => events.push(c) };
  const objects = [{ __type__: 'cc.Node', _name: 'n', _components: [] }];
  for (const d of [doc(0, 0, 0, 0.5), doc(1, 1, 0, 0.5)]) {
    const p = { __type__: 'cc.ParticleSystem', node: { __id__: 0 } };
    Object.defineProperty(p, 'unityInheritVelocityContract', { value: particleInheritVelocityContract(d) });
    objects.push(p);
  }
  attachInheritVelocityRuntime({ objects, cocosDb: null, addComponent() { throw new Error('must not bind'); } }, reporter, { cocosRoot: '.', dryRun: true });
  assert.deepEqual(events, ['PARTICLE_INHERIT_VELOCITY_NOOP', 'PARTICLE_INHERIT_VELOCITY_UNSUPPORTED']);
});
