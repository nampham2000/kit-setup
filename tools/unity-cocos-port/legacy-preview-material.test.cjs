'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  LEGACY_PREVIEW_TECHNIQUES,
  legacyPreviewShader,
  legacyPreviewMaterialData,
} = require('./legacy-preview-material');

const base = { effectUuid: 'effect-uuid', name: 'm' };

test('EFFECT shim uses _TintColor and falls back to the shader default when unsaved', () => {
  const shader = legacyPreviewShader('LegacyPreview/URP Effect');
  const saved = legacyPreviewMaterialData({ ...base, shader, usage: 'particle', colors: { _TintColor: { r: 0.5, g: 0.5, b: 0.5, a: 0.5 }, _Color: { r: 2, g: 2, b: 2, a: 1 } } });
  assert.deepEqual(saved._props[0].unityColor, { __type__: 'cc.Vec4', x: 0.5, y: 0.5, z: 0.5, w: 0.5 });
  assert.equal(saved._techIdx, LEGACY_PREVIEW_TECHNIQUES['particle-effect']);
  const unsaved = legacyPreviewMaterialData({ ...base, shader, usage: 'particle', colors: { _Color: { r: 2, g: 2, b: 2, a: 1 } } });
  assert.deepEqual(unsaved._props[0].unityColor, { __type__: 'cc.Vec4', x: 1, y: 1, z: 1, w: 1 }, 'a stale _Color never reaches the EFFECT pass');
  assert.equal(unsaved._props[0].mainTexture, undefined, 'missing _MainTex keeps the white default');
});

test('opaque shim renders its first (OPAQUE) pass with _Color', () => {
  const shader = legacyPreviewShader('LegacyPreview/URP');
  const mesh = legacyPreviewMaterialData({ ...base, shader, usage: 'mesh', colors: { _Color: { r: 0.25, g: 0.5, b: 1, a: 1 } } });
  assert.equal(mesh._techIdx, LEGACY_PREVIEW_TECHNIQUES['mesh-opaque']);
  assert.equal(mesh._props[0].unityColor.x, 0.25);
  assert.equal(mesh._props[0].sourceRendererPivot, undefined);
});

test('linear projects flag every input Unity linearizes; mesh vertex colors stay raw', () => {
  const shader = legacyPreviewShader('LegacyPreview/URP Effect');
  const particle = legacyPreviewMaterialData({ ...base, shader, usage: 'particle', linear: true, textureUuid: 't@1', textureSrgb: true });
  assert.deepEqual(particle._props[0].unityColorSpace, { __type__: 'cc.Vec4', x: 1, y: 1, z: 1, w: 1 });
  const dataTexture = legacyPreviewMaterialData({ ...base, shader, usage: 'particle', linear: true, textureUuid: 't@1', textureSrgb: false, applyActiveColorSpace: false });
  assert.equal(dataTexture._props[0].unityColorSpace.x, 0);
  assert.equal(dataTexture._props[0].unityColorSpace.y, 0);
  const mesh = legacyPreviewMaterialData({ ...base, shader, usage: 'mesh', linear: true });
  assert.equal(mesh._props[0].unityColorSpace.y, 0);
  const gamma = legacyPreviewMaterialData({ ...base, shader, usage: 'particle', linear: false, textureUuid: 't@1' });
  assert.deepEqual(gamma._props[0].unityColorSpace, { __type__: 'cc.Vec4', x: 0, y: 0, z: 0, w: 0 });
});

test('the embedded particle vertex program matches source-particle.effect', () => {
  const marker = '// Adapted from Cocos Creator 3.8.8';
  const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
  const source = read('source-particle.effect');
  const legacy = read('legacy-preview-particle.effect');
  assert.equal(legacy.slice(legacy.indexOf(marker)), source.slice(source.indexOf(marker)));
});
