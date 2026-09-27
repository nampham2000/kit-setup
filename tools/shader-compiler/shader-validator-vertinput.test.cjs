'use strict';

// Hand-written effects that call CCVertInput(StandardVertInput) with only legacy/input used to
// pass static validation and then fail in the editor with EFX2406 "'CCVertInput' : no matching
// overloaded function found" (Screw Out Factory ScrewOutline/ScrewGlowOverlay, 2026-09-26).
const assert = require('node:assert/strict');
const test = require('node:test');
const { validateCceffectStructure } = require('./shader-validator.cjs');

function effect(vsIncludes, vsBody) {
  return `CCEffect %{
  techniques:
  - passes:
    - vert: outline-vs:vert
      frag: outline-fs:frag
}%

CCProgram outline-vs %{
  precision highp float;
${vsIncludes.map(chunk => `  #include <${chunk}>`).join('\n')}
  #include <builtin/uniforms/cc-global>
  vec4 vert () {
${vsBody}
  }
}%

CCProgram outline-fs %{
  precision highp float;
  vec4 frag () { return vec4(1.0); }
}%
`;
}

const STANDARD_BODY = '    StandardVertInput In;\n    CCVertInput(In);\n    return cc_matViewProj * In.position;';
const VEC4_BODY = '    vec4 position;\n    CCVertInput(position);\n    return cc_matViewProj * position;';
const overloadErrors = result => result.errors.filter(e => e.includes('EFX2406_CCVERTINPUT_OVERLOAD'));

test('StandardVertInput with only legacy/input is rejected', () => {
  const errors = overloadErrors(validateCceffectStructure(effect(['legacy/input'], STANDARD_BODY)));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /only legacy\/input/);
});

test('vec4 CCVertInput with only legacy/input-standard is rejected', () => {
  assert.equal(overloadErrors(validateCceffectStructure(effect(['legacy/input-standard'], VEC4_BODY))).length, 1);
});

test('matching chunk and overload pass', () => {
  assert.deepEqual(overloadErrors(validateCceffectStructure(effect(['legacy/input-standard'], STANDARD_BODY))), []);
  assert.deepEqual(overloadErrors(validateCceffectStructure(effect(['legacy/input'], VEC4_BODY))), []);
});
