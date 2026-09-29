'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const native = require('./fixtures/wind-zone-native.json');
const { particleExternalForcesContract, unsupportedExternalForcesReasons, attachExternalForcesRuntime } = require('./wind-zone-binding');

// Minimal cc math (column-major Mat4 like Cocos) for the runtime under test.
class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { if (typeof x === 'object') { this.x = x.x; this.y = x.y; this.z = x.z; } else { this.x = x; this.y = y; this.z = z; } return this; }
  static scaleAndAdd(out, a, b, s) { out.x = a.x + b.x * s; out.y = a.y + b.y * s; out.z = a.z + b.z * s; return out; }
  static transformQuat(out, v, q) {
    const ix = q.w * v.x + q.y * v.z - q.z * v.y, iy = q.w * v.y + q.z * v.x - q.x * v.z, iz = q.w * v.z + q.x * v.y - q.y * v.x, iw = -q.x * v.x - q.y * v.y - q.z * v.z;
    out.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y; out.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z; out.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x; return out;
  }
  static transformMat4(out, v, m) { const { x, y, z } = v; out.x = m.m[0] * x + m.m[4] * y + m.m[8] * z + m.m[12]; out.y = m.m[1] * x + m.m[5] * y + m.m[9] * z + m.m[13]; out.z = m.m[2] * x + m.m[6] * y + m.m[10] * z + m.m[14]; return out; }
  static transformMat4Normal(out, v, m) { const { x, y, z } = v; out.x = m.m[0] * x + m.m[4] * y + m.m[8] * z; out.y = m.m[1] * x + m.m[5] * y + m.m[9] * z; out.z = m.m[2] * x + m.m[6] * y + m.m[10] * z; return out; }
}
class Mat4 {
  constructor() { this.m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  static invert(out, a) {
    const m = a.m, inv = new Array(16);
    inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
    inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
    inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
    inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
    inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
    inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
    inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
    inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
    inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
    inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
    inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
    inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
    inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
    inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
    inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
    inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
    const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    out.m = inv.map((v) => v / det); return out;
  }
  static fromRTS(q, t, s) {
    const out = new Mat4(), { x, y, z, w } = q, x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    out.m = [(1 - (yy + zz)) * s, (xy + wz) * s, (xz - wy) * s, 0, (xy - wz) * s, (1 - (xx + zz)) * s, (yz + wx) * s, 0, (xz + wy) * s, (yz - wx) * s, (1 - (xx + yy)) * s, 0, t.x, t.y, t.z, 1];
    return out;
  }
}
let totalTimeMs = 0;
const decorator = { ccclass: () => (c) => c, executionOrder: () => (c) => c, property: (...a) => (typeof a[1] === 'string' ? undefined : () => undefined) };
const cc = { _decorator: decorator, Component: class { }, Vec3, Mat4, Quat: class { }, director: { getTotalTime: () => totalTimeMs }, ParticleSystem: class { } };
function compile(name, deps) {
  const m = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'runtime', `${name}.ts`), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true } }).outputText;
  new Function('exports', 'module', 'require', source)(m.exports, m, (k) => (k === 'cc' ? cc : deps[k]));
  return m.exports;
}
const wind = compile('UnityWindZone', {});
const { installUnityParticleExternalForces } = compile('UnityParticleExternalForces', { './UnityWindZone': wind });

// Unity (left-handed) -> Cocos: positions flip Z, quaternions negate x and y (porter convention).
const DEG = Math.PI / 180;
function unityEulerQuat([ex, ey, ez]) { // Unity order: Z, then X, then Y (q = qy * qx * qz)
  const [hx, hy, hz] = [ex * DEG / 2, ey * DEG / 2, ez * DEG / 2];
  const qx = { x: Math.sin(hx), y: 0, z: 0, w: Math.cos(hx) }, qy = { x: 0, y: Math.sin(hy), z: 0, w: Math.cos(hy) }, qz = { x: 0, y: 0, z: Math.sin(hz), w: Math.cos(hz) };
  const mul = (a, b) => ({ w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z, x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w });
  return mul(mul(qy, qx), qz);
}
const toCocosQuat = (q) => ({ x: -q.x, y: -q.y, z: q.z, w: q.w });
const flip = ([x, y, z]) => new Vec3(x, y, -z);

function zoneFor(spec) {
  const zone = new wind.UnityWindZone();
  Object.assign(zone, { mode: spec.mode, radius: spec.radius, windMain: spec.windMain, windTurbulence: spec.turbulence, windPulseMagnitude: spec.pulseMagnitude, windPulseFrequency: spec.pulseFrequency });
  zone.node = { worldPosition: new Vec3(), worldRotation: toCocosQuat(unityEulerQuat(spec.euler)) };
  return zone;
}

function simulate(c) {
  const zone = zoneFor(c.zone);
  zone.onEnable();
  try {
    const e = c.emitter, rotation = toCocosQuat(unityEulerQuat(e.euler));
    const pool = { data: c.steps[0].map((p) => ({ position: flip(p.position), velocity: flip(p.velocity) })) };
    pool.length = pool.data.length;
    const processor = { _particles: pool, updateParticles(dt) { for (const p of pool.data) Vec3.scaleAndAdd(p.position, p.position, p.velocity, dt); return pool.length; } };
    const system = { processor, simulationSpace: e.local ? 1 : 0, node: { worldMatrix: Mat4.fromRTS(rotation, flip(e.position), e.scale) } };
    installUnityParticleExternalForces(system, { multiplier: e.multiplier });
    return c.steps.slice(1).map(() => { processor.updateParticles(c.dt); return pool.data.map((p) => [p.velocity.x, p.velocity.y, -p.velocity.z]); });
  } finally { zone.onDisable(); }
}

test('fixture was captured with every scene WindZone disabled and the clocks recorded', () => {
  assert.equal(native.cases.length, 14);
  assert.ok(Number.isFinite(native.windTime.time));
});

for (const c of native.cases) {
  test(`native WindZone External Forces: ${c.case}`, () => {
    totalTimeMs = native.windTime.time * 1000; // edit mode wind time is the frozen Time.time
    const got = simulate(c);
    got.forEach((particles, step) => particles.forEach((velocity, i) => velocity.forEach((value, axis) => {
      const expected = c.steps[step + 1][i].velocity[axis];
      // The fitted pulse is within 0.05% of native (pulse 0.01 is 1.4988 native, 1.4993 fitted).
      assert.ok(Math.abs(value - expected) < Math.max(2e-5, 5e-4 * Math.abs(expected)), `step ${step + 1} particle ${i} axis ${axis}: ${value} vs ${expected}`);
    })));
  });
}

test('turbulence does not move particles and zone scale does not scale the radius', () => {
  const plain = native.cases.find((c) => c.case === 'spherical'), turbulent = native.cases.find((c) => c.case === 'spherical-turbulence');
  assert.deepEqual(turbulent.steps, plain.steps);
  const scaled = native.cases.find((c) => c.case === 'spherical-zone-scale-2');
  assert.deepEqual(scaled.steps[1][2].velocity, [0, 0, 0], 'r = 5 lies outside radius 4 even with zone scale 2');
});

test('pulse: 1 + magnitude * (cos x + cos 0.375x + cos 0.05x) / 3 with x = PI * frequency * Time.time', () => {
  assert.ok(Math.abs(wind.unityWindPulse(0.5, 0, 123) - 1.5) < 1e-12);
  assert.ok(Math.abs(wind.unityWindPulse(0, 1, 5) - 1) < 1e-12);
});

test('converter contract and binding refuse unmeasured filters and multiplier curves', () => {
  const on = particleExternalForcesContract({ ExternalForcesModule: { enabled: 1, multiplier: 10, influenceFilter: 0, influenceMask: { m_Bits: 4294967295 }, influenceList: [] } });
  assert.deepEqual(on, { enabled: true, multiplier: 10, multiplierMode: 0, influenceFilter: 0, influenceMask: 4294967295, influenceList: 0 });
  assert.deepEqual(unsupportedExternalForcesReasons(on), []);
  const masked = particleExternalForcesContract({ ExternalForcesModule: { enabled: 1, multiplier: 1, influenceFilter: 0, influenceMask: { m_Bits: 1 } } });
  assert.deepEqual(unsupportedExternalForcesReasons(masked), ['influence-filter']);
  const curve = particleExternalForcesContract({ ExternalForcesModule: { enabled: 1, multiplierCurve: { minMaxState: 1, scalar: 2 } } });
  assert.deepEqual(unsupportedExternalForcesReasons(curve), ['multiplier-curve']);
  assert.equal(particleExternalForcesContract({}).enabled, false);

  const reports = [], added = [];
  const reporter = { high: (...a) => reports.push(['high', ...a]), low: (...a) => reports.push(['low', ...a]) };
  const particle = { node: { __id__: 0 } };
  Object.defineProperty(particle, 'unityExternalForcesContract', { value: on });
  const builder = { objects: [{ _name: 'Particles' }, particle], cocosDb: { findScriptClass: () => ({ classId: 'ext-class' }) }, addComponent: (...a) => added.push(a) };
  attachExternalForcesRuntime(builder, reporter, { dryRun: true, cocosRoot: __dirname });
  assert.deepEqual(added, [[0, 'ext-class', { source: { __id__: 1 }, multiplier: 10 }, null, 'cmp-unity-external-forces-1']]);
  assert.equal(reports[0][1], 'PARTICLE_EXTERNAL_FORCES_BOUND');
});
