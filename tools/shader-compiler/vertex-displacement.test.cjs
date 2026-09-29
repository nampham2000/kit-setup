'use strict';

// KriptoFX RFX4_Tornado: `v.vertex.x += ...` then `o.vertex = UnityObjectToClipPos(v.vertex)`. The read
// was lowered to the untouched attribute, so the twist displacement never reached the clip position.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { transpileShaderFile } = require('./unity-shader-compiler.cjs');

const shader = (body, ret) => `Shader "Test/Displace" {
  Properties { _Amount("Amount", Float) = 1 }
  SubShader { Pass {
    CGPROGRAM
    #pragma vertex vert
    #pragma fragment frag
    #include "UnityCG.cginc"
    float _Amount;
    struct appdata_t { float4 vertex : POSITION; float3 normal : NORMAL; };
    struct v2f { float4 vertex : SV_POSITION; };
    v2f vert (appdata_t v) { v2f o; ${body} ${ret} return o; }
    half4 frag (v2f i) : SV_Target { return half4(1,1,1,1); }
    ENDCG
  } }
}`;

function transpile(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-displacement-'));
  const file = path.join(dir, 'Displace.shader');
  fs.writeFileSync(file, text);
  const code = transpileShaderFile(file, null, { dryRun: true }).effectCode;
  return code.slice(code.indexOf('vec4 vert'), code.indexOf('CCProgram fs'));
}

test('the clip position reads the displaced object-space vertex', () => {
  const vs = transpile(shader('float3 wpos = v.vertex.xyz; v.vertex.x += wpos.y * _Amount; v.vertex.xz += v.normal.xz;',
    'o.vertex = UnityObjectToClipPos(v.vertex);'));
  assert.match(vs, /vec4 unityVertexOS = pos;/);
  assert.match(vs, /unityVertexOS\.x \+=/);
  assert.match(vs, /cc_matViewProj \* cc_matWorld \* vec4\(\(?unityVertexOS\)?\.xyz, 1\.0\)/);
  assert.doesNotMatch(vs, /\bpos\.x \+=/);
});

test('without an explicit clip write the default projection uses the displaced vertex', () => {
  const vs = transpile(shader('v.vertex.y += _Amount;', ''));
  assert.match(vs, /pos = unityVertexOS;\s*\n\s*return cc_matViewProj \* cc_matWorld \* pos;/);
});

test('a vertex program that never writes the vertex keeps reading the attribute', () => {
  const vs = transpile(shader('', 'o.vertex = UnityObjectToClipPos(v.vertex);'));
  assert.doesNotMatch(vs, /unityVertexOS/);
});
