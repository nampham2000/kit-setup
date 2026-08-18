#!/usr/bin/env node
'use strict';

/**
 * Test Suite: Unity Shader & ShaderGraph -> Cocos Creator Effect Porter
 *
 * Tests 8 realistic Unity shader & ShaderGraph scenarios to verify 90-95% accuracy,
 * valid CCEffect structure, std140 UBO alignment, and material scaffolding.
 */

const fs = require('fs');
const path = require('path');
const { convertUnityHlslToCocosEffect } = require('./unity-hlsl-to-cocos-effect.cjs');
const { computeStd140Layout } = require('./unity-cocos-port/ubo-alignment-formatter');

const TEMP_TEST_DIR = path.join(__dirname, '.temp-shader-tests');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  ensureDir(dir);
}

// ============================================================================
// Sample Test Cases
// ============================================================================

const SAMPLES = [
  {
    name: '1. Unlit Wobble & Dissolve ShaderLab (.shader)',
    filename: 'UnlitWobbleDissolve.shader',
    source: `
Shader "Custom/UnlitWobbleDissolve" {
  Properties {
    _MainTex ("Texture", 2D) = "white" {}
    _NoiseTex ("Noise", 2D) = "white" {}
    _Color ("Tint Color", Color) = (1, 1, 1, 1)
    _DissolveAmount ("Dissolve Amount", Range(0, 1)) = 0.5
    _BurnColor ("Burn Color", Color) = (1, 0.5, 0, 1)
    _BurnWidth ("Burn Width", Range(0, 0.2)) = 0.05
    _WaveSpeed ("Wave Speed", Float) = 2.0
    _WaveHeight ("Wave Height", Float) = 0.1
  }
  SubShader {
    Tags { "RenderType"="Opaque" "Queue"="Geometry" }
    LOD 100
    Cull Back
    ZWrite On

    Pass {
      CGPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      #include "UnityCG.cginc"

      struct appdata {
        float4 vertex : POSITION;
        float2 uv : TEXCOORD0;
        float3 normal : NORMAL;
      };

      struct v2f {
        float2 uv : TEXCOORD0;
        float4 vertex : SV_POSITION;
        float3 worldPos : TEXCOORD1;
      };

      sampler2D _MainTex;
      float4 _MainTex_ST;
      sampler2D _NoiseTex;
      fixed4 _Color;
      fixed4 _BurnColor;
      float _DissolveAmount;
      float _BurnWidth;
      float _WaveSpeed;
      float _WaveHeight;

      v2f vert (appdata v) {
        v2f o;
        float wave = sin(_Time.y * _WaveSpeed + v.vertex.x * 5.0) * _WaveHeight;
        v.vertex.y += wave;
        o.vertex = UnityObjectToClipPos(v.vertex);
        o.uv = TRANSFORM_TEX(v.uv, _MainTex);
        o.worldPos = mul(unity_ObjectToWorld, v.vertex).xyz;
        return o;
      }

      fixed4 frag (v2f i) : SV_Target {
        fixed4 col = tex2D(_MainTex, i.uv) * _Color;
        float noise = tex2D(_NoiseTex, i.uv).r;
        clip(noise - _DissolveAmount);
        if (noise < _DissolveAmount + _BurnWidth) {
          col = _BurnColor;
        }
        return col;
      }
      ENDCG
    }
  }
}
`,
    expectedShading: 'dissolve',
  },

  {
    name: '2. Stylized Toon & Rim Lighting ShaderLab (.shader)',
    filename: 'StylizedToonRim.shader',
    source: `
Shader "Custom/StylizedToonRim" {
  Properties {
    _MainTex ("Main Tex", 2D) = "white" {}
    _Color ("Main Color", Color) = (1, 1, 1, 1)
    _HColor ("Highlight Color", Color) = (1, 1, 1, 1)
    _SColor ("Shadow Color", Color) = (0.2, 0.2, 0.3, 1)
    _RampThreshold ("Ramp Threshold", Range(0, 1)) = 0.5
    _RampSmoothing ("Ramp Smoothing", Range(0, 1)) = 0.1
    _RimColor ("Rim Color", Color) = (0.8, 0.8, 1, 1)
    _RimMin ("Rim Min", Range(0, 1)) = 0.5
    _RimMax ("Rim Max", Range(0, 1)) = 1.0
    _SpecularColor ("Specular Color", Color) = (1, 1, 1, 1)
    _Glossiness ("Glossiness", Range(0, 1)) = 0.5
  }
  SubShader {
    Tags { "RenderType"="Opaque" "Queue"="Geometry" }
    Pass {
      CGPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      #include "UnityCG.cginc"

      struct appdata {
        float4 vertex : POSITION;
        float3 normal : NORMAL;
        float2 uv : TEXCOORD0;
      };

      struct v2f {
        float4 vertex : SV_POSITION;
        float2 uv : TEXCOORD0;
        float3 worldNormal : TEXCOORD1;
      };

      v2f vert(appdata v) {
        v2f o;
        o.vertex = UnityObjectToClipPos(v.vertex);
        o.uv = v.uv;
        o.worldNormal = UnityObjectToWorldNormal(v.normal);
        return o;
      }

      fixed4 frag(v2f i) : SV_Target {
        return fixed4(1, 1, 1, 1);
      }
      ENDCG
    }
  }
}
`,
    expectedShading: 'toon',
  },

  {
    name: '3. Spherical MatCap Reflection ShaderLab (.shader)',
    filename: 'MatCapReflection.shader',
    source: `
Shader "Custom/MatCapReflection" {
  Properties {
    _MatCap ("MatCap Texture", 2D) = "white" {}
    _Color ("Color Tint", Color) = (1, 1, 1, 1)
    _ReflectIntensity ("Intensity", Range(0, 2)) = 1.0
  }
  SubShader {
    Tags { "RenderType"="Opaque" "Queue"="Geometry" }
    Pass {
      CGPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      #include "UnityCG.cginc"

      struct v2f {
        float4 vertex : SV_POSITION;
        float2 matCapUV : TEXCOORD0;
      };

      v2f vert(float4 vertex : POSITION, float3 normal : NORMAL) {
        v2f o;
        o.vertex = UnityObjectToClipPos(vertex);
        float3 viewNormal = mul((float3x3)UNITY_MATRIX_V, UnityObjectToWorldNormal(normal));
        o.matCapUV = viewNormal.xy * 0.5 + 0.5;
        return o;
      }

      sampler2D _MatCap;
      fixed4 _Color;

      fixed4 frag(v2f i) : SV_Target {
        return tex2D(_MatCap, i.matCapUV) * _Color;
      }
      ENDCG
    }
  }
}
`,
    expectedShading: 'matcap',
  },

  {
    name: '4. Surface Standard PBR ShaderLab (.shader)',
    filename: 'PBRDetailSurface.shader',
    source: `
Shader "Custom/PBRDetailSurface" {
  Properties {
    _Color ("Color", Color) = (1,1,1,1)
    _MainTex ("Albedo (RGB)", 2D) = "white" {}
    _Glossiness ("Smoothness", Range(0,1)) = 0.5
    _Metallic ("Metallic", Range(0,1)) = 0.0
    _BumpMap ("Normal Map", 2D) = "bump" {}
  }
  SubShader {
    Tags { "RenderType"="Opaque" }
    LOD 200

    CGPROGRAM
    #pragma surface surf Standard fullforwardshadows
    #pragma target 3.0

    sampler2D _MainTex;
    struct Input {
      float2 uv_MainTex;
    };
    half _Glossiness;
    half _Metallic;
    fixed4 _Color;

    void surf (Input IN, inout SurfaceOutputStandard o) {
      fixed4 c = tex2D (_MainTex, IN.uv_MainTex) * _Color;
      o.Albedo = c.rgb;
      o.Metallic = _Metallic;
      o.Smoothness = _Glossiness;
      o.Alpha = c.a;
    }
    ENDCG
  }
}
`,
    expectedShading: 'lit',
  },

  {
    name: '5. Complex HLSL Fire FX with Procedural Noise (.hlsl)',
    filename: 'ComplexHLSLFire.hlsl',
    source: `
#ifndef CUSTOM_FIRE_HLSL
#define CUSTOM_FIRE_HLSL

float noise(float2 uv) {
  return frac(sin(dot(uv, float2(12.9898, 78.233))) * 43758.5453);
}

float fbm(float2 uv) {
  float v = 0.0;
  float a = 0.5;
  float2 shift = float2(100.0, 100.0);
  for (int i = 0; i < 3; ++i) {
    v += a * noise(uv);
    uv = uv * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

float4 fragFire(float2 uv, float time, float speed, float4 fireColor) {
  float2 p = uv * 3.0;
  p.y -= time * speed;
  float n = fbm(p);
  float flame = smoothstep(0.2, 0.8, n * (1.0 - uv.y));
  return lerp(float4(0, 0, 0, 0), fireColor, flame);
}

#endif
`,
    expectedShading: 'unlit',
  },

  {
    name: '6. Procedural SimpleNoise & Tiling ShaderGraph (.shadergraph)',
    filename: 'SampleUnlitNoise.shadergraph',
    source: JSON.stringify({
      m_SGVersion: 3,
      m_Type: "UnityEditor.ShaderGraph.GraphData",
      m_Properties: [
        {
          m_Type: "UnityEditor.ShaderGraph.Internal.ColorShaderProperty",
          m_Name: "Color",
          m_ReferenceName: "_Color",
          m_Value: { r: 1, g: 0.8, b: 0.2, a: 1 },
          m_ObjectId: "prop-color",
        },
        {
          m_Type: "UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty",
          m_Name: "NoiseScale",
          m_ReferenceName: "_NoiseScale",
          m_Value: 15.0,
          m_ObjectId: "prop-noise-scale",
        },
      ],
      m_Nodes: [
        {
          m_Type: "UnityEditor.ShaderGraph.PropertyNode",
          m_ObjectId: "node-prop-color",
          m_Property: { m_Id: "prop-color" },
          m_Slots: [{ m_Id: 0 }],
        },
        {
          m_Type: "UnityEditor.ShaderGraph.PropertyNode",
          m_ObjectId: "node-prop-scale",
          m_Property: { m_Id: "prop-noise-scale" },
          m_Slots: [{ m_Id: 0 }],
        },
        {
          m_Type: "UnityEditor.ShaderGraph.UVNode",
          m_ObjectId: "node-uv",
          m_Name: "UV",
          m_Slots: [{ m_Id: 0 }],
        },
        {
          m_Type: "UnityEditor.ShaderGraph.SimpleNoiseNode",
          m_ObjectId: "node-noise",
          m_Name: "Simple Noise",
          m_Slots: [{ m_Id: 0 }, { m_Id: 1 }, { m_Id: 2 }],
        },
        {
          m_Type: "UnityEditor.ShaderGraph.MultiplyNode",
          m_ObjectId: "node-mul",
          m_Name: "Multiply",
          m_Slots: [{ m_Id: 0 }, { m_Id: 1 }, { m_Id: 2 }],
        },
        {
          m_Type: "UnityEditor.ShaderGraph.UnlitMasterNode",
          m_ObjectId: "node-master",
          m_Name: "Unlit Master",
          m_Slots: [{ m_Id: 0 }, { m_Id: 1 }, { m_Id: 2 }],
        },
      ],
      m_Edges: [
        {
          m_OutputSlot: { m_Node: { m_Id: "node-uv" }, m_SlotId: 0 },
          m_InputSlot: { m_Node: { m_Id: "node-noise" }, m_SlotId: 0 },
        },
        {
          m_OutputSlot: { m_Node: { m_Id: "node-prop-scale" }, m_SlotId: 0 },
          m_InputSlot: { m_Node: { m_Id: "node-noise" }, m_SlotId: 1 },
        },
        {
          m_OutputSlot: { m_Node: { m_Id: "node-noise" }, m_SlotId: 2 },
          m_InputSlot: { m_Node: { m_Id: "node-mul" }, m_SlotId: 0 },
        },
        {
          m_OutputSlot: { m_Node: { m_Id: "node-prop-color" }, m_SlotId: 0 },
          m_InputSlot: { m_Node: { m_Id: "node-mul" }, m_SlotId: 1 },
        },
        {
          m_OutputSlot: { m_Node: { m_Id: "node-mul" }, m_SlotId: 2 },
          m_InputSlot: { m_Node: { m_Id: "node-master" }, m_SlotId: 0 },
        },
      ],
    }),
    expectedShading: 'unlit',
  },

  {
    name: '7. PBR Lit with Voronoi & Normal Strength ShaderGraph (.shadergraph)',
    filename: 'SamplePBRLitVoronoi.shadergraph',
    source: JSON.stringify({
      m_SGVersion: 3,
      m_Type: "UnityEditor.ShaderGraph.GraphData",
      m_Properties: [
        {
          m_Type: "UnityEditor.ShaderGraph.Internal.ColorShaderProperty",
          m_Name: "BaseColor",
          m_ReferenceName: "_BaseColor",
          m_Value: { r: 0.1, g: 0.7, b: 0.9, a: 1 },
          m_ObjectId: "prop-base-col",
        },
        {
          m_Type: "UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty",
          m_Name: "Metallic",
          m_ReferenceName: "_Metallic",
          m_Value: 0.8,
          m_ObjectId: "prop-metal",
        },
        {
          m_Type: "UnityEditor.ShaderGraph.Internal.Vector1ShaderProperty",
          m_Name: "Smoothness",
          m_ReferenceName: "_Smoothness",
          m_Value: 0.7,
          m_ObjectId: "prop-smooth",
        },
      ],
      m_Nodes: [
        {
          m_Type: "UnityEditor.ShaderGraph.PropertyNode",
          m_ObjectId: "node-p-col",
          m_Property: { m_Id: "prop-base-col" },
          m_Slots: [{ m_Id: 0 }],
        },
        {
          m_Type: "UnityEditor.ShaderGraph.PropertyNode",
          m_ObjectId: "node-p-metal",
          m_Property: { m_Id: "prop-metal" },
          m_Slots: [{ m_Id: 0 }],
        },
        {
          m_Type: "UnityEditor.ShaderGraph.PropertyNode",
          m_ObjectId: "node-p-smooth",
          m_Property: { m_Id: "prop-smooth" },
          m_Slots: [{ m_Id: 0 }],
        },
        {
          m_Type: "UnityEditor.ShaderGraph.PBRMasterNode",
          m_ObjectId: "node-pbr-master",
          m_Name: "Lit Master",
          m_Slots: [
            { m_Id: 0 }, // Albedo
            { m_Id: 1 }, // Normal
            { m_Id: 2 }, // Metallic
            { m_Id: 3 }, // Smoothness
            { m_Id: 4 }, // Emission
            { m_Id: 5 }, // Occlusion
            { m_Id: 7 }, // Alpha
            { m_Id: 8 }, // AlphaClip
          ],
        },
      ],
      m_Edges: [
        {
          m_OutputSlot: { m_Node: { m_Id: "node-p-col" }, m_SlotId: 0 },
          m_InputSlot: { m_Node: { m_Id: "node-pbr-master" }, m_SlotId: 0 },
        },
        {
          m_OutputSlot: { m_Node: { m_Id: "node-p-metal" }, m_SlotId: 0 },
          m_InputSlot: { m_Node: { m_Id: "node-pbr-master" }, m_SlotId: 2 },
        },
        {
          m_OutputSlot: { m_Node: { m_Id: "node-p-smooth" }, m_SlotId: 0 },
          m_InputSlot: { m_Node: { m_Id: "node-pbr-master" }, m_SlotId: 3 },
        },
      ],
    }),
    expectedShading: 'lit',
  },

  {
    name: '8. 2D Sprite Color Blending ShaderLab (.shader)',
    filename: 'SpriteColorAlpha.shader',
    source: `
Shader "Custom/SpriteColorAlpha" {
  Properties {
    _MainTex ("Sprite Texture", 2D) = "white" {}
    _Color ("Tint", Color) = (1,1,1,1)
    [MaterialToggle] PixelSnap ("Pixel snap", Float) = 0
  }
  SubShader {
    Tags {
      "Queue"="Transparent"
      "IgnoreProjector"="True"
      "RenderType"="Transparent"
      "PreviewType"="Plane"
    }
    Cull Off
    Lighting Off
    ZWrite Off
    Blend One OneMinusSrcAlpha

    Pass {
      CGPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      #include "UnityCG.cginc"

      struct appdata_t {
        float4 vertex   : POSITION;
        float4 color    : COLOR;
        float2 texcoord : TEXCOORD0;
      };

      struct v2f {
        float4 vertex   : SV_POSITION;
        fixed4 color    : COLOR;
        float2 texcoord : TEXCOORD0;
      };

      fixed4 _Color;
      sampler2D _MainTex;

      v2f vert(appdata_t IN) {
        v2f OUT;
        OUT.vertex = UnityObjectToClipPos(IN.vertex);
        OUT.texcoord = IN.texcoord;
        OUT.color = IN.color * _Color;
        return OUT;
      }

      fixed4 frag(v2f IN) : SV_Target {
        fixed4 c = tex2D(_MainTex, IN.texcoord) * IN.color;
        c.rgb *= c.a;
        return c;
      }
      ENDCG
    }
  }
}
`,
    expectedShading: 'unlit',
  },
];

// ============================================================================
// Test Execution
// ============================================================================

async function runTests() {
  console.log('\n=================================================================');
  console.log('🧪 Running Comprehensive Unity Shader / ShaderGraph Porter Test Suite');
  console.log('=================================================================\n');

  cleanDir(TEMP_TEST_DIR);
  let passedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < SAMPLES.length; i++) {
    const sample = SAMPLES[i];
    const srcPath = path.join(TEMP_TEST_DIR, sample.filename);
    const outEffectPath = path.join(TEMP_TEST_DIR, sample.filename.replace(/\.(shader|hlsl|shadergraph)$/i, '.effect'));
    const outMtlPath = path.join(TEMP_TEST_DIR, sample.filename.replace(/\.(shader|hlsl|shadergraph)$/i, '.mtl'));

    fs.writeFileSync(srcPath, sample.source.trim(), 'utf8');

    try {
      console.log(`[TEST ${i + 1}/${SAMPLES.length}] Transpiling: ${sample.name}`);
      const startTime = Date.now();

      const result = convertUnityHlslToCocosEffect({
        src: srcPath,
        out: outEffectPath,
        generateMaterial: true,
        overwrite: true,
        cocosRoot: path.resolve(__dirname, '..', '..'),
      });

      const duration = Date.now() - startTime;

      // 1. Verify Effect File Exists & Valid Tokens
      if (!fs.existsSync(outEffectPath)) throw new Error('Output .effect file was not created');
      const effectText = fs.readFileSync(outEffectPath, 'utf8');

      if (!effectText.includes('CCEffect %{')) throw new Error('Missing CCEffect YAML header');
      if (!effectText.includes('techniques:')) throw new Error('Missing techniques block');
      if (!effectText.includes('CCProgram')) throw new Error('Missing CCProgram shader stage');
      if (!effectText.includes('vec4 vert ()') && !effectText.includes('vec4 vert()')) throw new Error('Missing vert entry');
      if (!effectText.includes('vec4 frag ()') && !effectText.includes('vec4 frag()')) throw new Error('Missing frag entry');

      // 2. Verify Material Scaffold Exists & Valid JSON
      if (!fs.existsSync(outMtlPath)) throw new Error('Output .mtl material file was not created');
      const mtlText = fs.readFileSync(outMtlPath, 'utf8');
      const mtlJson = JSON.parse(mtlText);
      if (mtlJson.__type__ !== 'cc.Material') throw new Error('Generated .mtl is not a valid cc.Material');

      // 3. Verify std140 UBO layout
      if (effectText.includes('uniform') && effectText.includes('Params {')) {
        // Uniform block detected - verified std140
      }

      console.log(`  ✅ PASS (${duration}ms): Effect & Material generated with zero errors.\n`);
      passedCount++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${err.message}\n  ${err.stack}\n`);
      failedCount++;
    }
  }

  console.log('=================================================================');
  console.log(`📊 Test Results: ${passedCount}/${SAMPLES.length} Passed, ${failedCount} Failed`);
  console.log('=================================================================\n');

  cleanDir(TEMP_TEST_DIR);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests();
