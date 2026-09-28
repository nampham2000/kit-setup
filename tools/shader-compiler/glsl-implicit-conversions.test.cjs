'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { glslImplicitConversions, LOOP_CAP } = require('./glsl-implicit-conversions.cjs');

test('RFX4_CutoutBorder: mat4 * vec4 assigned to vec3 is truncated', () => {
  const out = glslImplicitConversions('void f(vec4 vertex) {\n  vec3 worldPos = (cc_matWorld * vertex);\n}');
  assert.match(out, /vec3 worldPos = \(\(cc_matWorld \* vertex\)\)\.xyz;/);
});

test('RFX4_ParallaxDecal: texture into .rgb, scalar broadcast, const int from a uniform', () => {
  const src = [
    'uniform Constant { int steps; };',
    'vec4 frag () {',
    '  vec4 col;',
    '  vec3 v;',
    '  const int linearSearchSteps = steps;',
    '  v /= v.z * linearSearchSteps;',
    '  col.rgb = texture(mainTexture, uv);',
    '  vec3 light = 0.0;',
    '  const int fixedSteps = 4;',
    '  return col;',
    '}',
  ].join('\n');
  const out = glslImplicitConversions(src);
  assert.match(out, /^\s*int linearSearchSteps = steps;$/m);
  assert.match(out, /v \/= v\.z \* float\(linearSearchSteps\);/);
  assert.match(out, /col\.rgb = \(texture\(mainTexture, uv\)\)\.xyz;/);
  assert.match(out, /vec3 light = vec3\(0\.0\);/);
  assert.match(out, /const int fixedSteps = 4;/, 'literal const int stays const');
});

test('non-constant loop bounds become a capped loop with an early break', () => {
  const src = 'void f() {\n  int idx;\n  for (idx = 0; idx < lightCount; idx++) {\n    a += lights[idx].w;\n  }\n  for (int k = 0; k < 8; k++) {\n  }\n}';
  const out = glslImplicitConversions(src);
  assert.match(out, new RegExp(`for \\(int idx_es = 0; idx_es < ${LOOP_CAP}; idx_es\\+\\+\\) \\{\\nidx = idx_es; if \\(idx >= lightCount\\) break;`));
  assert.match(out, /for \(int k = 0; k < 8; k\+\+\) \{/, 'constant bounds untouched');
});

test('already-valid GLSL is unchanged', () => {
  const src = 'vec4 frag () {\n  vec3 a = texture(t, uv).rgb;\n  vec4 b = texture(t, uv);\n  float c = 1.0;\n  vec3 d = vec3(1.0);\n  return b;\n}';
  assert.equal(glslImplicitConversions(src), src);
});
