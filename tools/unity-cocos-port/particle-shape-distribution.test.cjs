'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { shapeDistributionSystems, attachShapeDistributionRuntime } = require('./particle-shape-distribution-binding');
const native = require('./fixtures/shape-distribution-native.json');

// Minimal cc math used by the runtime.
class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  static set(o, x, y, z) { o.x = x; o.y = y; o.z = z; return o; }
  static multiplyScalar(o, a, s) { return Vec3.set(o, a.x * s, a.y * s, a.z * s); }
  static normalize(o, a) { const l = Math.hypot(a.x, a.y, a.z) || 1; return Vec3.set(o, a.x / l, a.y / l, a.z / l); }
  static lerp(o, a, b, t) { return Vec3.set(o, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
  static transformQuat(o, a) { return Vec3.set(o, a.x, a.y, a.z); }
  static transformMat4(o, a) { return Vec3.set(o, a.x, a.y, a.z); }
}
const runtime = {};
new Function('exports', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'runtime/UnityParticleShapeDistribution.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(runtime, () => ({ Vec3, Mat4: class {}, Quat: class {}, ParticleSystem: class {} }));

// Cocos 3.8.8 ShapeModule.emit for the local frame (identity mat/quat), linear radius draw.
function cocosShape(type, emitFrom, radius, thickness, angle, length) {
  return {
    shapeType: type, emitFrom, radius, radiusThickness: thickness, _angle: angle, length,
    randomPositionAmount: 0, sphericalDirectionAmount: 0, mat: null, quat: null,
    emit(p) {
      const theta = Math.random() * Math.PI * 2;
      const r = radius * (1 - thickness) + radius * thickness * Math.random();
      if (type === 3) { // Sphere Volume: random direction times r
        const z = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - z * z);
        Vec3.set(p.position, s * Math.cos(t) * r, s * Math.sin(t) * r, z * r); Vec3.normalize(p.velocity, p.position); return;
      }
      Vec3.set(p.position, Math.cos(theta) * r, Math.sin(theta) * r, 0);
      if (type === 1) { Vec3.normalize(p.velocity, p.position); return; }
      Vec3.set(p.velocity, p.position.x * Math.sin(angle), p.position.y * Math.sin(angle), -Math.cos(angle) * radius);
      Vec3.normalize(p.velocity, p.velocity);
      if (emitFrom === 3) {
        const s = length * Math.random() / -p.velocity.z;
        Vec3.set(p.position, p.position.x + p.velocity.x * s, p.position.y + p.velocity.y * s, p.velocity.z * s);
      }
    },
  };
}

const cocosType = { Circle: 1, Cone: 2, ConeVolume: 2, Sphere: 3, Hemisphere: 4 };
function sampleCase(c, n = 20000) {
  const type = cocosType[c.shape];
  const shape = cocosShape(type, c.shape === 'ConeVolume' ? 3 : type >= 3 ? 3 : 0, c.radius, c.thickness, c.angle * Math.PI / 180, c.length);
  runtime.installUnityShapeDistribution({ shapeModule: shape });
  const radii = [], heights = [], slopes = [];
  for (let i = 0; i < n; i++) {
    const p = { position: new Vec3(), velocity: new Vec3() };
    shape.emit(p);
    const { position: pos, velocity: v } = p;
    if (c.shape === 'ConeVolume') {
      const s = pos.z / v.z;
      radii.push(Math.hypot(pos.x - v.x * s, pos.y - v.y * s) / c.radius);
      heights.push(-pos.z / c.length);
    } else radii.push((type <= 2 ? Math.hypot(pos.x, pos.y) : pos.length()) / c.radius);
    const r = radii[radii.length - 1];
    if (c.shape === 'Cone' && r > 0.05) slopes.push(Math.hypot(v.x, v.y) / -v.z / r);
  }
  const q = (a, x) => { const s = [...a].sort((l, r) => l - r); return s[Math.round(x * (s.length - 1))]; };
  return { radii: native.quantiles.map((x) => q(radii, x)), heights: heights.length ? native.quantiles.map((x) => q(heights, x)) : null, slope: slopes.length ? q(slopes, 0.5) : null };
}

test('radius remap matches Unity native quantiles for circle, cone, sphere and hemisphere', () => {
  for (const c of native.cases) {
    const got = sampleCase(c);
    got.radii.forEach((value, i) => assert.ok(Math.abs(value - c.radiusQuantiles[i]) < 0.02,
      `${c.name} q${native.quantiles[i]}: ${value.toFixed(3)} vs Unity ${c.radiusQuantiles[i].toFixed(3)}`));
    if (c.slopePerRadius) assert.ok(Math.abs(got.slope - c.slopePerRadius) < 0.01, `${c.name} cone slope`);
    // Cone Volume travels length * u along the tilted ray, like Unity.
    if (c.heightQuantiles) got.heights.forEach((value, i) => assert.ok(Math.abs(value - c.heightQuantiles[i]) < 0.02, `${c.name} height q${native.quantiles[i]}`));
  }
});

test('the linear engine draw is measurably wrong, so the fixture guards the remap', () => {
  const coneBase = native.cases.find((c) => c.name === 'cone-base-1');
  assert.ok(Math.abs(0.5 - coneBase.radiusQuantiles[3]) > 0.15, 'Unity median radius is sqrt(0.5), not the linear 0.5');
});

test('binding attaches only to area/volume shapes with a radius', () => {
  const objects = [
    { __type__: 'cc.Node', _name: 'Rain' },
    { __type__: 'cc.ParticleSystem', node: { __id__: 0 }, _shapeModule: { __id__: 2 } },
    { __type__: 'cc.ShapeModule', _enable: true, _shapeType: 2, emitFrom: 0, radius: 7.3, radiusThickness: 1 },
    { __type__: 'cc.ParticleSystem', node: { __id__: 0 }, _shapeModule: { __id__: 4 } },
    { __type__: 'cc.ShapeModule', _enable: true, _shapeType: 0, emitFrom: 3, radius: 1, radiusThickness: 1 },
    { __type__: 'cc.ParticleSystem', node: { __id__: 0 }, _shapeModule: { __id__: 6 } },
    { __type__: 'cc.ShapeModule', _enable: true, _shapeType: 3, emitFrom: 2, radius: 1, radiusThickness: 1 },
    { __type__: 'cc.ParticleSystem', node: { __id__: 0 }, _shapeModule: { __id__: 8 } },
    { __type__: 'cc.ShapeModule', _enable: false, _shapeType: 1, emitFrom: 0, radius: 1, radiusThickness: 1 },
  ];
  const added = [];
  const builder = { objects, cocosDb: { findScriptClass: () => ({ classId: 'shape-class' }) }, addComponent: (nodeId, type, body) => added.push({ type, body }) };
  assert.deepEqual(shapeDistributionSystems(builder).map((s) => s.id), [1]);
  const entries = [];
  const reporter = Object.fromEntries(['high', 'medium', 'low'].map((level) => [level, (code) => entries.push(code)]));
  attachShapeDistributionRuntime(builder, reporter, { cocosRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'shape-')) });
  assert.deepEqual(added, [{ type: 'shape-class', body: { source: { __id__: 1 } } }]);
  assert.deepEqual(entries, ['PARTICLE_SHAPE_DISTRIBUTION_ADAPTER_BOUND']);
});
