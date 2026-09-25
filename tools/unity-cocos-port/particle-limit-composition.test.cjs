'use strict';
// Unity Limit Velocity composed with animated velocity (Velocity over Lifetime linear,
// orbital, radial and Noise). Native oracles: fixtures/velocity-limit-composition-native.json
// (20 single-particle cases) and fixtures/limit-composition-prefabs-native.json (matched
// births of ARPG OrbConsume Particles, IdentifyChannel ChannelDust and PortalBlueOpen Dots).
// The shipped runtimes run on a mock of the Cocos 3.8.8 CPU processor (particle-system-
// renderer-cpu.ts updateParticles) with stock force/velocity/limit modules.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), ts = require('typescript');
const native = require('./fixtures/velocity-limit-composition-native.json');
const prefabs = require('./fixtures/limit-composition-prefabs-native.json');
const { unsupportedOrbitReasons } = require('./particle-orbit-binding');
const { particleLimitVelocityContract, unsupportedLimitVelocityReasons, LIMIT_VELOCITY_COMPOSITION } = require('./particle-limit-velocity-binding');

// Minimal 'cc' for the world-space orbit path: column-major Mat4 and Vec3.transformMat4.
const KEYS = Array.from({ length: 16 }, (_, i) => 'm' + String(i).padStart(2, '0'));
function invert(a) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  return [(a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det, (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det, (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det, (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det];
}
class Mat4 { constructor() { KEYS.forEach((k, i) => { this[k] = i % 5 === 0 ? 1 : 0; }); }
  static copy(out, a) { for (const k of KEYS) out[k] = a[k]; return out; }
  static invert(out, a) { const m = invert(KEYS.map(k => a[k])); KEYS.forEach((k, i) => { out[k] = m[i]; }); return out; } }
class Vec3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  static transformMat4(out, a, m) { const { x, y, z } = a; out.x = m.m00 * x + m.m04 * y + m.m08 * z + m.m12; out.y = m.m01 * x + m.m05 * y + m.m09 * z + m.m13; out.z = m.m02 * x + m.m06 * y + m.m10 * z + m.m14; return out; } }
function compile(name, deps = {}) {
  const m = { exports: {} };
  new Function('exports', 'module', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'runtime', name + '.ts'), 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText)(m.exports, m, k => deps[k] || {});
  return m.exports;
}
const cc = { Mat4, Vec3 };
const kernel = compile('UnityNoiseKernel'), limitRuntime = compile('UnityParticleLimitVelocity', { cc });
const orbitRuntime = compile('UnityParticleOrbit', { cc, './UnityNoiseKernel': kernel, './UnityParticleLimitVelocity': limitRuntime });
const noiseRuntime = compile('UnityParticleNoise', { cc, './UnityNoiseKernel': kernel });

const vec = (x = 0, y = 0, z = 0) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } });
const constant = scalar => ({ minMaxState: 0, scalar });
// Stock Cocos 3.8.8 limit-velocity-overtime.ts (constant limits) and force/velocity modules.
function dampenBeyondLimit(value, limit, dampen) { const sign = Math.sign(value); let abs = Math.abs(value); if (abs > limit) { const give = abs - abs * dampen; abs = give > limit ? give : limit; } return abs * sign; }
function stockLimit({ separate, limit, axes, dampen }) {
  return { dampen, separateAxes: separate, animate(p) {
    const u = p.ultimateVelocity; let x, y, z;
    if (this.separateAxes) { x = dampenBeyondLimit(u.x, axes[0], this.dampen); y = dampenBeyondLimit(u.y, axes[1], this.dampen); z = dampenBeyondLimit(u.z, axes[2], this.dampen); }
    else { const length = Math.hypot(u.x, u.y, u.z), s = length > 0 ? dampenBeyondLimit(length, limit, this.dampen) / length : 0; x = u.x * s; y = u.y * s; z = u.z * s; }
    u.set(x, y, z); p.velocity.set(x, y, z);
  } };
}
const stockForce = fy => ({ animate(p, dt) { p.velocity.y += fy * dt; p.ultimateVelocity.set(p.velocity.x, p.velocity.y, p.velocity.z); } });
// Converter: Unity linear z is negated; speed modifier multiplies the total in Cocos.
const stockVelocity = (linear, speed) => ({ animate(p) {
  const a = p.animatedVelocity; a.set(a.x + linear[0], a.y + linear[1], a.z - linear[2]);
  p.ultimateVelocity.set((p.velocity.x + a.x) * speed, (p.velocity.y + a.y) * speed, (p.velocity.z + a.z) * speed);
} });
// Cocos world matrix of a Unity TRS reflected through Z (quaternion x/y flip).
function cocosWorldMatrix(position, euler, scale) {
  const h = euler.map(v => v * Math.PI / 360), [sx, sy, sz] = h.map(Math.sin), [cx, cy, cz] = h.map(Math.cos);
  const q = [-(sx * cy * cz + cx * sy * sz), -(cx * sy * cz - sx * cy * sz), cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz];
  const [x, y, z, w] = q, m = new Mat4();
  const r = [[1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)], [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)], [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]];
  for (let c = 0; c < 3; c++) for (let row = 0; row < 3; row++) m[KEYS[c * 4 + row]] = r[c][row] * scale;
  m.m12 = position[0]; m.m13 = position[1]; m.m14 = -position[2];
  return m;
}
// Particle-system mock: the processor loop of particle-system-renderer-cpu.ts updateParticles.
function makeSystem(simulationSpace, worldMatrix) {
  const list = [], particles = [];
  const processor = { _runAnimateList: list, _particles: particles, enableModule() {},
    updateParticles(dt) {
      for (const p of particles) {
        if (p.dead) continue;
        p.remainingLifetime -= dt; p.animatedVelocity.set(0, 0, 0);
        if (p.remainingLifetime < 0) { p.dead = true; continue; }
        p.ultimateVelocity.set(p.velocity.x, p.velocity.y, p.velocity.z);
        for (const m of list) m.animate(p, dt);
        p.position.set(p.position.x + p.ultimateVelocity.x * dt, p.position.y + p.ultimateVelocity.y * dt, p.position.z + p.ultimateVelocity.z * dt);
      }
      return particles.length;
    } };
  const node = { worldMatrix: worldMatrix || new Mat4(), getWorldMatrix(out) { return Mat4.copy(out, this.worldMatrix); } };
  return { processor, node, time: 0, duration: 5, simulationSpace, velocityOvertimeModule: {}, limitVelocityOvertimeModule: {}, noiseModule: {}, list, particles };
}
function cocosParticle(position, velocity, remaining, start, randomSeed) {
  return { position: vec(position[0], position[1], -position[2]), velocity: vec(velocity[0], velocity[1], -velocity[2]),
    animatedVelocity: vec(), ultimateVelocity: vec(), remainingLifetime: remaining, startLifetime: start, randomSeed };
}
const toUnity = v => [v.x, v.y, -v.z];
const noiseSpec = c => ({ version: 1, enabled: true, quality: c.noiseQuality, separateAxes: false, autoRandomSeed: false, randomSeed: c.seed,
  frequency: c.noiseFrequency, damping: c.noiseDamping, octaves: 1, octaveMultiplier: 0.5, octaveScale: 2,
  strength: constant(c.noiseStrength), strengthY: constant(c.noiseStrength), strengthZ: constant(c.noiseStrength),
  scrollSpeed: constant(0), positionAmount: constant(1), rotationAmount: constant(0), sizeAmount: constant(0), remapEnabled: false });
const orbitSpec = c => ({ enabled: true, simulationSpace: c.local ? 0 : 1, scalingMode: 0, inWorldSpace: false, limitEnabled: c.limit, noiseEnabled: c.noise,
  velocity: { x: constant(c.linear[0]), y: constant(c.linear[1]), z: constant(c.linear[2]), orbitalX: constant(c.orbital[0]), orbitalY: constant(c.orbital[1]), orbitalZ: constant(c.orbital[2]),
    orbitalOffsetX: constant(0), orbitalOffsetY: constant(0), orbitalOffsetZ: constant(0), radial: constant(c.radial), speedModifier: constant(c.speedModifier) } });
// Build the module chain the porter binds for one native case: stock modules in
// PARTICLE_MODULE_ORDER (force, velocity, limit, noise), then the runtimes in
// adapter order (limit on load; orbit/noise on start).
function runNative(c) {
  const orbit = c.orbital.some(v => v !== 0) || c.radial !== 0;
  const system = makeSystem(c.local ? 1 : 0, c.local ? null : cocosWorldMatrix(c.parentPosition || [0, 0, 0], c.parentEuler, c.parentScale));
  if (c.force) system.list.push(stockForce(c.force));
  if (orbit || c.linear.some(v => v !== 0) || c.speedModifier !== 1) { system.velocityOvertimeModule = stockVelocity(c.linear, c.speedModifier); system.list.push(system.velocityOvertimeModule); }
  if (c.limit) { system.limitVelocityOvertimeModule = stockLimit({ separate: c.separate, limit: c.limitValue, axes: c.limitAxes, dampen: c.dampen }); system.list.push(system.limitVelocityOvertimeModule); }
  if (c.noise) system.list.push(system.noiseModule);
  if (c.limit) limitRuntime.installUnityParticleLimitVelocity(system);
  if (orbit) orbitRuntime.installUnityParticleOrbit(system, orbitSpec(c));
  if (c.noise) noiseRuntime.installUnityParticleNoise(system, noiseSpec(c), c.seed);
  const p = cocosParticle(c.position, c.velocity, c.lifetime, c.lifetime, c.seed);
  system.particles.push(p);
  return c.rows.map(() => { system.processor.updateParticles(c.dt); system.time += c.dt; return { position: toUnity(p.position), velocity: toUnity(p.velocity), total: toUnity(p.ultimateVelocity) }; });
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex');

test('native composition fixtures bind their portable capture producers', () => {
  assert.equal(sha('fixtures/capture-velocity-limit-composition.cs'), native.sourceProbeSha256);
  assert.equal(sha('fixtures/capture-limit-composition-prefabs.cs'), prefabs.sourceProbeSha256);
  assert.equal(native.maximumParticleDeltaTime, 0.03, 'captured below the native sub-step so each Simulate is one step');
  assert.equal(LIMIT_VELOCITY_COMPOSITION, 'animated-velocity-before-limit');
});
for (const c of native.cases.filter(c => !(c.limit && c.speedModifier !== 1))) test(`native ${c.name}: shipped runtimes limit stored + animated velocity and store only the non-animated part`, () => {
  const got = runNative(c), noisy = c.noise;
  const tolerance = { position: noisy ? 2e-4 : 2e-5, velocity: noisy ? 2e-3 : 5e-5 };
  c.rows.forEach((row, step) => {
    assert.ok(distance(got[step].position, row.position) < tolerance.position, `${c.name} step ${step} position ${got[step].position} vs ${row.position}`);
    assert.ok(distance(got[step].velocity, row.velocity) < tolerance.velocity, `${c.name} step ${step} stored velocity ${got[step].velocity} vs ${row.velocity}`);
    if (c.speedModifier === 1) assert.ok(distance(got[step].total, row.totalVelocity) < tolerance.velocity, `${c.name} step ${step} total ${got[step].total} vs ${row.totalVelocity}`);
  });
});
test('native radial pull under a limit keeps a small stored velocity; the old copy-total rule diverges', () => {
  const c = native.cases.find(c => c.name === 'radial-limit-60fps');
  // Pre-composition wrapper: stored velocity = limited total, so the radial pull is re-added every step.
  let x = c.position.slice(), v = c.velocity.slice(), worst = 0;
  for (const row of c.rows) {
    const r = Math.hypot(...x), a = x.map(t => t / r * c.radial), t = v.map((vi, i) => vi + a[i]);
    const m = Math.hypot(...t), s = m > c.limitValue ? (c.limitValue + (m - c.limitValue) * Math.pow(1 - c.dampen, 30 * c.dt)) / m : 1;
    v = t.map(ti => ti * s); x = x.map((xi, i) => xi + v[i] * c.dt); worst = Math.max(worst, distance(x, row.position));
  }
  assert.ok(worst > 5e-3, `copying the limited total into the stored velocity must be observably wrong (${worst})`);
  // Unity: the particle moves inward (total) while the stored remainder points outward.
  const last = c.rows.at(-1), dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  assert.ok(dot(last.totalVelocity, last.position) < 0 && dot(last.velocity, last.position) > 0, 'Unity stores only limited - animated');
});
test('Unity applies the speed modifier after the limit; Cocos before it, so the porter keeps it blocking', () => {
  const c = native.cases.find(c => c.name === 'speedmodifier-limit');
  let v = c.velocity[1], y = 0; const keep = Math.pow(1 - c.dampen, 30 * c.dt);
  c.rows.forEach(row => {
    const total = v + c.linear[1], limited = total > c.limitValue ? c.limitValue + (total - c.limitValue) * keep : total;
    v = limited - c.linear[1]; y += limited * c.speedModifier * c.dt;
    assert.ok(Math.abs(row.totalVelocity[1] - limited) < 1e-5 && Math.abs(row.velocity[1] - v) < 1e-5 && Math.abs(row.position[1] - y) < 1e-5);
  });
  assert.throws(() => runNative({ ...c, orbital: [0, 1, 0] }), /speed modifier/);
  const velocity = { enabled: 1, speedModifier: { minMaxState: 0, scalar: 2 } };
  assert.deepEqual(unsupportedLimitVelocityReasons(particleLimitVelocityContract({ ClampVelocityModule: { enabled: 1 }, VelocityModule: velocity })), ['speed-modifier']);
  assert.ok(unsupportedOrbitReasons({ enabled: true, simulationSpace: 0, inWorldSpace: false, limitEnabled: true, velocity: { speedModifier: velocity.speedModifier } }).includes('velocity-limit-speed-modifier'));
});
function stockLimitFromSource(limit) {
  assert.equal(limit.separateAxes, false); assert.equal(limit.magnitude.minMaxState, 0);
  return stockLimit({ separate: false, limit: limit.magnitude.scalar, axes: [0, 0, 0], dampen: limit.dampen });
}
for (const prefab of prefabs.prefabs) test(`native ARPG ${prefab.node}: matched births follow Unity with the source contracts`, () => {
  const { source } = prefab;
  assert.equal(source.limit.enabled, true);
  const system = makeSystem(prefab.simulationSpace === 0 ? 1 : 0);
  if (source.orbit.enabled) { system.velocityOvertimeModule = stockVelocity([0, 0, 0], 1); system.list.push(system.velocityOvertimeModule); }
  system.limitVelocityOvertimeModule = stockLimitFromSource(source.limit); system.list.push(system.limitVelocityOvertimeModule);
  if (source.noise.enabled) system.list.push(system.noiseModule);
  limitRuntime.installUnityParticleLimitVelocity(system);
  if (source.orbit.enabled) {
    assert.deepEqual(unsupportedOrbitReasons(source.orbit), [], 'the porter now binds the source orbit with its limit');
    orbitRuntime.installUnityParticleOrbit(system, source.orbit);
  }
  if (source.noise.enabled) noiseRuntime.installUnityParticleNoise(system, source.noise, prefab.seed);
  for (const b of prefab.births) system.particles.push(cocosParticle(b.position, b.velocity, b.remainingLifetime, b.startLifetime, b.seed));
  let worst = 0, compared = 0;
  for (let step = 1; step <= Math.max(...prefab.rows.map(r => r.step)); step++) {
    system.processor.updateParticles(prefab.delta); system.time += prefab.delta;
    const row = prefab.rows.find(r => r.step === step); if (!row) continue;
    for (const n of row.particles) {
      const p = system.particles[prefab.births.findIndex(b => b.seed === n.seed)];
      if (!p || p.dead) continue;
      worst = Math.max(worst, distance(toUnity(p.position), n.position)); compared++;
    }
  }
  assert.ok(compared > 100, `compared ${compared} native samples`);
  assert.ok(worst < (source.noise.enabled ? 2e-4 : 2e-5), `${prefab.node} worst position error ${worst}`);
});
