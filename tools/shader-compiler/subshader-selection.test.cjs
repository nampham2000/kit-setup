'use strict';

// KriptoFX RFX4 portal shaders (Realistic Effects Pack v4, Built-in project): the first SubShader is
// `SubShader { UsePass "LegacyPreview/URP/OPAQUE" }`, a URP shim the Built-in project does not contain,
// so Unity renders the second SubShader. Its state lives at SubShader or Category level.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { transpileShaderFile } = require('./unity-shader-compiler.cjs');
const { parseShaderLab } = require('./shaderlab-parser.cjs');

const PROGRAM = `
      CGPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      #include "UnityCG.cginc"
      float4 _TintColor;
      struct appdata { float4 vertex : POSITION; };
      struct v2f { float4 vertex : SV_POSITION; };
      v2f vert (appdata v) { v2f o; o.vertex = UnityObjectToClipPos(v.vertex); return o; }
      half4 frag (v2f i) : SV_Target { return _TintColor; }
      ENDCG`;

const MASK = `Shader "KriptoFX/RFX4/Portal/PortalMask" {
  Properties { _TintColor("Tint", Color) = (1,1,1,1) }
  SubShader { UsePass "LegacyPreview/URP/OPAQUE" }
  SubShader {
    Tags { "RenderType" = "Tranperent" "Queue" = "Geometry-100" }
    ColorMask 0
    ZWrite off
    Stencil { Ref 2 Comp always Pass replace }
    Pass {${PROGRAM}
    }
  }
}`;

const SKY = `Shader "KriptoFX/RFX4/Portal/PortalSky" {
  Properties { _TintColor("Tint", Color) = (1,1,1,1) }
  SubShader { UsePass "LegacyPreview/URP/EFFECT" }
  Category {
    Tags { "Queue" = "Transparent-1" "RenderType" = "Transparent" }
    Blend SrcAlpha OneMinusSrcAlpha
    Cull Off
    ZWrite Off
    SubShader {
      Stencil { Ref 2 Comp Equal Pass Keep }
      Pass {${PROGRAM}
      }
    }
  }
}`;

const SHIM = `Shader "LegacyPreview/URP" {
  SubShader { Pass { Name "OPAQUE"${PROGRAM}
  } }
}`;

function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subshader-selection-'));
  fs.mkdirSync(path.join(root, 'ProjectSettings'));
  fs.mkdirSync(path.join(root, 'Assets'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, 'Assets', name), text);
  return root;
}

const header = (code) => code.slice(0, code.indexOf('}%'));

test('a UsePass-only SubShader into a shader the project lacks is skipped', () => {
  const root = project({ 'PortalMask.shader': MASK });
  const { docIR, effectCode } = transpileShaderFile(path.join(root, 'Assets', 'PortalMask.shader'), null, { dryRun: true });
  assert.deepEqual(docIR.unresolvedUsePasses, ['LegacyPreview/URP/OPAQUE']);
  const yaml = header(effectCode);
  assert.match(yaml, /depthWrite: false/);
  assert.match(yaml, /stencilTest: true/);
  assert.match(yaml, /stencilPassOpFront: replace/);
  assert.match(yaml, /blendColorMask: 0/, 'ColorMask 0 writes no colour');
  assert.match(effectCode, /tintColor/, 'the real program is transpiled, not an empty stub');
});

test('a resolvable UsePass keeps the first SubShader, as Unity does', () => {
  const root = project({ 'PortalMask.shader': MASK, 'LegacyPreview.shader': SHIM });
  const { docIR, effectCode } = transpileShaderFile(path.join(root, 'Assets', 'PortalMask.shader'), null, { dryRun: true });
  assert.deepEqual(docIR.unresolvedUsePasses, []);
  assert.doesNotMatch(header(effectCode), /stencilTest/);
});

test('Category render state and Tags reach the SubShaders it wraps', () => {
  const doc = parseShaderLab(SKY, 'PortalSky.shader');
  const sub = doc.subShaders[1];
  assert.equal(sub.tags.Queue, 'Transparent-1');
  const state = sub.passes[0].renderState;
  assert.equal(state.zWrite, false);
  assert.equal(state.cull, 'none');
  assert.equal(state.blend?.enabled, true);
  assert.equal(state.stencil?.comp, 'equal');

  const root = project({ 'PortalSky.shader': SKY });
  const yaml = header(transpileShaderFile(path.join(root, 'Assets', 'PortalSky.shader'), null, { dryRun: true }).effectCode);
  assert.match(yaml, /name: transparent/);
  assert.match(yaml, /cullMode: none/);
  assert.match(yaml, /depthWrite: false/);
  assert.match(yaml, /stencilFuncFront: equal/);
});
