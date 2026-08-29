'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { analyzeEffect } = require('../shader-compiler/glsl-static-analyzer.cjs');

test('TCP2 Hybrid Shader 2 mesh template is statically compile-clean', () => {
  const source = fs.readFileSync(path.join(__dirname, 'tcp2-hybrid-shader-2.effect'), 'utf8');
  const result = analyzeEffect(source);
  assert.equal(result.ok, true, result.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'));
  assert.match(source, /CCProgram tcp2-mesh-vs/);
  assert.match(source, /CCProgram tcp2-mesh-fs/);
  assert.match(source, /baseColor\.rgb = mix\(baseColor\.rgb, recolored, recolorMask\)/);
  assert.doesNotMatch(source, /vec3 tintedColor = baseColor\.rgb \* mainColor\.rgb/);
  assert.match(source, /float sourcePaint = baseColor\.r - max\(baseColor\.g, baseColor\.b\)/);
  assert.doesNotMatch(source, /baseColor\.rgb\s*=\s*SRGBToLinear\(baseColor\.rgb\)/,
    'sRGB color textures must not be gamma-decoded twice');
});
