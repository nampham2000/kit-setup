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

test('RFX4_CutoutBorder helper: CRLF lines are rewritten; an int call argument stays int', () => {
  const src = 'vec3 ShadeCustomLights(vec4 vertex, vec3 normal, int lightCount)\r\n{\r\n\t\t\tvec3 worldPos = (cc_matWorld * vertex);\r\n\t\t\treturn worldPos;\r\n}\r\nvoid main() {\r\n  int RFX4_LightCount;\r\n  vec3 finalLight = ShadeCustomLights(vec4(a_position, 1.0), a_normal, RFX4_LightCount);\r\n}';
  const out = glslImplicitConversions(src);
  assert.match(out, /vec3 worldPos = \(\(cc_matWorld \* vertex\)\)\.xyz;\r\n/);
  assert.match(out, /ShadeCustomLights\(vec4\(a_position, 1\.0\), a_normal, RFX4_LightCount\);/);
});

test('RFX4_ParallaxDecal: max(scalar literal, vec) broadcasts, also in a return', () => {
  const out = glslImplicitConversions('vec4 f() {\n  vec4 col;\n  vec4 a = max(col, 0.5);\n  return max(0.00001, col);\n}');
  assert.match(out, /vec4 a = max\(col, vec4\(0\.5\)\);/);
  assert.match(out, /return max\(vec4\(0\.00001\), col\);/);
});

test('RFX4_ParallaxDecal: subscripts in a capped loop use the loop index (ES 1.0 constant-index rule)', () => {
  const out = glslImplicitConversions('void f() {\n  int idx;\n  for (idx = 0; idx < lightCount; idx++) {\n    if (lights[idx].w > 0.5) a += lights[ idx ].rgb * float(idx);\n  }\n  b = lights[idx].w;\n}');
  assert.match(out, /if \(lights\[idx_es\]\.w > 0\.5\)/);
  assert.match(out, /lights\[idx_es\]\.rgb \* float\(idx\)/);
  assert.match(out, /\n  b = lights\[idx\]\.w;/, 'subscripts after the loop are untouched');
});

test('RFX4_CutoutBorder: compound vec4 into .rgb, products, one-line if/else', () => {
  const src = 'vec4 frag () {\n  vec4 c;\n  if (c.a < cutoff) c.rgb += borderColor;\n  else c.rgb += CCDecodeColorSample(texture2D(emissionTex, v_uv2)) * emissionColor;\n  return c;\n}\n  uniform Constant { vec4 borderColor; vec4 emissionColor; float cutoff; };';
  const out = glslImplicitConversions(src);
  assert.match(out, /if \(c\.a < cutoff\) c\.rgb \+= \(borderColor\)\.xyz;/);
  assert.match(out, /else c\.rgb \+= \(CCDecodeColorSample\(texture2D\(emissionTex, v_uv2\)\) \* emissionColor\)\.xyz;/);
});

test('unchanged statements keep their exact spacing', () => {
  const src = 'void f() {\n  float a=b*2.0;\n  vec3 x  =  y.xyz;\n}';
  assert.equal(glslImplicitConversions(src), src);
});
