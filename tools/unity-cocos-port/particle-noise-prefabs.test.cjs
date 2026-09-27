'use strict';
// ARPG emitters whose Noise was not accepted before: BlowingLeaves (Medium, rotationAmount
// curve, Mesh with 3D rotation) and LevelUp Spikes (Low quality with Limit Velocity).
// Native oracle fixtures/particle-noise-prefabs-native.json (capture-noise-prefabs.cs):
// matched births of the source prefabs with their serialized Noise/Limit modules; velocity
// over lifetime, rotation over lifetime and gravity are switched off in memory so the
// replay isolates Noise. Source contracts come from the prefab YAML through the porter's
// own parsers and are bound to the prefab SHA-256.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), ts = require('typescript');
const { LIMIT_VELOCITY_COMPOSITION } = require('./particle-limit-velocity-binding');
const { unsupportedNoiseReasons } = require('./particle-noise-binding');
function compile(name, deps = {}) {
  const m = { exports: {} };
  new Function('exports', 'module', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'runtime', name + '.ts'), 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText)(m.exports, m, k => deps[k] || {});
  return m.exports;
}
const kernel = compile('UnityNoiseKernel'), limitRuntime = compile('UnityParticleLimitVelocity');
const noise = compile('UnityParticleNoise', { './UnityNoiseKernel': kernel, './UnityParticleLimitVelocity': limitRuntime });
const fixture = require('./fixtures/particle-noise-prefabs-native.json');
const vec = (x = 0, y = 0, z = 0) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } });
const D = Math.PI / 180;
const composition = LIMIT_VELOCITY_COMPOSITION === 'animated-velocity-before-limit';

test('native prefab fixture binds its portable capture producer', () => {
  const producer = fs.readFileSync(path.join(__dirname, 'fixtures/capture-noise-prefabs.cs'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(producer).digest('hex'), fixture.sourceProbeSha256);
});
function dampenBeyondLimit(value, limit, dampen) { const sign = Math.sign(value); let abs = Math.abs(value); if (abs > limit) { const give = abs - abs * dampen; abs = give > limit ? give : limit; } return abs * sign; }
function replay(prefab) {
  const { source } = prefab, list = [], noiseModule = {};
  let limit = null;
  if (source.limit.enabled) {
    // Stock Cocos 3.8.8 magnitude limit; the shared runtime wraps it.
    limit = { enable: true, dampen: source.limit.dampen, animate(p) { const u = p.ultimateVelocity, l = Math.hypot(u.x, u.y, u.z), s = l > 0 ? dampenBeyondLimit(l, source.limit.magnitude.scalar, this.dampen) / l : 0; u.set(u.x * s, u.y * s, u.z * s); p.velocity.set(u.x, u.y, u.z); } };
    list.push(limit); limitRuntime.installUnityParticleLimitVelocity({ limitVelocityOvertimeModule: limit });
  }
  list.push(noiseModule);
  const particles = prefab.births.map(b => ({ seed: b.seed, position: vec(b.position[0], b.position[1], -b.position[2]), velocity: vec(b.velocity[0], b.velocity[1], -b.velocity[2]),
    animatedVelocity: vec(), ultimateVelocity: vec(), startEuler: vec(...b.rotation3D.map((v, i) => source.eulerSigns[i] * v * D)), rotation: vec(...b.rotation3D.map((v, i) => source.eulerSigns[i] * v * D)),
    startLifetime: b.startLifetime, remainingLifetime: b.remainingLifetime, randomSeed: b.seed }));
  const system = { processor: { _runAnimateList: list, _particles: particles, enableModule() {}, updateParticles(dt) {
    for (const p of particles) {
      if (p.dead) continue;
      p.remainingLifetime -= dt; p.animatedVelocity.set(0, 0, 0);
      if (p.remainingLifetime < 0) { p.dead = true; continue; }
      p.ultimateVelocity.set(p.velocity.x, p.velocity.y, p.velocity.z);
      for (const m of list) m.animate(p, dt);
      p.position.set(p.position.x + p.ultimateVelocity.x * dt, p.position.y + p.ultimateVelocity.y * dt, p.position.z + p.ultimateVelocity.z * dt);
    }
  } }, time: 0, duration: 5, noiseModule, limitVelocityOvertimeModule: limit, rotationOvertimeModule: null };
  noise.installUnityParticleNoise(system, { ...source.noise, rotationSigns: source.eulerSigns }, prefab.seed);
  let position = 0, rotation = 0, compared = 0;
  for (let step = 1; step <= Math.max(...prefab.rows.map(r => r.step)); step++) {
    system.processor.updateParticles(prefab.delta); system.time += prefab.delta;
    const row = prefab.rows.find(r => r.step === step); if (!row) continue;
    for (const n of row.particles) {
      const p = particles.find(p => p.seed === n.seed); if (!p || p.dead) continue;
      position = Math.max(position, Math.hypot(p.position.x - n.position[0], p.position.y - n.position[1], -p.position.z - n.position[2]));
      const e = [p.startEuler.x, p.startEuler.y, p.startEuler.z].map((v, i) => source.eulerSigns[i] * v / D);
      if (source.noise.rotation3D) rotation = Math.max(rotation, ...e.map((v, i) => Math.abs(v - n.rotation3D[i])));
      compared++;
    }
  }
  return { position, rotation, compared };
}
test('native BlowingLeaves: Medium position noise and rotationAmount curve follow Unity (Mesh, 3D rotation)', () => {
  const prefab = fixture.prefabs.find(p => p.node === 'BlowingLeaves');
  assert.equal(prefab.source.noise.quality, 1); assert.equal(prefab.source.noise.rotationAmount.minMaxState, 1); assert.equal(prefab.source.noise.rotation3D, true);
  assert.deepEqual(prefab.source.eulerSigns, [-1, -1, 1]);
  assert.deepEqual(unsupportedNoiseReasons(prefab.source.noise, false), []);
  const result = replay(prefab);
  assert.ok(result.compared > 100, `${result.compared} samples`);
  assert.ok(result.position < 2e-4, `position error ${result.position}`);
  assert.ok(result.rotation < 5e-3, `rotation error ${result.rotation} degrees`);
  // Native rotation noise drift after 0.8 s (up to 0.75 degrees) must dwarf the tolerance.
  const drift = Math.max(...prefab.rows.at(-1).particles.map(n => { const birth = prefab.births.find(b => b.seed === n.seed); return Math.max(...n.rotation3D.map((v, i) => Math.abs(v - birth.rotation3D[i]))); }));
  assert.ok(drift > 100 * 5e-3, `native drift ${drift} degrees`);
});
test('native LevelUp Spikes: Low noise composed with Limit Velocity (needs the limit composition runtime)', () => {
  const prefab = fixture.prefabs.find(p => p.node === 'Spikes');
  assert.equal(prefab.source.noise.quality, 0); assert.equal(prefab.source.limit.enabled, true);
  if (!composition) {
    // Without the composition runtime the porter keeps reporting the gap and the runtime refuses.
    assert.ok(unsupportedNoiseReasons(prefab.source.noise, true).includes('velocity-limit-integration'));
    assert.throws(() => replay(prefab), /composition/);
    return;
  }
  assert.deepEqual(unsupportedNoiseReasons(prefab.source.noise, true), []);
  const result = replay(prefab);
  assert.ok(result.compared > 100, `${result.compared} samples`);
  assert.ok(result.position < 2e-4, `position error ${result.position}`);
});
