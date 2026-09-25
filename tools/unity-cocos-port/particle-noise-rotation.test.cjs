'use strict';
// Unity Noise rotationAmount. Native oracle fixtures/particle-noise-rotation-native.json
// (capture-noise-rotation.cs): rotation3D (degrees) grows by
//   0.5 * field * strength * rotationAmount * dt   on each axis (2D rotation: Z only),
// sampled at the start-of-step age and position, independent of positionAmount, added
// to rotation over lifetime. The shipped Noise runtime writes it into the Cocos Euler
// accumulator with the renderer's Z-reflection signs.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), ts = require('typescript');
function compile(name, deps = {}) {
  const m = { exports: {} };
  new Function('exports', 'module', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'runtime', name + '.ts'), 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText)(m.exports, m, k => deps[k] || {});
  return m.exports;
}
const kernel = compile('UnityNoiseKernel'), euler = compile('UnityParticleEulerRotation');
const noise = compile('UnityParticleNoise', { './UnityNoiseKernel': kernel });
const fixture = require('./fixtures/particle-noise-rotation-native.json');
const prefabs = require('./fixtures/particle-noise-prefabs-native.json');
const constant = scalar => ({ minMaxState: 0, scalar });
const vec = (x = 0, y = 0, z = 0) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } });
const D = Math.PI / 180;

test('native rotation fixture binds its portable capture producer', () => {
  const producer = fs.readFileSync(path.join(__dirname, 'fixtures/capture-noise-rotation.cs'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(producer).digest('hex'), fixture.sourceProbeSha256);
});
// Mesh renderers map Unity Euler to Cocos (-X,-Y,+Z); camera billboards reflect Z.
function run(c, { strength = [c.strength, c.strength, c.strength], separateAxes = false } = {}) {
  const signs = c.rotation3D ? [-1, -1, 1] : [-1, 1, -1];
  const spec = { version: 1, enabled: true, quality: c.quality, separateAxes, autoRandomSeed: false, randomSeed: 1,
    frequency: c.frequency, damping: c.damping, octaves: 1, octaveMultiplier: 0.5, octaveScale: 2,
    strength: constant(strength[0]), strengthY: constant(strength[1]), strengthZ: constant(strength[2]), scrollSpeed: constant(0), positionAmount: constant(c.positionAmount),
    rotationAmount: c.rotationCurve ? { minMaxState: 1, scalar: c.rotationAmount, maxCurve: { m_Curve: [{ time: 0, value: 0, inSlope: 1, outSlope: 1 }, { time: 1, value: 1, inSlope: 1, outSlope: 1 }] } } : constant(c.rotationAmount),
    sizeAmount: constant(0), remapEnabled: false, rotation3D: c.rotation3D, rotationSigns: signs };
  const list = [], noiseModule = {};
  const hasRotation = c.angularOverLifetime.some(v => v !== 0);
  // Cocos converter: rotation-over-lifetime curves carry the renderer Euler signs (radians).
  const curve = value => ({ evaluate: () => value });
  const rotationModule = hasRotation ? { enable: true, separateAxes: true, x: curve(signs[0] * c.angularOverLifetime[0] * D), y: curve(signs[1] * c.angularOverLifetime[1] * D), z: curve(signs[2] * c.angularOverLifetime[2] * D) } : null;
  // PARTICLE_MODULE_ORDER puts rotation before noise; the runtime must move noise ahead of it.
  if (rotationModule) list.push(rotationModule);
  list.push(noiseModule);
  const system = { processor: { _runAnimateList: list, _particles: { length: 1 }, enableModule() {}, updateParticles() {} }, time: 0, duration: 5,
    noiseModule, rotationOvertimeModule: rotationModule, limitVelocityOvertimeModule: null };
  if (rotationModule) assert.equal(euler.installUnityParticleEulerRotation(system), true);
  noise.installUnityParticleNoise(system, spec, 1);
  assert.equal(list.indexOf(noiseModule), 0, 'noise animates before the rotation packer');
  const start = c.rotation3D ? c.startRotation : [0, 0, c.startRotation[2]];
  const p = { position: vec(c.position[0], c.position[1], -c.position[2]), velocity: vec(), animatedVelocity: vec(), ultimateVelocity: vec(),
    startEuler: vec(...start.map((v, i) => signs[i] * v * D)), rotation: vec(...start.map((v, i) => signs[i] * v * D)),
    startLifetime: c.lifetime, remainingLifetime: c.remaining, randomSeed: 1 };
  return c.rows.map(() => {
    p.remainingLifetime -= c.dt; p.animatedVelocity.set(0, 0, 0); p.ultimateVelocity.set(p.velocity.x, p.velocity.y, p.velocity.z);
    for (const m of list) m.animate(p, c.dt);
    p.position.set(p.position.x + p.ultimateVelocity.x * c.dt, p.position.y + p.ultimateVelocity.y * c.dt, p.position.z + p.ultimateVelocity.z * c.dt);
    const e = p.startEuler;
    if (!rotationModule) assert.deepEqual([p.rotation.x, p.rotation.y, p.rotation.z], [e.x, e.y, e.z], 'Euler ABI without rotation over lifetime');
    return [e.x, e.y, e.z].map((v, i) => signs[i] * v / D);
  });
}
for (const c of fixture.cases.filter(c => c.name !== '3d-size-amount')) test(`native ${c.name}: Noise rotation accumulates in the Unity Euler angles`, () => {
  const got = run(c);
  c.rows.forEach((row, step) => {
    const want = c.rotation3D ? row.rotation3D : [0, 0, row.rotation];
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(got[step][i] - want[i]) < 2e-3, `${c.name} step ${step} axis ${i}: ${got[step][i]} vs ${want[i]}`);
  });
});
test('rotation uses the separate-axis strengths, like position', () => {
  const s = prefabs.separateAxesRotation;
  const c = { ...fixture.cases.find(c => c.name === '3d-rotation'), position: s.position, startRotation: s.startRotation, rotationAmount: s.rotationAmount, rows: [{}] };
  const got = run(c, { strength: s.strength, separateAxes: true })[0];
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(got[i] - s.rotation3D[i]) < 2e-3, `axis ${i}: ${got[i]} vs ${s.rotation3D[i]}`);
});
test('random rotation amount, missing renderer signs and builtin rotation modules stay blocking', () => {
  const base = { version: 1, enabled: true, quality: 1, separateAxes: false, frequency: 1, damping: false, octaves: 1, octaveMultiplier: 0.5, octaveScale: 2,
    strength: constant(1), strengthY: constant(1), strengthZ: constant(1), scrollSpeed: constant(0), positionAmount: constant(0), rotationAmount: constant(10), sizeAmount: constant(0), remapEnabled: false };
  const system = extra => ({ processor: { _runAnimateList: [], _particles: { length: 0 }, enableModule() {}, updateParticles() {} }, noiseModule: {}, ...extra });
  assert.throws(() => noise.installUnityParticleNoise(system(), { ...base, rotationSigns: [-1, -1, 1], rotationAmount: { minMaxState: 3, scalar: 10, minScalar: 0 } }, 1), /random/);
  assert.throws(() => noise.installUnityParticleNoise(system(), base, 1), /signs/);
  assert.throws(() => noise.installUnityParticleNoise(system({ rotationOvertimeModule: { enable: true } }), { ...base, rotationSigns: [-1, 1, -1] }, 1), /Euler rotation adapter/);
});
