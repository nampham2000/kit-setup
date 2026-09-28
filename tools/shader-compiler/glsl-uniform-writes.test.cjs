'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { uniformMembers, shadowWrittenUniforms } = require('./glsl-uniform-writes.cjs');

const UBO = `uniform Constant {
    vec4 twistScale;
    highp vec4 tintColor;
    float cutout;
    vec4 bones[4];
  };`;

test('uniformMembers reads plain block members, skipping arrays and the header', () => {
  assert.deepStrictEqual([...uniformMembers(UBO)], [['twistScale', 'vec4'], ['tintColor', 'vec4'], ['cutout', 'float']]);
});

test('RFX4_Tornado: a written uniform becomes a local copy for the whole body', () => {
  const body = 'twistScale = pow(twistScale, vec4(0.4545));\nfloat h = (p.y + twistScale.w) * twistScale.y;';
  const out = shadowWrittenUniforms(body, UBO);
  assert.strictEqual(out, 'vec4 twistScale_rw = twistScale;\ntwistScale_rw = pow(twistScale_rw, vec4(0.4545));\nfloat h = (p.y + twistScale_rw.w) * twistScale_rw.y;');
});

test('a local that shadows the uniform (remapped Unity name) is left alone', () => {
  const body = 'vec4 tintColor = tintColor * v_color;\ntintColor.a = clamp(tintColor.a, 0.0, 1.0);\nfloat cutout = 0.5; cutout *= 2.0;';
  assert.strictEqual(shadowWrittenUniforms(body, UBO), body);
});

test('compound, swizzle and increment writes are detected; reads and comparisons are not', () => {
  assert.match(shadowWrittenUniforms('cutout *= 2.0;', UBO), /^float cutout_rw = cutout;/);
  assert.match(shadowWrittenUniforms('tintColor.rgb = vec3(1.0);', UBO), /^vec4 tintColor_rw = tintColor;/);
  assert.match(shadowWrittenUniforms('cutout++;', UBO), /^float cutout_rw = cutout;/);
  const readOnly = 'if (cutout == 1.0) c = tintColor * cutout; o.cutout = 1.0;';
  assert.strictEqual(shadowWrittenUniforms(readOnly, UBO), readOnly);
});

test('HLSL float/half suffixes are stripped; identifiers and hex literals are kept', () => {
  const { lowerHlslToGlsl } = require('./unity-semantic-lowering.cjs');
  const out = lowerHlslToGlsl('float a = 2.0f * b; float c = 0.5h; float g = 1e-3f; float k = 2f; float uv2f = 1.0; int h = 0x1f;');
  assert.strictEqual(out, 'float a = 2.0 * b; float c = 0.5; float g = 1e-3; float k = 2.0; float uv2f = 1.0; int h = 0x1f;');
});
