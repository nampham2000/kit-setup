'use strict';
// Unity renderer pivot and Mesh World/Velocity alignment, measured with
// ParticleSystemRenderer.BakeMesh(useTransform = true): fixtures/particle-pivot-alignment-native.json
// (synthetic asymmetric mesh, View billboards) and -extra-native.json (second mesh bounds,
// built-in Quad as ChestLvOpen/Rain use it, the real ClickMoveArrows mesh, animated velocity).
// BakeMesh applies the emitter rotation and scale, but not its translation, to Local-simulation
// particle centers. Predictions use the shipped vertex-program expressions and runtime math.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), ts = require('typescript');
const { particleRendererContract } = require('./particle-renderer-contract');
const native = require('./fixtures/particle-pivot-alignment-native.json');
const extra = require('./fixtures/particle-pivot-alignment-extra-native.json');
class Vec4 { constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 0; } set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; } }
const m = { exports: {} };
new Function('exports', 'module', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'runtime/UnityParticleMeshFrame.ts'), 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText)(m.exports, m, () => ({ Vec4 }));
const frame = m.exports;
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
const shader = read('source-particle.effect');

const D = Math.PI / 180;
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const axis = (x, y, z, deg) => { const h = deg * D / 2, s = Math.sin(h); return [x * s, y * s, z * s, Math.cos(h)]; };
const unityEuler = e => qmul(axis(0, 1, 0, e[1]), qmul(axis(1, 0, 0, e[0]), axis(0, 0, 1, e[2]))); // Unity: Z, X, then Y
const rot = (q, v) => { const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx]; };
const add = (a, b) => a.map((v, i) => v + b[i]), mul = (a, b) => a.map((v, i) => v * b[i]);
const M = v => [v[0], v[1], -v[2]]; // Unity <-> Cocos (Z reflection)
const toCocos = q => [-q[0], -q[1], q[2], q[3]]; // the same reflection on a rotation
const arr = q => [q.x, q.y, q.z, q.w];
const MESH_SIGNS = [-1, -1, 1]; // particle-renderer-contract eulerSigns for Mesh
const boundsOf = vertices => [0, 1, 2].map(i => Math.max(...vertices.map(v => v[i])) - Math.min(...vertices.map(v => v[i])));
const worst = (got, want) => Math.max(...got.map((g, i) => Math.hypot(...g.map((v, j) => v - want[i][j]))));

// BakeMesh center: World simulation uses the particle position, Local simulation the emitter
// rotation/scale of it (no translation).
const center = c => c.local ? rot(unityEuler(c.parentEuler), mul(c.parentScale, c.position)) : c.position;
function particleQuat(c) {
  const q = { x: 0, y: 0, z: 0, w: 1 };
  frame.unityEulerQuaternion(q, ...c.rotation3D.map((v, i) => MESH_SIGNS[i] * v * D));
  return arr(q);
}
function velocityQuat(c, velocity) {
  const q = { x: 0, y: 0, z: 0, w: 1 }, world = c.local ? rot(unityEuler(c.parentEuler), velocity) : velocity;
  frame.unityVelocityFrame(q, ...M(world));
  return arr(q);
}
// Cocos vertex program: pos + R * (compScale * (a_texCoord3 + sourceRendererPivot.xyz * sourceRendererMesh.xyz)).
function cocosVertices(c, meshUnity, bounds, velocity = c.velocity) {
  const contract = particleRendererContract({}, { m_RenderMode: 4, m_RenderAlignment: c.alignment, m_Pivot: { x: c.pivot[0], y: c.pivot[1], z: c.pivot[2] } });
  const w = contract.sourceRendererPivot[3];
  const node = w === 3 ? [0, 0, 0, 1] : toCocos(unityEuler(c.parentEuler)); // Cocos World alignSpace = emitter world rotation
  const particle = c.alignment === 4 ? qmul(velocityQuat(c, velocity), particleQuat(c)) : particleQuat(c);
  const q = qmul(node, particle), pivot = contract.sourceRendererPivot.slice(0, 3);
  return meshUnity.map(v => M(add(M(center(c)), rot(q, mul(c.size, add(M(v), mul(pivot, bounds)))))));
}

test('native pivot/alignment fixtures bind their portable capture producers', () => {
  const hash = file => crypto.createHash('sha256').update(read(file)).digest('hex');
  assert.equal(hash('fixtures/capture-pivot-alignment.cs'), native.sourceProbeSha256);
  assert.equal(hash('fixtures/capture-pivot-alignment-extra.cs'), extra.sourceProbeSha256);
});
test('both particle effects implement the mesh pivot in bounds units and skip the emitter rotation for w=3', () => {
  for (const file of ['source-particle.effect', 'legacy-preview-particle.effect']) {
    const text = read(file);
    assert.match(text, /uniform SourceRenderer \{ vec4 sourceRendererPivot; vec4 sourceRendererSize; vec4 sourceRendererMesh; \};/);
    assert.match(text, /mat3 nodeMat = sourceRendererPivot\.w == 3\.0 \? mat3\(1\.0\) : quatToMat3\(nodeRotation\);/);
    assert.match(text, /pos = xform \* vec4\(a_texCoord3 \+ sourceRendererPivot\.xyz \* sourceRendererMesh\.xyz, 1\);/);
    assert.match(text, /sourceRendererMesh: *\{ value: \[0, ?0, ?0, ?0\] \}/, 'bounds default to 0: older materials keep no pivot');
  }
});
const uniform = c => c.parentScale.every(v => v === c.parentScale[0]);
for (const c of native.cases.filter(c => c.mode === 4 && uniform(c))) test(`native ${c.name} (alignment ${c.alignment}, pivot ${c.pivot}, parent ${c.parentEuler}, velocity ${c.velocity}, rotation ${c.rotation3D})`, () => {
  const e = worst(cocosVertices(c, native.sourceMesh, boundsOf(native.sourceMesh)), c.vertices);
  assert.ok(e < 2e-5, `max vertex error ${e}`);
});
test('non-uniform emitter scale is applied after the particle rotation in Unity (not ported)', () => {
  for (const c of native.cases.filter(c => c.mode === 4 && !uniform(c))) {
    const bounds = boundsOf(native.sourceMesh), pv = [c.pivot[0] * bounds[0], c.pivot[1] * bounds[1], -c.pivot[2] * bounds[2]];
    const inner = native.sourceMesh.map(v => rot(unityEuler(c.rotation3D), mul(c.size, add(v, pv))));
    // Local alignment: emitter rotation of (scale * rotated mesh); World alignment: scale on world axes.
    const want = inner.map(v => add(center(c), c.alignment === 2 ? rot(unityEuler(c.parentEuler), mul(c.parentScale, v)) : mul(c.parentScale, v)));
    assert.ok(worst(want, c.vertices) < 2e-5, `${c.name} Unity order`);
    assert.ok(worst(cocosVertices({ ...c, size: mul(c.size, c.parentScale) }, native.sourceMesh, bounds), c.vertices) > 0.1, 'Cocos scales inside the particle frame');
  }
});
test('native built-in Quad (ChestLvOpen pivot, Rain ripple World), second mesh bounds and ClickMoveArrows mesh', () => {
  const mesh = { 'mesh-second-bounds': extra.second, 'mesh-second-zero': extra.second, 'mesh-quad-chest': extra.quad, 'mesh-quad-ripple-world': extra.quad, 'mesh-arrow-velocity': extra.arrow };
  for (const c of extra.cases.filter(c => mesh[c.name])) {
    const source = mesh[c.name], bounds = boundsOf(source.vertices);
    assert.ok(Math.hypot(...bounds.map((v, i) => v - source.bounds.size[i])) < 1e-6, 'Unity mesh bounds');
    const e = worst(cocosVertices({ ...c, local: false, parentScale: [1, 1, 1] }, source.vertices, bounds), c.vertices);
    assert.ok(e < 2e-5, `${c.name} max vertex error ${e}`);
  }
  assert.equal(extra.arrow.name, 'RPGFXClickCurve');
});
test('Velocity alignment follows the total velocity (stored + animated)', () => {
  const c = extra.cases.find(c => c.name === 'mesh-velocity-animated');
  assert.deepEqual(c.totalVelocity, [1, 3, 0]);
  assert.ok(worst(cocosVertices({ ...c, local: false, parentScale: [1, 1, 1], position: c.position }, extra.second.vertices, boundsOf(extra.second.vertices), c.totalVelocity), c.vertices) < 2e-5);
  assert.ok(worst(cocosVertices({ ...c, local: false, parentScale: [1, 1, 1], position: c.position }, extra.second.vertices, boundsOf(extra.second.vertices), c.particleVelocity), c.vertices) > 0.1);
});
test('the runtime writes the Velocity frame into both vertex rotation ABIs, from local-space velocity', () => {
  const c = native.cases.find(c => c.name === 'mesh-velocity-parent' && c.local && c.parentEuler[0] === 20);
  const nodeRotation = toCocos(unityEuler(c.parentEuler));
  const vec = (x = 0, y = 0, z = 0) => ({ x, y, z, set(a, b, d) { this.x = a; this.y = b; this.z = d; return this; } });
  const expected = qmul(velocityQuat(c, c.velocity), particleQuat(c));
  for (const abi of ['quaternion', 'euler']) {
    const p = { ultimateVelocity: vec(...M(c.velocity)), startEuler: vec(...c.rotation3D.map((v, i) => MESH_SIGNS[i] * v * D)), rotation: vec() };
    frame.applyUnityParticleVelocityFrame({ processor: { _particles: { length: 1, data: [p] } }, rotationOvertimeModule: { enable: abi === 'quaternion' }, simulationSpace: 1,
      node: { worldRotation: { x: nodeRotation[0], y: nodeRotation[1], z: nodeRotation[2], w: nodeRotation[3] } } });
    let q;
    if (abi === 'quaternion') { const r = p.rotation; q = [r.x, r.y, r.z, Math.sqrt(Math.max(0, 1 - r.x * r.x - r.y * r.y - r.z * r.z))]; }
    else { const o = { x: 0, y: 0, z: 0, w: 1 }; frame.unityEulerQuaternion(o, p.rotation.x, p.rotation.y, p.rotation.z); q = arr(o); }
    const dot = Math.abs(q.reduce((s, v, i) => s + v * expected[i], 0));
    assert.ok(Math.abs(dot - 1) < 1e-9, `${abi} ABI rotation mismatch (${dot})`);
  }
});
test('Euler ABI decomposition inverts the Unity Z-X-Y composition, including gimbal lock', () => {
  let seed = 7; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const samples = Array.from({ length: 200 }, () => [random() * 7 - 3.5, random() * 7 - 3.5, random() * 7 - 3.5]).concat([[Math.PI / 2, 0.3, 0.4], [-Math.PI / 2, -1.2, 0.8]]);
  for (const e of samples) {
    const q = { x: 0, y: 0, z: 0, w: 1 }, back = { x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; } }, again = { x: 0, y: 0, z: 0, w: 1 };
    frame.unityEulerQuaternion(q, ...e); frame.unityEulerFromQuaternion(back, q); frame.unityEulerQuaternion(again, back.x, back.y, back.z);
    assert.ok(Math.abs(Math.abs(arr(q).reduce((s, v, i) => s + v * arr(again)[i], 0)) - 1) < 1e-9, `euler ${e}`);
  }
});
test('mesh bounds bind to the material instance used by the CPU renderer', () => {
  const set = [];
  const system = { renderer: { mesh: { struct: { minPosition: { x: -0.0964, y: -0.1106, z: 0.0157 }, maxPosition: { x: 0.0964, y: 0.1106, z: 0.0896 } } } },
    getMaterialInstance: index => index === 0 ? { setProperty: (name, value) => set.push([name, value.x, value.y, value.z, value.w]) } : null };
  assert.equal(frame.bindUnityParticleMeshBounds(system), true);
  assert.equal(set[0][0], 'sourceRendererMesh');
  [0.1928, 0.2212, 0.0739, 1].forEach((v, i) => assert.ok(Math.abs(set[0][i + 1] - v) < 1e-9));
  assert.equal(frame.bindUnityParticleMeshBounds({ renderer: { mesh: null }, getMaterialInstance: () => ({}) }), false);
});
test('native View billboard pivot: pivot*size in the rotated camera plane, z toward the camera by size.x', () => {
  const cases = native.cases.filter(c => c.mode === 0).concat(extra.cases.filter(c => c.mode === 0));
  assert.ok(cases.length >= 20);
  for (const c of cases) {
    const q = c.cameraRotation, right = rot(q, [1, 0, 0]), up = rot(q, [0, 1, 0]), forward = rot(q, [0, 0, 1]);
    const t = (c.rotation2D || 0) * D, size = c.size;
    // Unity billboard rotation is clockwise; the pivot rides with the quad.
    const dx = c.pivot[0] * size[0] * Math.cos(t) + c.pivot[1] * size[1] * Math.sin(t);
    const dy = -c.pivot[0] * size[0] * Math.sin(t) + c.pivot[1] * size[1] * Math.cos(t);
    const want = add(c.position, add(add(right.map(v => v * dx), up.map(v => v * dy)), forward.map(v => -v * c.pivot[2] * size[0])));
    const got = [0, 1, 2].map(j => c.vertices.reduce((s, v) => s + v[j], 0) / c.vertices.length);
    assert.ok(Math.hypot(...got.map((v, i) => v - want[i])) < 2e-5, `${c.name} pivot ${c.pivot} rotation ${c.rotation2D}`);
  }
  // Cocos rotates cornerOffset + pivot.xy by the particle quaternion (same rotation as the quad)
  // and camZ (cc_matViewInv column 2) points at the viewer.
  assert.match(shader, /computeVertPos\(pos, cornerOffset \+ sourceRendererPivot\.xy, rot, compScale, cc_matViewInv\);\n\s*pos\.xyz \+= normalize\(cc_matViewInv\[2\]\.xyz\) \* \(sourceRendererPivot\.z \* compScale\.x\);/);
});
test('renderer contract binds the measured pivot/alignment adapters and keeps the rest blocking', () => {
  const contract = (renderer, particle = {}) => particleRendererContract(particle, renderer);
  const chest = contract({ m_RenderMode: 4, m_RenderAlignment: 2, m_Pivot: { x: 0, y: 0.5, z: 0 } });
  assert.deepEqual(chest.unsupported, []); assert.deepEqual(chest.meshFrame, { pivot: true, velocity: false }); assert.deepEqual(chest.sourceRendererPivot, [0, 0.5, 0, 0]);
  const ripple = contract({ m_RenderMode: 4, m_RenderAlignment: 1 });
  assert.deepEqual(ripple.unsupported, []); assert.equal(ripple.meshFrame, null); assert.equal(ripple.sourceRendererPivot[3], 3);
  const arrows = contract({ m_RenderMode: 4, m_RenderAlignment: 4, m_Pivot: { x: 0, y: 0.1, z: -2 } });
  assert.deepEqual(arrows.unsupported, []); assert.deepEqual(arrows.meshFrame, { pivot: true, velocity: true }); assert.deepEqual(arrows.sourceRendererPivot, [0, 0.1, -2, 3]);
  const pickup = contract({ m_RenderMode: 0, m_RenderAlignment: 0, m_Pivot: { x: 0.15, y: 0, z: 0 } });
  assert.deepEqual(pickup.unsupported, []); assert.equal(pickup.requiresMaterialAdapter, true); assert.equal(pickup.meshFrame, null);
  assert.equal(contract({ m_RenderMode: 0, m_RenderAlignment: 0 }).requiresMaterialAdapter, false, 'plain View billboards keep the builtin effect');
  for (const blocked of [{ m_RenderMode: 4, m_RenderAlignment: 3 }, { m_RenderMode: 0, m_RenderAlignment: 1 }, { m_RenderMode: 0, m_RenderAlignment: 4 }])
    assert.ok(contract(blocked).unsupported.includes('alignment'), JSON.stringify(blocked));
  for (const blocked of [{ m_RenderMode: 0, m_RenderAlignment: 2, m_Pivot: { x: 0.1 } }, { m_RenderMode: 2, m_Pivot: { y: 0.1 } }, { m_RenderMode: 3, m_Pivot: { z: 0.1 } }, { m_RenderMode: 1, m_Pivot: { x: 0.1 } }])
    assert.ok(contract(blocked).unsupported.includes('pivot-axes'), JSON.stringify(blocked));
});
