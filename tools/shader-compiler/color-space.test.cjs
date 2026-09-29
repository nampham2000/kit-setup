'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveColorSpace } = require('./unity-shader-compiler.cjs');
const { lowerHlslToGlsl } = require('./unity-semantic-lowering.cjs');

function project(activeColorSpace) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  fs.mkdirSync(path.join(root, 'ProjectSettings'));
  fs.writeFileSync(path.join(root, 'ProjectSettings', 'ProjectSettings.asset'),
    `PlayerSettings:\n  m_ObjectHideFlags: 0\n  m_ActiveColorSpace: ${activeColorSpace}\n`);
  return root;
}

test('colour space: explicit flag, then ProjectSettings m_ActiveColorSpace, then linear', () => {
  assert.deepEqual(resolveColorSpace({ colorSpace: 'gamma', unityProject: project(1) }), { colorSpace: 'gamma', source: '--color-space' });
  assert.equal(resolveColorSpace({ unityProject: project(0) }).colorSpace, 'gamma', 'KriptoFX author project is Gamma');
  assert.equal(resolveColorSpace({ unityProject: project(1) }).colorSpace, 'linear');
  assert.equal(resolveColorSpace({}).colorSpace, 'linear');
});

test('UNITY_COLORSPACE_GAMMA follows the colour space (RFX4_Tornado #ifndef branch)', () => {
  const src = '#ifndef UNITY_COLORSPACE_GAMMA\nx = pow(x, 0.4545);\n#endif';
  assert.match(lowerHlslToGlsl(src, { colorSpace: 'gamma' }), /#ifndef 1/);
  assert.match(lowerHlslToGlsl(src, {}), /#ifndef 0/);
});

// A Gamma project samples sRGB textures without hardware decoding, and the transpiler follows the
// owning project's Player Color Space when no flag is given (the porter passes none).
test('Gamma projects keep colour samples raw; Linear ones decode them', () => {
  const { transpileShaderFile } = require('./unity-shader-compiler.cjs');
  const shader = `Shader "Test/Tint" {
  Properties { _MainTex("Main", 2D) = "white" {} }
  SubShader { Pass {
    CGPROGRAM
    #pragma vertex vert
    #pragma fragment frag
    #include "UnityCG.cginc"
    sampler2D _MainTex;
    struct appdata_t { float4 vertex : POSITION; float2 texcoord : TEXCOORD0; };
    struct v2f { float4 vertex : SV_POSITION; float2 texcoord : TEXCOORD0; };
    v2f vert (appdata_t v) { v2f o; o.vertex = UnityObjectToClipPos(v.vertex); o.texcoord = v.texcoord; return o; }
    half4 frag (v2f i) : SV_Target { return tex2D(_MainTex, i.texcoord); }
    ENDCG
  } }
}`;
  const inProject = (space) => {
    const root = project(space);
    fs.mkdirSync(path.join(root, 'Assets'));
    const file = path.join(root, 'Assets', 'Tint.shader');
    fs.writeFileSync(file, shader);
    return transpileShaderFile(file, null, { dryRun: true }).effectCode;
  };
  assert.doesNotMatch(inProject(0), /CCDecodeColorSample\(/, 'Gamma project');
  assert.match(inProject(1), /CCDecodeColorSample\(/, 'Linear project');
});
