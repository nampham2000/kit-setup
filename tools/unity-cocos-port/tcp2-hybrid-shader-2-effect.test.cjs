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
  assert.match(source, /baseColor\.rgb\s*=\s*SRGBToLinear\(baseColor\.rgb\)/,
    'Cocos builtin-standard explicitly decodes sRGB albedo samples before lighting');
  assert.match(source, /SRGBToLinear\(texture\(emissiveMap, v_uv\)\.rgb\)/,
    'TCP2 emission color atlases need the same sRGB decode as Unity');
  assert.match(source, /float tcp2Specular \(/);
  assert.match(source, /unitySourceRigParams\.x > 0\.5/);
});

test('TCP2 material port keeps Unity color-space and feature-toggle semantics', () => {
  const source = fs.readFileSync(path.join(__dirname, 'material-porter.js'), 'utf8');
  assert.match(source, /mainColor: unityColorToCocos\(mainColor\)/,
    'regular ShaderLab Color values must stay sRGB until Cocos linear upload');
  assert.match(source, /rimColor: unityLinearColorToCocos/,
    'TCP2 HDR rim colors are serialized linear and must be encoded for Cocos upload');
  assert.match(source, /specularColor: unityLinearColorToCocos/,
    'TCP2 HDR specular colors are serialized linear and must be encoded for Cocos upload');
  assert.match(source, /emissionEnabled\s*\?\s*emissionColor\s*:\s*\{ r: 0, g: 0, b: 0, a: 1 \}/s,
    'a dormant saved emission color must remain disabled when _UseEmission is zero');
  assert.match(source, /rimStrength: Number\(firstDefinedMaterialValue\(floats, \['_UseRim'\]/);
  assert.match(source, /specularStrength: Number\(firstDefinedMaterialValue\(floats, \['_UseSpecular'\]/);
});
