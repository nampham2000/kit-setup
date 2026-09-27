'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  findReservedIdentifiers,
  renameReservedIdentifiers,
  renameReservedInEffect,
} = require('./glsl-reserved-identifiers.cjs');
const { validateCceffectStructure } = require('./shader-validator.cjs');

// Shape of the TextMeshPro TMP_SDF.shader vertex function after lowering (pixel_t output;).
const TMP_LIKE_EFFECT = `CCEffect %{
  techniques:
  - passes:
    - vert: vs:vert
      frag: fs:frag
}%

CCProgram vs %{
  precision highp float;
  #include <builtin/uniforms/cc-global>
  #include <common/common-define>
  in vec3 a_position;
  out vec4 v_color;
  struct pixel_t { vec4 position; vec4 color; };
  // output is written below
  vec4 vert () {
    pixel_t output;
    output.position = cc_matViewProj * vec4(a_position, 1.0);
    output.color = vec4(1.0);
    v_color = output.color;
    return output.position;
  }
}%

CCProgram fs %{
  precision highp float;
  in vec4 v_color;
  vec4 filter (vec4 c) { return c; }
  vec4 frag () { return filter(v_color); }
}%
`;

test('reserved words used as names are found; comments and #include paths are not', () => {
  assert.deepEqual(findReservedIdentifiers('pixel_t output; // input\n#include <common/common-define>\n'), ['output']);
  assert.deepEqual(findReservedIdentifiers('float half_width = 1.0;'), []);
});

test('renames every occurrence consistently and avoids collisions', () => {
  const { code, renamed } = renameReservedIdentifiers('float output_ = 1.0; vec4 output; output.x = output_;');
  assert.deepEqual(renamed, { output: 'output_1' });
  assert.equal(code, 'float output_ = 1.0; vec4 output_1; output_1.x = output_;');
});

test('effect pass rewrites only CCProgram code, and the validator accepts the result', () => {
  const before = validateCceffectStructure(TMP_LIKE_EFFECT);
  assert.ok(before.errors.some(e => e.includes('EFX2402_RESERVED_IDENTIFIER') && e.includes("'output'")));
  assert.ok(before.errors.some(e => e.includes("'filter'")));

  const { text, renamedByProgram } = renameReservedInEffect(TMP_LIKE_EFFECT);
  assert.deepEqual(renamedByProgram, { vs: { output: 'output_' }, fs: { filter: 'filter_' } });
  assert.match(text, /pixel_t output_;/);
  assert.match(text, /return output_\.position;/);
  assert.match(text, /\/\/ output is written below/);
  assert.match(text, /#include <common\/common-define>/);
  assert.deepEqual(findReservedIdentifiers(text), []);
  const after = validateCceffectStructure(text);
  assert.ok(!after.errors.some(e => e.includes('EFX2402_RESERVED_IDENTIFIER')));
});

test('qualifier/type-like reserved words are reported, not silently renamed', () => {
  const { renamed } = renameReservedIdentifiers('static float x; half y;');
  assert.deepEqual(renamed, {});
  assert.deepEqual(findReservedIdentifiers('static float x; half y;'), ['half', 'static']);
});
