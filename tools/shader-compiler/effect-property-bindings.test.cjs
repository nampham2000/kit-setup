'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkEffectPropertyBindings } = require('./effect-property-bindings.cjs');
const { validateCceffectStructure } = require('./shader-validator.cjs');
function fixture(properties, vertex = '', extra = '') {
  return `CCEffect %{
  techniques:
  - passes:
    - vert: trail-vs:vert
      frag: color-fs:frag
      properties:
        ${properties}
}%
CCProgram trail-vs %{
${vertex}
vec4 vert(){return vec4(0.0);}
}%
CCProgram color-fs %{
uniform Color { vec4 tint; };
vec4 frag(){return tint;}
}%
${extra}`;
}
test('rejects orphan renderer property even when another unused program declares it', () => {
  const text = fixture('sourceRendererPivot: { value: [0,0,0,0] }', '', 'CCProgram unused-particle %{\nuniform Renderer {vec4 sourceRendererPivot;};\n}%');
  const result = validateCceffectStructure(text);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => /EFX3302_PROPERTY_UNIFORM_MISSING.*sourceRendererPivot/.test(e)));
});
test('selected particle pass with matching renderer uniform passes', () => {
  const result = checkEffectPropertyBindings(fixture('sourceRendererPivot: { value: [0,0,0,0] }', 'uniform Renderer {vec4 sourceRendererPivot;};'));
  assert.deepEqual(result.errors, []); assert.equal(result.complete, true);
});
test('fragment samplers and vec4 property targets are recognized', () => {
  const text = fixture('alpha: { value: 0.5, target: tint.w }\n        mainTexture: { value: white }', 'uniform sampler2D mainTexture;');
  assert.deepEqual(checkEffectPropertyBindings(text).errors, []);
});
test('resolves local nested include chunks and ignores commented declarations', () => {
  const text = fixture('amount: { value: 1 }', '#include <first>', 'CCProgram first %{\n#include <second>\n}%\nCCProgram second %{\nuniform Custom {float amount;};\n}%');
  assert.deepEqual(checkEffectPropertyBindings(text).errors, []);
  assert.equal(checkEffectPropertyBindings(fixture('amount: { value: 1 }', '// uniform Custom {float amount;};')).errors.length, 1);
});
test('unknown external chunks are explicitly unverified, not a false EFX3302', () => {
  const text = fixture('amount: { value: 1 }', '#include <vendor/custom>');
  const unknown = checkEffectPropertyBindings(text);
  assert.equal(unknown.complete, false); assert.equal(unknown.errors.length, 0);
  assert.match(unknown.warnings[0], /PROPERTY_BINDINGS_UNVERIFIED/);
  const resolved = checkEffectPropertyBindings(text, {chunkResolver: name => name === 'vendor/custom' ? 'uniform Custom {float amount;};' : null});
  assert.equal(resolved.complete, true); assert.deepEqual(resolved.errors, []);
});
test('particle-common fallback recognizes mainTiling but rejects renderer uniforms on trail ABI', () => {
  const text = fixture('mainTiling_Offset: { value: [1,1,0,0] }\n        sourceRendererPivot: { value: [0,0,0,0] }', '#include <builtin/internal/particle-common>');
  const result = checkEffectPropertyBindings(text);
  assert.equal(result.errors.length, 1); assert.match(result.errors[0], /sourceRendererPivot/);
});
test('anchors, merge keys and propertyIndex bind per pass, not across techniques', () => {
  const text = `CCEffect %{
  temporaries:
    p1: &p1
      tint: { value: [1,1,1,1] }
    p2: &p2
      <<: *p1
      sourceRendererPivot: { value: [0,0,0,0] }
  techniques:
  - passes:
    - vert: particle:vert
      frag: color:frag
      properties: *p2
    - vert: static:vert
      frag: color:frag
      propertyIndex: 0
}%
CCProgram particle %{
uniform Renderer {vec4 sourceRendererPivot;};
vec4 vert(){return vec4(0.0);}
}%
CCProgram static %{
vec4 vert(){return vec4(0.0);}
}%
CCProgram color %{
uniform Material {vec4 tint;};
vec4 frag(){return tint;}
}%`;
  const result = checkEffectPropertyBindings(text);
  assert.equal(result.errors.length, 1); assert.match(result.errors[0], /pass 1.*sourceRendererPivot/);
});
test('shared source particle effect keeps all five anchored techniques valid', () => {
  const text = fs.readFileSync(path.join(__dirname,'../unity-cocos-port/source-particle.effect'),'utf8');
  const result = checkEffectPropertyBindings(text);
  assert.deepEqual(result.errors, []); assert.equal(result.complete, true);
  assert.ok(result.checked.length > 20);
});

test('invalid propertyIndex cannot silently skip property validation', () => {
  const text = fixture('tint: {value: [1,1,1,1]}').replace('      properties:', '      propertyIndex: 12\n      properties:');
  assert.ok(checkEffectPropertyBindings(text).errors.some(e => e.includes('EFFECT_PROPERTY_INDEX_INVALID')));
});

test('truthy macros may have values other than one; overlapping branches still fail', () => {
  const text = fixture('tint: {value: [1,1,1,1]}').replace('vec4 frag(){return tint;}', `vec4 frag(){
#if MODE
  vec4 result=tint;
#endif
#if MODE != 1
  vec4 result=tint*2.0;
#endif
  return result;
}`);
  assert.ok(validateCceffectStructure(text).errors.some(e => e.includes('GLSL_DUPLICATE_LOCAL')));
});
test('exclusive preprocessor branches may declare the same local', () => {
  const text=fixture('tint: {value: [1,1,1,1]}').replace('vec4 frag(){return tint;}', `vec4 frag(){
#if FIRST
  vec4 result=tint;
#elif SECOND
  vec4 result=tint*2.0;
#else
  vec4 result=tint*3.0;
#endif
  return result;
}`);
  assert.ok(validateCceffectStructure(text).errors.every(e=>!e.includes('GLSL_DUPLICATE_LOCAL')));
  const invalid=text.replace('#elif SECOND','#endif\n#if SECOND');
  assert.ok(validateCceffectStructure(invalid).errors.some(e=>e.includes('GLSL_DUPLICATE_LOCAL')));
});
test('native particle chunk declarations are visible to scope analysis', () => {
  const text=fixture('mainTiling_Offset: {value: [1,1,0,0]}', '#include <builtin/internal/particle-common>')
    .replace('vec4 vert(){return vec4(0.0);}','vec4 vert(){return vec4(mainTiling_Offset.xy,0.0,1.0);}');
  assert.ok(validateCceffectStructure(text).errors.every(e=>!e.includes('GLSL_UNDECLARED_BASE')));
});
test('independent opposite macro guards and comma declarations are legal', () => {
  const text=fixture('tint: {value: [1,1,1,1]}').replace('vec4 frag(){return tint;}', `vec4 frag(){
  vec3 s=sin(tint.xyz),c=cos(tint.xyz);
#if !INSTANCED
  vec4 result=vec4(s*c,1.0);
#endif
#if INSTANCED
  vec4 result=tint;
#endif
  return result;
}`);
  assert.equal(validateCceffectStructure(text).valid,true,validateCceffectStructure(text).errors.join('\n'));
  assert.equal(validateCceffectStructure(text.replace(/\n/g,'\r\n')).valid,true,'Windows CRLF must preserve macro guards');
});
