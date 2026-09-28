'use strict';
// The gate needs the installed Cocos Creator (effect compiler) and Chrome/Edge (WebGL). On a machine without them
// the gate itself fails closed; these tests skip rather than pass vacuously.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveCreator } = require('./cocos-effect-compiler-host.cjs');
const { findBrowser } = require('./webgl-glsl-compiler.cjs');
const { checkEffects, checkEffectSource } = require('./effect-compile-gate.cjs');

let skip = false;
try { resolveCreator(); findBrowser(); } catch (error) { skip = `gate prerequisites missing: ${error.message}`; }

const effect = (body, { vertBody = 'return vec4(a_position, 1.0);', extraHeader = '' } = {}) => `CCEffect %{
  techniques:
  - passes:
    - vert: vs:vert
      frag: fs:frag
      properties:
        tint: { value: [1, 1, 1, 1] }
}%
CCProgram vs %{
  precision highp float;
  #include <builtin/uniforms/cc-global>
  in vec3 a_position;
  vec4 vert () { ${vertBody} }
}%
CCProgram fs %{
  precision highp float;
  ${extraHeader}
  uniform Props { vec4 tint; };
  vec4 frag () { ${body} }
}%
`;

test('a valid effect passes both GLSL ES 1.00 and 3.00 compiles', { skip }, async () => {
  const res = await checkEffectSource(effect('return tint;'), { name: 'gate-ok', noCache: true });
  assert.equal(res.unavailable, null);
  assert.equal(res.ok, true, JSON.stringify(res.diagnostics, null, 1));
  assert.ok(res.result.effects[0].compiles >= 4, 'webgl + webgl2 for editor and off permutations');
});

test('ES 3.00-only constructs fail as EFX2406 with the offending source line', { skip }, async () => {
  const res = await checkEffectSource(effect('float w[2] = float[2](0.25, 0.75); return tint * w[1];'), { name: 'gate-array', noCache: true });
  assert.equal(res.ok, false);
  const d = res.diagnostics.find((x) => x.code === 'EFX2406' && /array constructor/.test(x.message));
  assert.ok(d, JSON.stringify(res.diagnostics, null, 1));
  assert.equal(d.api, 'webgl');
  assert.equal(d.stage, 'frag');
  assert.match(d.source, /float\[2\]/);
  assert.ok(d.effectLine > 0, 'maps back to the .effect line');
});

test('derivatives without the extension guard fail in WebGL1 (GL_OES_standard_derivatives)', { skip }, async () => {
  const bad = await checkEffectSource(effect('return tint * dFdx(tint.x);'), { name: 'gate-dfdx', noCache: true });
  assert.equal(bad.ok, false);
  assert.ok(bad.diagnostics.some((d) => /GL_OES_standard_derivatives/.test(d.message)), JSON.stringify(bad.diagnostics));
  const good = await checkEffectSource(effect('return tint * dFdx(tint.x);',
    { extraHeader: '#pragma extension([GL_OES_standard_derivatives, __VERSION__ < 300])' }), { name: 'gate-dfdx-ok', noCache: true });
  assert.equal(good.ok, true, JSON.stringify(good.diagnostics, null, 1));
});

test('struct field selection on a sampler (UnityTexture2D lowered wrong) fails', { skip }, async () => {
  const res = await checkEffectSource(effect('return texture(mainTex.tex, vec2(0.5));',
    { extraHeader: 'uniform sampler2D mainTex;' }), { name: 'gate-tex-struct', noCache: true });
  assert.equal(res.ok, false);
  assert.ok(res.diagnostics.some((d) => /field selection/.test(d.message)));
});

test('an unresolved #include is an expansion error (EFX2001)', { skip }, async () => {
  const res = await checkEffectSource(effect('return tint;', { extraHeader: '#include <does/not/exist>' }), { name: 'gate-include', noCache: true });
  assert.equal(res.ok, false);
  assert.ok(res.diagnostics.some((d) => d.code === 'EFX2001' && d.phase === 'expand'), JSON.stringify(res.diagnostics));
});

test('project-relative chunks resolve from the effect directory', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'effect-gate-'));
  try {
    fs.mkdirSync(path.join(dir, 'chunks'));
    fs.writeFileSync(path.join(dir, 'chunks', 'my-helper.chunk'), 'vec4 helperTint (vec4 c) { return c * 0.5; }\n');
    const file = path.join(dir, 'uses-chunk.effect');
    fs.writeFileSync(file, effect('return helperTint(tint);', { extraHeader: '#include "./chunks/my-helper"' }));
    const res = await checkEffects([{ file }], { noCache: true });
    assert.equal(res.ok, true, JSON.stringify(res.effects[0].diagnostics, null, 1));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing editor fails closed', async () => {
  const res = await checkEffects([{ content: effect('return tint;'), name: 'x' }], { engineRoot: path.join(os.tmpdir(), 'no-such-engine') });
  assert.equal(res.ok, false);
  assert.match(res.unavailable, /effect compiler unavailable/);
});
