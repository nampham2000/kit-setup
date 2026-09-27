'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), test = require('node:test'), assert = require('node:assert/strict'), ts = require('typescript');
const { particleAlignToDirectionContract, attachAlignToDirectionRuntime } = require('./particle-align-to-direction-binding');

class Vec3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } length() { return Math.hypot(this.x, this.y, this.z); }
  set(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  static set(o, x, y, z) { o.x = x; o.y = y; o.z = z; return o; } static add(o, a, b) { o.x = a.x + b.x; o.y = a.y + b.y; o.z = a.z + b.z; return o; } }
const runtime = {};
new Function('exports', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'runtime/UnityParticleAlignToDirection.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(runtime, () => ({ Vec3, ParticleSystem: class {} }));

const wrap = (deg) => ((deg % 360) + 540) % 360 - 180;
const MESH_SIGNS = [-1, -1, 1];

for (const sample of require('./fixtures/align-to-direction.json').cases) {
  test(`native alignToDirection rotation: ${sample.name}`, () => {
    for (const particle of sample.particles) {
      const [ux, uy, uz] = particle.direction;
      // Cocos simulates Unity's local frame with Z reflected; the porter stores mesh
      // rotation3D as (-X, -Y, +Z) radians.
      const cocosStart = new Vec3(-sample.startRotation[0] * Math.PI / 180, -sample.startRotation[1] * Math.PI / 180, sample.startRotation[2] * Math.PI / 180);
      const delta = runtime.unityAlignToDirectionDelta(new Vec3(), new Vec3(ux, uy, -uz), MESH_SIGNS);
      const unity = [-(cocosStart.x + delta.x), -(cocosStart.y + delta.y), cocosStart.z + delta.z].map(r => r * 180 / Math.PI);
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(Math.abs(wrap(unity[axis] - particle.rotation3D[axis])) < 0.05,
          `${sample.name} axis ${axis}: ${unity[axis].toFixed(3)} vs ${particle.rotation3D[axis]}`);
      }
    }
  });
}

test('the runtime adds the delta at birth using the shape direction before startSpeed', () => {
  let born = null;
  const shape = { emit(p) { p.velocity.x = 0; p.velocity.y = 0.5; p.velocity.z = Math.sqrt(0.75); } };
  const processor = { setNewParticle(p) { born = p; } };
  const align = new runtime.UnityParticleAlignToDirection({ processor, shapeModule: shape }, MESH_SIGNS);
  const particle = { velocity: new Vec3(), startEuler: new Vec3(0, 0, 1), rotation: new Vec3(0, 0, 1) };
  shape.emit(particle);
  particle.velocity.set({ x: 0, y: 0, z: 0 }); // startSpeed 0
  processor.setNewParticle(particle);
  assert.equal(born, particle);
  assert.ok(Math.abs(particle.rotation.x - Math.PI / 6) < 1e-9, 'pitch from the shape direction');
  assert.equal(particle.rotation.z, 1, 'roll untouched');
  align.destroy();
});

test('binding attaches mesh emitters and reports unmeasured billboards', () => {
  const on = { ShapeModule: { enabled: 1, alignToDirection: 1 } };
  assert.deepEqual(particleAlignToDirectionContract(on, { m_RenderMode: 4 }), { enabled: true, mesh: true, worldSpace: false });
  assert.equal(particleAlignToDirectionContract({ ShapeModule: { enabled: 1, alignToDirection: 0 } }, {}).enabled, false);
  const objects = [{ __type__: 'cc.Node', _name: 'Shield' }];
  const mesh = { __type__: 'cc.ParticleSystem', node: { __id__: 0 } };
  Object.defineProperty(mesh, 'unityAlignToDirectionContract', { value: particleAlignToDirectionContract(on, { m_RenderMode: 4 }) });
  Object.defineProperty(mesh, 'unityRendererContract', { value: { eulerSigns: MESH_SIGNS } });
  const billboard = { __type__: 'cc.ParticleSystem', node: { __id__: 0 } };
  Object.defineProperty(billboard, 'unityAlignToDirectionContract', { value: particleAlignToDirectionContract(on, { m_RenderMode: 0 }) });
  objects.push(mesh, billboard);
  const added = [], codes = [];
  const builder = { objects, cocosDb: { findScriptClass: () => ({ classId: 'align' }) }, addComponent: (n, t, body) => added.push(body) };
  attachAlignToDirectionRuntime(builder, Object.fromEntries(['high', 'medium', 'low'].map(l => [l, c => codes.push(c)])),
    { cocosRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'align-')) });
  assert.equal(added.length, 1);
  assert.deepEqual(JSON.parse(added[0].sourceContract).eulerSigns, MESH_SIGNS);
  assert.deepEqual(codes, ['PARTICLE_ALIGN_TO_DIRECTION_UNMEASURED', 'PARTICLE_ALIGN_TO_DIRECTION_BOUND']);
});
