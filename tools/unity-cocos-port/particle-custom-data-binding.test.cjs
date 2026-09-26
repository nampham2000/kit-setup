'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), test = require('node:test'), assert = require('node:assert/strict'), ts = require('typescript');
const { vertexStreams, particleCustomDataContract, attachCustomDataRuntime } = require('./particle-custom-data-binding');
const { parseUnityRendererDoc } = require('./particle-system-converter');

// Hovl "Lightning bolt": UV, UV2, Custom1XYZW -> shader TEXCOORD1 = Custom1.
const lightning = {
  CustomDataModule: {
    enabled: 1, mode0: 1, vectorComponentCount0: 4,
    vector0_0: { minMaxState: 0, scalar: 1, minScalar: 0 },
    vector0_1: { minMaxState: 1, scalar: 300, minScalar: 0, maxCurve: { m_Curve: [{ time: 0, value: 1, inSlope: 0, outSlope: 0 }, { time: 0.5, value: 0, inSlope: 0, outSlope: 0 }, { time: 1, value: 1, inSlope: 0, outSlope: 0 }] } },
    vector0_2: { minMaxState: 3, scalar: 20, minScalar: 0 },
    vector0_3: { minMaxState: 3, scalar: 1, minScalar: 0 },
  },
};

test('vertex streams stay a hex byte string through the YAML parser', () => {
  const renderer = parseUnityRendererDoc('ParticleSystemRenderer:\n  m_RenderMode: 1\n  m_VertexStreams: 000103040522\n');
  assert.equal(renderer.m_VertexStreams, '000103040522');
  assert.deepEqual(vertexStreams(renderer), [0, 1, 3, 4, 5, 34]);
  assert.deepEqual(vertexStreams({ m_VertexStreams: '' }), []);
});

test('Custom1 curves are limited to the streamed components', () => {
  const full = particleCustomDataContract(lightning, { m_VertexStreams: '000103040522' });
  assert.equal(full.components, 4);
  assert.deepEqual(full.curves.map((c) => [c.mode, c.scalar, c.minimum]), [[0, 1, 0], [1, 300, 0], [3, 20, 0], [3, 1, 0]]);
  assert.equal(full.curves[1].keys.length, 3);
  // Custom1XY stream: the shader never sees z/w.
  assert.equal(particleCustomDataContract(lightning, { m_VertexStreams: '0001030420' }).curves.length, 2);
  // No Custom1 stream: nothing to bind even though the module is enabled.
  assert.equal(particleCustomDataContract(lightning, { m_VertexStreams: '00010304' }).curves.length, 0);
  // Streamed but module disabled: Unity feeds zeros, which the unbound material already reads.
  assert.equal(particleCustomDataContract({ CustomDataModule: { ...lightning.CustomDataModule, enabled: 0 } }, { m_VertexStreams: '000103040522' }).curves.length, 0);
});

function builderWith(contract, textureAnimation = false) {
  const objects = [{ __type__: 'cc.Node', _name: 'Lightning bolt' }, { __type__: 'cc.TextureAnimationModule', _enable: textureAnimation }];
  const particle = { __type__: 'cc.ParticleSystem', node: { __id__: 0 }, _textureAnimationModule: { __id__: 1 } };
  Object.defineProperty(particle, 'unityCustomDataContract', { value: contract });
  objects.push(particle);
  const added = [], codes = [];
  const builder = { objects, cocosDb: { findScriptClass: () => ({ classId: 'custom-class' }) }, addComponent: (node, type, body) => added.push(body) };
  const reporter = Object.fromEntries(['high', 'medium', 'low'].map((level) => [level, (code) => codes.push(code)]));
  return { builder, reporter, added, codes };
}

test('the adapter carries the curves and refuses a texture-sheet conflict', () => {
  const contract = particleCustomDataContract(lightning, { m_VertexStreams: '000103040522' });
  const options = { cocosRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'custom-')) };
  const ok = builderWith(contract);
  attachCustomDataRuntime(ok.builder, ok.reporter, options);
  assert.equal(JSON.parse(ok.added[0].sourceContract).curves.length, 4);
  assert.deepEqual(ok.codes, ['PARTICLE_CUSTOM_DATA_BOUND']);
  const conflict = builderWith(contract, true);
  attachCustomDataRuntime(conflict.builder, conflict.reporter, options);
  assert.equal(conflict.added.length, 0);
  assert.deepEqual(conflict.codes, ['PARTICLE_CUSTOM_DATA_FRAME_CONFLICT']);
});

test('runtime samples Unity MinMaxCurve modes per particle age', () => {
  const out = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'runtime/UnityParticleCustomData.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', source)(out, () => ({}));
  const [x, y, z] = particleCustomDataContract(lightning, { m_VertexStreams: '000103040522' }).curves;
  assert.equal(out.sampleUnityCustomCurve(x, 0.3, 0.7), 1);
  assert.equal(out.sampleUnityCustomCurve(y, 0, 0.5), 300);
  assert.equal(out.sampleUnityCustomCurve(y, 0.5, 0.5), 0);
  assert.equal(out.sampleUnityCustomCurve(y, 0.25, 0.5), 150);
  assert.equal(out.sampleUnityCustomCurve(z, 0.1, 0.25), 5);
  const r = [0, 1, 2, 3].map((c) => out.unityCustomRandom(12345, c));
  assert.equal(new Set(r).size, 4, 'components draw independent randoms');
  assert.ok(r.every((v) => v >= 0 && v < 1));
});
