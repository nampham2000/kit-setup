'use strict';

// TextMeshPro text is ported as cc.Label. Its runtime glyph MeshRenderer and TextMeshPro/* SDF
// shaders must never reach the shader transpiler: TMP_SDF.shader transpiles to an effect Cocos
// refuses (EFX2402 reserved `output`, read-only attribute writes, unbound _EnvMatrix), and every
// asset referencing it then fails to download in the editor preview.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { convertUnityMaterialToCocos, emitMeshRenderer } = require('./unity-cocos-port.cjs');

function recorder() {
  const reports = [];
  const push = level => (...args) => reports.push([level, ...args]);
  return { reports, reporter: { low: push('low'), medium: push('medium'), high: push('high') } };
}

test('a MeshRenderer driven by a 3D TextMeshPro component is not emitted', () => {
  const model = {
    file: 'Assets/Box.prefab',
    componentDocs: new Map([
      ['renderer', { classId: 23, lines: ['  m_Materials:', '  - {fileID: 2100000, guid: 11111111111111111111111111111111, type: 2}'] }],
      ['filter', { classId: 33, lines: ['  m_Mesh: {fileID: 0}'] }],
      ['tmp', { classId: 114, lines: ['  m_text: 3', '  m_fontAsset: {fileID: 11400000, guid: 22222222222222222222222222222222, type: 2}'] }],
    ]),
  };
  const gameObject = { name: 'TxtCount', components: ['renderer', 'filter', 'tmp'] };
  const builder = new Proxy({}, { get: () => () => { throw new Error('builder must not be called'); } });
  const { reports, reporter } = recorder();
  const result = emitMeshRenderer(gameObject, 7, 'renderer', model.componentDocs.get('renderer'), model, builder, reporter, {}, new Map(), {});
  assert.equal(result, undefined);
  assert.deepEqual(reports.map(entry => entry[1]), ['TMP_MESH_RENDERER_SKIPPED']);
});

test('a material on a TextMeshPro/* shader is not transpiled into an effect', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-text-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unityRoot = path.join(root, 'Unity');
  const cocosRoot = path.join(root, 'Cocos');
  fs.mkdirSync(path.join(unityRoot, 'Assets', 'Fonts'), { recursive: true });
  fs.mkdirSync(path.join(cocosRoot, 'assets'), { recursive: true });
  const shaderFile = path.join(unityRoot, 'Assets', 'Fonts', 'TMP_SDF.shader');
  fs.writeFileSync(shaderFile, 'Shader "TextMeshPro/Distance Field" {\n  SubShader { Pass { CGPROGRAM\n  struct pixel_t { float4 position : SV_POSITION; };\n  pixel_t VertShader() { pixel_t output; output.position = 0; return output; }\n  ENDCG } }\n}\n');
  const materialFile = path.join(unityRoot, 'Assets', 'Fonts', 'Baloo SDF.mat');
  fs.writeFileSync(materialFile, [
    '%YAML 1.1',
    '%TAG !u! tag:unity3d.com,2011:',
    '--- !u!21 &2100000',
    'Material:',
    '  m_Name: Baloo SDF',
    '  m_Shader: {fileID: 4800000, guid: 33333333333333333333333333333333, type: 3}',
    '',
  ].join('\n'));
  const unityDb = new Map([['33333333333333333333333333333333', {
    path: shaderFile, stem: 'TMP_SDF', ext: '.shader', relativePath: 'Assets/Fonts/TMP_SDF.shader',
  }]]);
  const materialAsset = { path: materialFile, stem: 'Baloo SDF', ext: '.mat', relativePath: 'Assets/Fonts/Baloo SDF.mat' };
  const { reports, reporter } = recorder();
  const uuid = convertUnityMaterialToCocos(materialAsset, { cocosRoot, unityRoot, assetsRoot: path.join(unityRoot, 'Assets') }, unityDb, reporter);
  assert.equal(uuid, '');
  assert.ok(reports.some(entry => entry[0] === 'low' && entry[1] === 'TMP_SHADER_NOT_TRANSPILED'), JSON.stringify(reports));
  assert.equal(fs.existsSync(path.join(cocosRoot, 'assets', 'effects', 'TMP_SDF.effect')), false);
});
