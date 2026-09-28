'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Program } = require('./shadergraph/sg-program.cjs');
const { lowerSection, createLoweringContext, gradientFunction } = require('./shadergraph/sg-lower.cjs');
const { generateEffect } = require('./shadergraph/sg-emit.cjs');
const { run, main } = require('./shadergraph-codegen.cjs');
const { loadCorpus } = require('./fixtures/shadergraph/build-corpus.cjs');
const { checkEffectPropertyBindings } = require('./effect-property-bindings.cjs');
const { resolveCreator } = require('./cocos-effect-compiler-host.cjs');
const { findBrowser } = require('./webgl-glsl-compiler.cjs');

const FIXTURE = path.join(__dirname, 'fixtures', 'shadergraph', 'bunny-blitz');
let gateSkip = false;
try { resolveCreator(); findBrowser(); } catch (error) { gateSkip = `gate prerequisites missing: ${error.message}`; }

const typed = (code, globals = []) => new Program({ globals }).transform(code);

test('typed lowering inserts the implicit HLSL conversions GLSL ES rejects', () => {
  const out = typed(`
    void OneMinus(float In, out float Out) { Out = 1 - In; }
    void Branch(float Predicate, float T, float F, out float Out) { Out = Predicate ? T : F; }
    void Blend(vec3 Base, vec3 B, out vec3 Out) { vec3 r1 = 2.0 * Base * B; vec3 r2 = 1.0 - Base; Out = Base < 0.5 ? r1 : r2; }
    void StepV(vec4 E, float In, out vec4 Out) { Out = step(E, In); }
    void Splat(float t, out vec3 Out) { Out = (t.xxx); }
    void Trunc(vec4 w, out vec3 Out) { Out = w; }
    void Fmod(float a, out float Out) { Out = a % 2; }
  `);
  assert.match(out, /Out = 1\.0 - In;/);
  assert.match(out, /Out = \(Predicate != 0\.0\) \? T : F;/);
  assert.match(out, /Out = mix\(r2, r1, vec3\(lessThan\(Base, vec3\(0\.5\)\)\)\);/);
  assert.match(out, /Out = step\(E, vec4\(In\)\);/);
  assert.match(out, /Out = \(vec3\(t\)\);/);
  assert.match(out, /Out = w\.xyz;/);
  assert.match(out, /Out = sgFmod\(a, 2\.0\);/);
});

test('row-major HLSL matrices: constructors keep order, mul(a, b) becomes (b * a)', () => {
  const out = typed('void Rot(vec2 UV, float R, out vec2 Out) { mat2 m = mat2(cos(R), -sin(R), sin(R), cos(R)); Out = mul(UV, m); }');
  assert.match(out, /mat2 m = mat2\(cos\(R\), -sin\(R\), sin\(R\), cos\(R\)\);/);
  assert.match(out, /Out = \(m \* UV\);/);
});

test('out arguments of a different type go through exact-type temporaries', () => {
  const out = typed(`
    void GetFlag(out bool isDead) { isDead = true; }
    void Use(out float r) { float flag; GetFlag(flag); r = flag; }
  `);
  assert.match(out, /bool sgOut\d+;\n\s*GetFlag\(sgOut\d+\);\n\s*flag = float\(sgOut\d+\);/);
});

test('(Struct)0 zero-initialisation becomes explicit field zeros; loop attributes and literal suffixes vanish', () => {
  const out = typed(`
    struct S { vec3 A; float B; };
    S F() { S s = (S)0; [unroll] for (int i = 0; i < 2; i++) { s.B += 1.0f; } return s; }
  `);
  assert.match(out, /S s;\n\s*s\.A = vec3\(0\.0\);\n\s*s\.B = 0\.0;/);
  assert.doesNotMatch(out, /unroll|1\.0f/);
});

test('property uniforms replace unshadowed identifiers only', () => {
  const p = new Program({ globals: [['_Speed', 'float']], globalExprs: [['_Speed', { text: 'sgPack0.y', type: 'float' }]] });
  const out = p.transform('void f(out float o) { o = _Speed * 2; } void g(float _Speed, out float o) { o = _Speed; }');
  assert.match(out, /o = sgPack0\.y \* 2\.0;/);
  assert.match(out, /void g\(float _Speed, out float o\) \{\n\s*o = _Speed;/);
});

test('texture structs are resolved at compile time (ES 1.00 cannot keep samplers in local structs)', () => {
  const pass = { materialProps: [{ name: '_MainTex_ST' }, { name: '_MainTex_TexelSize' }], textures: [{ kind: 'TEXTURE2D', name: '_MainTex' }] };
  const ctx = createLoweringContext(pass);
  const out = lowerSection(`
void SG_Sub_float(UnityTexture2D _Tex, UnitySamplerState _SS, float2 _UV, out float4 Out)
{
Out = SAMPLE_TEXTURE2D(_Tex.tex, _SS.samplerstate, _Tex.GetTransformedUV(_UV)) * _Tex.texelSize.x;
}
void F(float2 uv, out float4 o)
{
UnityTexture2D t = UnityBuildTexture2DStruct(_MainTex);
float4 a = SAMPLE_TEXTURE2D(t.tex, t.samplerstate, t.GetTransformedUV(uv));
float4 b = SAMPLE_TEXTURE2D_LOD(UnityBuildTexture2DStructNoScale(_MainTex).tex, UnityBuildSamplerStateStruct(SamplerState_Linear_Clamp).samplerstate, UnityBuildTexture2DStructNoScale(_MainTex).GetTransformedUV(uv), 0);
SG_Sub_float(t, UnityBuildSamplerStateStruct(SamplerState_Linear_Repeat), uv, o);
o += a + b;
}`, ctx);
  assert.doesNotMatch(out, /UnityTexture2D|UnityBuild|samplerstate|GetTransformedUV|SAMPLE_TEXTURE2D/);
  assert.match(out, /void SG_Sub_float\(sampler2D _Tex, vec4 _Tex_sgST, vec4 _Tex_sgTexelSize, vec2 _UV, out vec4 Out\)/);
  assert.match(out, /texture\(_Tex, sgTransformUV\(_Tex_sgST, _UV\)\) \* _Tex_sgTexelSize\.x/);
  assert.match(out, /texture\(_MainTex, sgTransformUV\(_MainTex_ST, uv\)\)/);
  assert.match(out, /sgTexLod\(_MainTex, \(uv\), 0\)/);
  assert.match(out, /SG_Sub_float\(_MainTex, _MainTex_ST, _MainTex_TexelSize, uv, o\)/);
  assert.ok(ctx.diagnostics.some((d) => d.code === 'SG_SAMPLER_STATE'));
});

test('gradient literals become specialised functions without array constructors', () => {
  const ctx = createLoweringContext({ materialProps: [], textures: [] });
  const out = lowerSection('void F(float t, out float4 o) { Unity_SampleGradientV1_float(NewGradient(0, 2, 2, float4(1, 0, 0, 0),float4(0, 0, 1, 1),float4(0, 0, 0, 0),float4(0, 0, 0, 0),float4(0, 0, 0, 0),float4(0, 0, 0, 0),float4(0, 0, 0, 0),float4(0, 0, 0, 0), float2(1, 0),float2(1, 1),float2(0, 0),float2(0, 0),float2(0, 0),float2(0, 0),float2(0, 0),float2(0, 0)), t, o); }', ctx);
  assert.match(out, /sgGradient0\(t, o\)/);
  const fn = gradientFunction(ctx.gradients[0]);
  assert.doesNotMatch(fn, /\[\]|NewGradient|Gradient\s/);
  assert.match(fn, /vec3 color = vec3\(1\.0, 0\.0, 0\.0\);/);
});

test('graphs that are not renderer materials or use unsupported targets get explicit dispositions', () => {
  const corpus = loadCorpus(path.join(FIXTURE, 'corpus.json.gz'));
  assert.equal(generateEffect(corpus.LayerSwitch_Pass, { name: 'LayerSwitch_Pass' }).disposition, 'not-renderer-material');
  assert.equal(generateEffect(corpus.GlowMaskUI, { name: 'GlowMaskUI' }).disposition, 'not-renderer-material');
  assert.equal(generateEffect(corpus['TMP_SDF-HDRP LIT'], { name: 'x' }).disposition, 'unsupported-pipeline');
  const lit = generateEffect(corpus['TMP_SDF-URP Lit'], { name: 'x' });
  assert.equal(lit.disposition, 'unsupported-target');
  assert.ok(lit.diagnostics.some((d) => d.severity === 'high'));
});

test('Bunny Blitz corpus: every renderer graph generates, binds its properties and passes the compile gate', { skip: gateSkip, timeout: 900000 }, async () => {
  const corpus = loadCorpus(path.join(FIXTURE, 'corpus.json.gz'));
  const names = Object.keys(corpus);
  assert.equal(names.length, 69);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codegen-'));
  try {
    const { results, gate } = await run({
      sources: names.map((name) => ({ name, text: corpus[name] })),
      out: path.join(out, 'assets', 'effects', 'sg'),
      unityProject: path.join(FIXTURE, 'unity'),
      overrides: path.join(FIXTURE, 'overrides.glsl'),
      skips: {
        'TMP_SDF-HDRP LIT': 'HDRP variant', 'TMP_SDF-HDRP UNLIT': 'HDRP variant', 'TMP_SDF-URP Lit': 'dormant TMP variant',
      },
    });
    assert.equal(gate.unavailable, null);
    const by = (d) => results.filter((r) => r.disposition === d).map((r) => r.name);
    const failing = results.filter((r) => !['generated', 'skipped', 'not-renderer-material'].includes(r.disposition));
    assert.deepEqual(failing.map((r) => `${r.name}: ${r.disposition} ${(r.diagnostics || []).filter((d) => d.severity === 'high').map((d) => d.message).join(' | ').slice(0, 400)}`), []);
    assert.equal(by('generated').length, 64);
    assert.deepEqual(by('not-renderer-material').sort(), ['GlowMaskUI', 'LayerSwitch_Pass']);
    assert.equal(by('skipped').length, 3);
    for (const r of results.filter((x) => x.disposition === 'generated')) {
      assert.equal(r.gate.ok, true, r.name);
      assert.ok(r.gate.compiles >= 4, `${r.name}: GLSL ES 1.00 + 3.00 compiles`);
      const bindings = checkEffectPropertyBindings(r.effect);
      assert.deepEqual(bindings.errors, [], r.name);
      assert.ok(!r.diagnostics.some((d) => d.severity === 'high'), `${r.name}: ${JSON.stringify(r.diagnostics)}`);
      // every Unity material property of the graph is reachable as a Cocos property
      for (const p of r.properties) assert.match(r.effect, new RegExp(`\\n\\s+${p.cocos}: \\{`), `${r.name}.${p.unity}`);
      assert.doesNotMatch(r.effect, /\bUnity(Texture2D|SamplerState)\b|\bSAMPLE_TEXTURE|\bGetTransformedUV\b|\bNewGradient\b/, r.name);
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('CLI: --help writes nothing, generation is idempotent and --check is read-only', { skip: gateSkip, timeout: 600000 }, async () => {
  const corpus = loadCorpus(path.join(FIXTURE, 'corpus.json.gz'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cli-'));
  try {
    const src = path.join(dir, 'dump');
    fs.mkdirSync(src);
    for (const name of ['ShaderGraph_Sprite_Unlit_HDRTint', 'SG_VFX_SpriteUnlit']) fs.writeFileSync(path.join(src, `${name}.shader.txt`), corpus[name]);
    const out = path.join(dir, 'assets', 'effects', 'sg');
    const log = console.log;
    console.log = () => {};
    try {
      assert.equal(await main(['--help']), 0);
      assert.equal(fs.existsSync(out), false);
      assert.equal(await main(['--src', src, '--out', out, '--check']), 1, 'missing outputs are stale');
      assert.equal(fs.existsSync(out), false, '--check never writes');
      assert.equal(await main(['--src', src, '--out', out]), 0);
      const files = fs.readdirSync(out).sort();
      assert.deepEqual(files, ['sg-sg-vfx-spriteunlit.effect', 'sg-shadergraph-sprite-unlit-hdrtint.effect']);
      const stamp = files.map((f) => fs.statSync(path.join(out, f)).mtimeMs);
      assert.equal(await main(['--src', src, '--out', out]), 0);
      assert.deepEqual(files.map((f) => fs.statSync(path.join(out, f)).mtimeMs), stamp, 'identical output is not rewritten');
      assert.equal(await main(['--src', src, '--out', out, '--check']), 0);
      assert.equal(await main(['--src', src, '--out', out, '--bogus']), 2);
    } finally {
      console.log = log;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--latlong-cubes samples a Unity cube map through its equirect source image', () => {
  const corpus = loadCorpus(path.join(FIXTURE, 'corpus.json.gz'));
  const cube = generateEffect(corpus.SG_PortalMesh, { name: 'pm' });
  assert.match(cube.effect, /uniform samplerCube _SampleCubemap_\w+;/);
  assert.ok(cube.diagnostics.some((d) => d.code === 'SG_CUBEMAP'));
  const latlong = generateEffect(corpus.SG_PortalMesh, { name: 'pm', latlongCubes: 'all' });
  assert.match(latlong.effect, /uniform sampler2D _SampleCubemap_\w+;/);
  assert.match(latlong.effect, /sgTexLod\(_SampleCubemap_\w+, sgLatLongUV\(/);
  assert.ok(latlong.diagnostics.some((d) => d.code === 'SG_CUBEMAP_LATLONG'));
});

test('--color-space linear passes 3D output through; --vertex-color srgb decodes a_color in a linear project', () => {
  const corpus = loadCorpus(path.join(FIXTURE, 'corpus.json.gz'));
  const gamma3d = generateEffect(corpus.SmokeExplosion, { name: 'm' });
  assert.match(gamma3d.effect, /return CCFragOutput\(color\);/);
  assert.match(gamma3d.effect, /#include <legacy\/output>/);
  const linear3d = generateEffect(corpus.SmokeExplosion, { name: 'm', colorSpace: 'linear' });
  assert.doesNotMatch(linear3d.effect, /CCFragOutput|#include <legacy\/output>/);
  assert.match(linear3d.effect, /return color;/);
  const raw = generateEffect(corpus.SG_Tilemaps, { name: 't', colorSpace: 'linear' });
  assert.doesNotMatch(raw.effect, /sgSRGBToLinear\(a_color\.rgb\)/);
  const decoded = generateEffect(corpus.SG_Tilemaps, { name: 't', colorSpace: 'linear', vertexColor: 'srgb' });
  assert.match(decoded.effect, /vec4\(sgSRGBToLinear\(a_color\.rgb\), a_color\.a\)/);
  assert.match(decoded.effect, /return color;/);
});
