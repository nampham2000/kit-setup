'use strict';

// URP Unlit in a linear Unity project: sRGB _BaseMap is decoded on sampling, multiplied by the
// linearized _BaseColor and encoded into the 8-bit sRGB target. Cocos' `legacy/output` never
// encodes, so a template that linearizes and writes through it renders texture^2 (dark and
// oversaturated). These checks pin the template to the exact decode -> multiply -> encode chain.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const TEMPLATE = path.join(__dirname, 'unity-cocos-port', 'urp-unlit.effect');

function fragmentProgram() {
  const text = fs.readFileSync(TEMPLATE, 'utf8');
  const start = text.indexOf('CCProgram urp-unlit-fs');
  assert.ok(start >= 0, 'urp-unlit-fs program is missing');
  return text.slice(start);
}

// JS mirror of the template's piecewise helpers (IEC 61966-2-1, as Unity's hardware sRGB path).
const decode = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const encode = c => {
  const x = Math.min(1, Math.max(0, c));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
};

test('URP Unlit template encodes its linear result instead of writing it raw', () => {
  const fragment = fragmentProgram();
  assert.match(fragment, /#include <legacy\/output-standard>/);
  assert.doesNotMatch(fragment, /#include <legacy\/output>/);
  assert.match(fragment, /color\.rgb = unityDecodeSRGB\(color\.rgb\);/);
  // output-standard applies LinearToSRGB (sqrt); feeding SRGBToLinear(x) (x*x) keeps x exact.
  assert.match(fragment, /CCFragOutput\(vec4\(SRGBToLinear\(unityEncodeSRGB\(color\.rgb\)\), color\.a\)\)/);
  assert.match(fragment, /pow\(\(c \+ 0\.055\) \/ 1\.055, vec3\(2\.4\)\), step\(vec3\(0\.04045\), c\)/);
  assert.match(fragment, /1\.055 \* pow\(c, vec3\(1\.0 \/ 2\.4\)\) - 0\.055, step\(vec3\(0\.0031308\), c\)/);
});

test('decode -> white base color -> encode returns the source texel (Unity URP Unlit parity)', () => {
  for (let byte = 0; byte <= 255; byte += 1) {
    const texel = byte / 255;
    const shown = encode(decode(texel) * 1.0);
    assert.ok(Math.abs(shown - texel) < 1e-9, `texel ${byte} rendered as ${shown * 255}`);
    // The old template wrote decode(texel) without encoding: visibly darker for mid tones.
    if (byte === 128) assert.ok(decode(texel) * 255 < 60);
  }
});
