'use strict';

// Unity 5.x materials serialize m_SavedProperties (serializedVersion 2) as "- first: {name}" /
// "second: value" pairs. KriptoFX REP v1 DemoResources mat_fx_smoke_01 (Legacy Particles/Alpha
// Blended, torch smoke) lost its _MainTex and _TintColor: the parsers keyed everything as "first",
// so the torch smoke rendered as untextured grey squares.
const assert = require('node:assert/strict');
const test = require('node:test');
const createMaterialPorter = require('./material-porter.js');
const { parseUnityYamlText, parseUnityScalar, getIndentedBlock, getField, unityRefGuid } = require('../unity-cocos-port.cjs');

const LEGACY = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!21 &2100000
Material:
  serializedVersion: 6
  m_Name: mat_fx_smoke_01
  m_Shader: {fileID: 203, guid: 0000000000000000f000000000000000, type: 0}
  m_ShaderKeywords: BlendAlpha Clip_OFF
  m_SavedProperties:
    serializedVersion: 2
    m_TexEnvs:
    - first:
        name: _MainTex
      second:
        m_Texture: {fileID: 2800000, guid: 61a2cde4348944047813a51b3cf82c8b, type: 3}
        m_Scale: {x: 2, y: 1}
        m_Offset: {x: 0, y: 0.5}
    - first:
        name: _Mask
      second:
        m_Texture: {fileID: 0}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    m_Floats:
    - first:
        name: DstMode
      second: 10
    - first:
        name: _InvFade
      second: 3
    m_Colors:
    - first:
        name: _Color
      second: {r: 1, g: 1, b: 1, a: 1}
    - first:
        name: _TintColor
      second: {r: 0.2794118, g: 0.2794118, b: 0.2794118, a: 0.57}
`;

const MODERN = `--- !u!21 &2100000
Material:
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs:
    - _MainTex:
        m_Texture: {fileID: 2800000, guid: 7badf87401cca5b449f7233270c8995e, type: 3}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    m_Floats:
    - _InvFade: 1
    m_Colors:
    - _TintColor: {r: 0.5, g: 0.5, b: 0.5, a: 0.5}
`;

const porter = () => createMaterialPorter({ parseUnityScalar, parseUnityYaml: () => [], getField, unityRefGuid, getIndentedBlock,
  importedUnityAssetPath: () => '', resolveCurrentStandaloneMaterialUuid: () => '', firstSubMetaRecord: () => null,
  copyUnityAssetToCocos: () => '', ensureDirectoryMetas: () => {}, ensureMaterialAssetMeta: () => ({}), libraryJsonPathForUuid: () => '' });
const materialDoc = text => parseUnityYamlText(text).find(doc => doc.classId === 21);

test('legacy first/second texture envs, floats and colours parse by property name', () => {
  const { parseUnityTextureEnvMap, parseUnitySerializedScalarMap } = porter();
  const doc = materialDoc(LEGACY);
  const tex = parseUnityTextureEnvMap(doc);
  assert.deepEqual(Object.keys(tex), ['_MainTex', '_Mask']);
  assert.equal(unityRefGuid(tex._MainTex.m_Texture), '61a2cde4348944047813a51b3cf82c8b');
  assert.deepEqual(tex._MainTex.m_Scale, { x: 2, y: 1 });
  assert.deepEqual(tex._MainTex.m_Offset, { x: 0, y: 0.5 });
  assert.deepEqual(parseUnitySerializedScalarMap(doc, 'm_Floats'), { DstMode: 10, _InvFade: 3 });
  const colors = parseUnitySerializedScalarMap(doc, 'm_Colors');
  assert.deepEqual(colors._TintColor, { r: 0.2794118, g: 0.2794118, b: 0.2794118, a: 0.57 });
  assert.deepEqual(colors._Color, { r: 1, g: 1, b: 1, a: 1 });
});

test('modern "- name: value" properties are unchanged', () => {
  const { parseUnityTextureEnvMap, parseUnitySerializedScalarMap } = porter();
  const doc = materialDoc(MODERN);
  assert.equal(unityRefGuid(parseUnityTextureEnvMap(doc)._MainTex.m_Texture), '7badf87401cca5b449f7233270c8995e');
  assert.deepEqual(parseUnitySerializedScalarMap(doc, 'm_Floats'), { _InvFade: 1 });
  assert.deepEqual(parseUnitySerializedScalarMap(doc, 'm_Colors')._TintColor, { r: 0.5, g: 0.5, b: 0.5, a: 0.5 });
});

// Unity 5.0-5.5 (KriptoFX RFX4 portal Sky.mat): repeated `data:` keys, each with `first: name:` and `second:`.
const DATA_FORM = `--- !u!21 &2100000
Material:
  serializedVersion: 6
  m_Name: Sky
  m_SavedProperties:
    serializedVersion: 2
    m_TexEnvs:
      data:
        first:
          name: _MainTex
        second:
          m_Texture: {fileID: 2800000, guid: 81905021aee3aa1429c2826151a1cb05, type: 3}
          m_Scale: {x: 3, y: 1}
          m_Offset: {x: 0, y: 0}
      data:
        first:
          name: _BumpMap
        second:
          m_Texture: {fileID: 0}
          m_Scale: {x: 1, y: 1}
          m_Offset: {x: 0, y: 0}
    m_Floats:
      data:
        first:
          name: _InvFade
        second: 2
    m_Colors:
      data:
        first:
          name: _TintColor
        second: {r: 0.84, g: 0.63, b: 1, a: 1}
      data:
        first:
          name: _NoiseScale
        second: {r: 0.2, g: 0.2, b: 1, a: 0.2}
`;

test('Unity 5.0 `data:` texture envs, floats and colours parse by property name', () => {
  const { parseUnityTextureEnvMap, parseUnitySerializedScalarMap } = porter();
  const doc = materialDoc(DATA_FORM);
  const tex = parseUnityTextureEnvMap(doc);
  assert.deepEqual(Object.keys(tex), ['_MainTex', '_BumpMap']);
  assert.equal(unityRefGuid(tex._MainTex.m_Texture), '81905021aee3aa1429c2826151a1cb05');
  assert.deepEqual(tex._MainTex.m_Scale, { x: 3, y: 1 });
  assert.deepEqual(parseUnitySerializedScalarMap(doc, 'm_Floats'), { _InvFade: 2 });
  assert.deepEqual(parseUnitySerializedScalarMap(doc, 'm_Colors')._NoiseScale, { r: 0.2, g: 0.2, b: 1, a: 0.2 });
});

// Auto-transpiled custom effects declare the Unity properties under their converted names; the material
// used to receive builtin-standard props (mainColor, roughness, tilingOffset) instead (RFX4 Tornado).
test('custom-effect materials receive the properties the effect declares', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const cocosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-effect-props-'));
  fs.mkdirSync(path.join(cocosRoot, 'assets', 'effects'), { recursive: true });
  fs.writeFileSync(path.join(cocosRoot, 'assets', 'effects', 'Tornado.effect'), `CCEffect %{
  techniques:
  - name: opaque
    passes:
    - vert: vs:vert
      properties:
        tintColor: { value: [0.5, 0.5, 0.5, 0.5], editor: { type: color } }
        mainTexture: { value: white }
        mainTexture_ST: { value: [1, 1, 0, 0] }
        twistScale: { value: [1, 0.2, 2, 0] }
        speed: { value: 1 }
}%
`);
  const { customShaderMaterialProps } = porter();
  const colors = { _TintColor: { r: 0.5, g: 0.25, b: 1, a: 0.4 }, _TwistScale: { r: 2, g: 0.3, b: 4, a: 1 }, _Color: { r: 1, g: 1, b: 1, a: 1 } };
  const texEnvs = { _MainTex: { m_Texture: { fileID: 0 }, m_Scale: { x: 2, y: 2 }, m_Offset: { x: 0, y: 0.5 } } };
  const gamma = customShaderMaterialProps('Tornado', colors, { _Speed: 3, _Glossiness: 0.5 }, texEnvs, new Map(), { cocosRoot, unityRoot: '' }, { low() {}, medium() {}, high() {} });
  assert.deepEqual(Object.keys(gamma).sort(), ['mainTexture_ST', 'speed', 'tintColor', 'twistScale']);
  assert.deepEqual(gamma.twistScale, { __type__: 'cc.Vec4', x: 2, y: 0.3, z: 4, w: 1 });
  assert.deepEqual(gamma.mainTexture_ST, { __type__: 'cc.Vec4', x: 2, y: 2, z: 0, w: 0.5 });
  assert.equal(gamma.speed, 3);
  assert.equal(gamma.tintColor.__type__, 'cc.Color');
});
