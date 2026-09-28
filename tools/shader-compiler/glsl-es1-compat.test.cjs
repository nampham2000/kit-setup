'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { promoteIntLiterals } = require('./glsl-int-literals.cjs');
const { glslEs1Compat } = require('./glsl-es1-compat.cjs');

test('int literals in float arithmetic become float literals; integer contexts stay integral', () => {
  const out = promoteIntLiterals([
    'vec4 vert () {',
    '  vec4 t = vec4(cc_time.x * 3, 2, 1.5, 0);',
    '  float a = samples[2] * 4;',
    '  for (int i = 0; i < 3; i++) { total += 1; }',
    '  int k = 5;',
    '  float b = float(k) * 2 + 1e3;',
    '  int m = ivec2(1, 2).x;',
    '  return t;',
    '}',
  ].join('\n'));
  assert.match(out, /cc_time\.x \* 3\.0, 2\.0, 1\.5, 0\.0/);
  assert.match(out, /samples\[2\] \* 4\.0/);
  assert.match(out, /for \(int i = 0; i < 3; i\+\+\)/);
  assert.match(out, /int k = 5;/);
  assert.match(out, /float\(k\) \* 2 \+ 1e3/, 'a line using an int variable is left alone');
  assert.match(out, /ivec2\(1, 2\)/);
});

test('GLSL ES 1.0 compat: preprocessor literals, transpose, scalar returns, pow literals', () => {
  const out = glslEs1Compat([
    '  #ifndef 0',
    '  x = 1.0;',
    '  #endif',
    'vec4 frag () {',
    '  mat3 r = transpose(mat3(a, b, c));',
    '  vec3 p = pow(col.rgb, 0.4545);',
    '  return 0.0;',
    '}',
  ].join('\n'));
  assert.match(out, /#if 1/);
  assert.match(out, /esTranspose\(mat3\(a, b, c\)\)/);
  assert.match(out, /mat3 esTranspose\(mat3 m\)/);
  assert.match(out, /pow\(col\.rgb, \(col\.rgb\) \* 0\.0 \+ 0\.4545\)/);
  assert.match(out, /return vec4\(0\.0\);/);
});

test('scalar return inside a CCProgram %{ }% wrapper (RFX4_PortalMask frag)', () => {
  const { glslEs1Compat } = require('./glsl-es1-compat.cjs');
  const code = 'CCProgram fs %{\n  uniform Constant {\n    vec4 noiseScale;\n  };\n  vec4 frag () {\n    return 0.0;\n  }\n}%';
  assert.match(glslEs1Compat(code), /return vec4\(0\.0\);/);
});
