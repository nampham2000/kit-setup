'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { repairEffectText, pickPublishableEffectSync } = require('./glsl-es-typed-repair.cjs');
const { checkEffectSource } = require('./effect-compile-gate.cjs');
const { parseShaderLab } = require('./shaderlab-parser.cjs');
const { resolveCreator } = require('./cocos-effect-compiler-host.cjs');
const { findBrowser } = require('./webgl-glsl-compiler.cjs');

let gateSkip = false;
try { resolveCreator(); findBrowser(); } catch (error) { gateSkip = `gate prerequisites missing: ${error.message}`; }

// Shapes the HLSL transpiler emitted in the sample-project corpus (EFX2406 in the editor).
const BROKEN = `CCEffect %{
  techniques:
  - passes:
    - vert: vs:vert
      frag: fs:frag
      properties:
        mainTexture: { value: white }
        scrollSpeed: { value: 1.0 }
}%
CCProgram vs %{
  precision highp float;
  #include <builtin/uniforms/cc-global>
  in vec3 a_position;
  in vec4 a_color;
  out vec4 v_uv;
  out vec4 v_color;
  vec4 vert () {
    vec4 pos = vec4(a_position, 1.0);
    v_uv = vec4(a_position.xy, 0.0, 0.0);
    v_color.a = a_color.a * max(min(pos.z / 2.0, 1.0f), 0.0f);
    pos = 0.0;
    pos = vec4(a_position, 1.0);
    return pos;
  }
}%
CCProgram fs %{
  precision highp float;
  #include <builtin/uniforms/cc-global>
  in vec4 v_uv;
  in vec4 v_color;
  uniform Constant { vec4 tint; float scrollSpeed; float pad0; float pad1; float pad2; };
  uniform sampler2D mainTexture;
  float hmod (float x, float y) { float q = x / y; return x - y * (sign(q) * floor(abs(q))); }
  vec2 hmod (vec2 x, float y) { return vec2(hmod(x.x, y), hmod(x.y, y)); }
  vec4 frag () {
    vec2 uv = v_uv.xy;
    uv.y -= hmod(vec4(cc_time.x * 0.05, cc_time.x, cc_time.x * 2.0, cc_time.x * 3.0) * scrollSpeed, 1);
    vec4 prev = texture(mainTexture, v_uv).a * v_color.a;
    prev.rgb *= texture(mainTexture, uv).rgb * 2;
    return prev;
  }
}%
`;

test('typed repair makes HLSL implicit conversions explicit and keeps unknown engine constructs verbatim', () => {
  const r = repairEffectText(BROKEN);
  assert.equal(r.changed, true);
  assert.match(r.text, /min\(pos\.z \/ 2\.0, 1\.0\), 0\.0\)/, 'float suffixes dropped');
  assert.match(r.text, /pos = vec4\(0\.0\);/, 'scalar splat');
  assert.match(r.text, /texture\(mainTexture, v_uv\.xy\)/, 'HLSL tex2D(s, float4) reads .xy');
  assert.match(r.text, /vec4 prev = vec4\(texture\(mainTexture, v_uv\.xy\)\.a \* v_color\.a\);/);
  assert.match(r.text, /uv\.y -= hmod\(\(vec4\([^;]*\) \* scrollSpeed\)\.xy, 1\.0\)\.x;/, 'HLSL truncation of the fmod result');
  assert.match(r.text, /uniform Constant \{ vec4 tint; float scrollSpeed;/, 'uniform block passes through');
  const engine = repairEffectText('CCProgram vs %{\n  vec4 vert () {\n    StandardVertInput In;\n    CCVertInput(In);\n    return In.position;\n  }\n}%\n');
  assert.match(engine.text, /StandardVertInput In;\n\s*CCVertInput\(In\);/);
});

test('repaired corpus shapes pass the real compile gate; the original does not', { skip: gateSkip, timeout: 300000 }, async () => {
  const before = await checkEffectSource(BROKEN, { name: 'es-repair-before', noCache: true });
  assert.equal(before.ok, false);
  const after = await checkEffectSource(repairEffectText(BROKEN).text, { name: 'es-repair-after', noCache: true });
  assert.equal(after.ok, true, JSON.stringify(after.diagnostics, null, 1));
});

test('pickPublishableEffectSync keeps a passing effect byte-identical and repairs a failing one', { skip: gateSkip, timeout: 300000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'es-pick-'));
  try {
    const out = path.join(dir, 'assets', 'x.effect');
    const repaired = pickPublishableEffectSync(BROKEN, out);
    assert.equal(repaired.repaired, true);
    const again = pickPublishableEffectSync(repaired.text, out);
    assert.equal(again.repaired, false);
    assert.equal(again.text, repaired.text);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('case-colliding Unity property names get distinct Cocos names (no duplicated CCEffect key)', () => {
  const ir = parseShaderLab(`Shader "X" { Properties { [PerRendererData]_Cutoff ("Cutoff", Range(0,1)) = 0.0
    _cutoff ("cutoff", Range(0,1)) = 0.0 } SubShader { Pass { } } }`, 'x.shader');
  const names = ir.properties.map((p) => p.cocosName);
  assert.deepEqual(names, ['cutoff', 'cutoff2']);
});

test('soft-particle branches reading _CameraDepthTexture are removed, #else branches kept', () => {
  const { disableSoftParticles } = require('./unity-shader-compiler.cjs');
  const src = ['vec4 frag () {', '  float fade = 1.0;', '  #ifdef SOFTPARTICLES_ON', '    float z = texture(_CameraDepthTexture, uv).r;',
    '    #if FOO', '    fade = z;', '    #endif', '  #else', '    fade = 0.5;', '  #endif', '  return vec4(fade);', '}'].join('\n');
  const r = disableSoftParticles(src);
  assert.equal(r.disabled, true);
  assert.doesNotMatch(r.text, /_CameraDepthTexture|SOFTPARTICLES_ON\s*$|#if FOO/m);
  assert.match(r.text, /fade = 0\.5;/);
  assert.equal(disableSoftParticles('no depth here').disabled, false);
});

test('a .shadergraph with a generated-code dump is ported by shadergraph-codegen, not the JSON interpreter', () => {
  const { convertUnityHlslToCocosEffect } = require('../unity-hlsl-to-cocos-effect.cjs');
  const { loadCorpus } = require('./fixtures/shadergraph/build-corpus.cjs');
  const corpus = loadCorpus(path.join(__dirname, 'fixtures', 'shadergraph', 'bunny-blitz', 'corpus.json.gz'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-route-'));
  try {
    const dump = path.join(dir, 'dump');
    fs.mkdirSync(dump);
    fs.writeFileSync(path.join(dump, 'SG_VFX_SpriteUnlit.shader.txt'), corpus.SG_VFX_SpriteUnlit);
    const src = path.join(dir, 'SG_VFX_SpriteUnlit.shadergraph');
    fs.writeFileSync(src, '{}');
    const codes = [];
    const reporter = { high: (c) => codes.push(c), medium: (c) => codes.push(c), low: (c) => codes.push(c), writeCsv() {} };
    convertUnityHlslToCocosEffect({ src, out: path.join(dir, 'x.effect'), dryRun: true, shaderGraphDumpDir: dump }, reporter);
    assert.ok(codes.includes('SHADERGRAPH_GENERATED_CODE'), codes.join(','));
    assert.ok(!codes.includes('SHADERGRAPH_JSON_FALLBACK'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
