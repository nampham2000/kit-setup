'use strict';

// TCP2 Hybrid Shader 2 (mesh-particle port) in a linear Unity project: the sRGB _BaseMap is decoded on
// sampling, lit in linear space and `half4(color, alpha)` is encoded into the 8-bit sRGB target.
// Cocos' `legacy/output` never encodes, so a template that linearizes and writes through it renders
// texture^2 (dark and oversaturated). These checks pin the template to the exact
// decode -> light -> encode chain while leaving the lighting terms in linear space.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { analyzeEffect } = require('./shader-compiler/glsl-static-analyzer.cjs');

const TEMPLATE = path.join(__dirname, 'unity-cocos-port', 'tcp2-hybrid-particle.effect');

function fragmentProgram() {
  const text = fs.readFileSync(TEMPLATE, 'utf8');
  const start = text.indexOf('CCProgram tcp2-particle-fs');
  assert.ok(start >= 0, 'tcp2-particle-fs program is missing');
  return text.slice(start);
}

// JS mirror of the template's piecewise helpers (IEC 61966-2-1, as Unity's hardware sRGB path).
const decode = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const encode = c => {
  const x = Math.min(1, Math.max(0, c));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
};

test('TCP2 particle fragment program is statically compile-clean', () => {
  // The vertex program is scoped to the fragment here: the analyzer is not preprocessor-aware and
  // flags its #if-exclusive locals and the particle-common uniforms (scale, frameTile_velLenScale).
  const result = analyzeEffect(fs.readFileSync(TEMPLATE, 'utf8'));
  const fragment = result.diagnostics.filter(item => item.program === 'tcp2-particle-fs');
  assert.deepEqual(fragment, [], fragment.map(item => `${item.code}: ${item.message}`).join('\n'));
});

test('TCP2 particle template encodes its linear lighting result instead of writing it raw', () => {
  const fragment = fragmentProgram();
  assert.match(fragment, /#include <legacy\/output-standard>/);
  assert.doesNotMatch(fragment, /#include <legacy\/output>/);
  assert.match(fragment, /texColor\.rgb = unityDecodeSRGB\(texColor\.rgb\);/);
  assert.doesNotMatch(fragment, /texColor\.rgb = SRGBToLinear\(texColor\.rgb\)/);
  // Lighting stays linear; only the summed result is encoded, once.
  assert.match(fragment, /vec3 lit = direct \+ indirect \+ rimContribution \+ specular \+ emissive\.rgb;/);
  // output-standard applies LinearToSRGB (sqrt); feeding SRGBToLinear(x) (x*x) keeps x exact.
  assert.match(fragment, /CCFragOutput\(vec4\(SRGBToLinear\(unityEncodeSRGB\(lit\)\), baseColor\.a\)\)/);
  assert.equal(fragment.match(/CCFragOutput\(/g).length, 1, 'every return path must go through the encode');
  assert.match(fragment, /pow\(\(c \+ 0\.055\) \/ 1\.055, vec3\(2\.4\)\), step\(vec3\(0\.04045\), c\)/);
  assert.match(fragment, /1\.055 \* pow\(c, vec3\(1\.0 \/ 2\.4\)\) - 0\.055, step\(vec3\(0\.0031308\), c\)/);
});

test('unlit-equivalent TCP2 terms return the source texel (Unity linear-project parity)', () => {
  // highlight = white, main light = white, no ambient/rim/specular/emission: Unity writes
  // encode(decode(texel) * 1) into the sRGB target, which is the texel itself.
  for (let byte = 0; byte <= 255; byte += 1) {
    const texel = byte / 255;
    const shown = encode(decode(texel) * 1.0 * 1.0);
    assert.ok(Math.abs(shown - texel) < 1e-9, `texel ${byte} rendered as ${shown * 255}`);
    // The old template wrote the linear value unencoded: visibly darker for mid tones.
    if (byte === 128) assert.ok(decode(texel) * 255 < 60);
  }
  // The TCP2 default shadow tint (0.2 sRGB, linearized on upload) is applied in linear space.
  const lit = decode(0.5) * decode(0.2);
  assert.ok(Math.abs(encode(lit) * 255 - 20.18) < 0.05, `shadowed mid-grey rendered as ${encode(lit) * 255}`);
  // Encoding each factor instead (gamma-space lighting) would give 0.5 * 0.2 * 255 = 25.5.
  assert.ok(Math.abs(encode(lit) * 255 - 25.5) > 5);
});
