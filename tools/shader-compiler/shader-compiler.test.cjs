'use strict';

/**
 * Test Suite: Unity HLSL/ShaderLab -> Cocos Creator 3.8.8+ GLSL Transpiler (UCShaderTranspiler)
 *
 * Tests:
 * 1. ShaderLab Parser (properties, tags, render states, pragmas)
 * 2. HLSL Semantic Lowering (types, intrinsics, samplers, built-ins, transforms)
 * 3. std140 UBO Layout & Packing rules
 * 4. Golden Shader Transpilation Fixtures
 * 5. Real Project Shaders from HoleScrum4
 * 6. Explicit Descriptor Sets (Set 0, Set 1, Set 2) & Layout Remapping
 * 7. Cocos Surface Shader Bridge Mode (--mode surface-pbr)
 * 8. Normal Map Unpacking & Screen-Space Math
 * 9. In-Memory Virtual File System (VFS)
 * 10. Unity Material (.mat) YAML -> Cocos (.mtl) JSON Converter
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { parseShaderLab } = require('./shaderlab-parser.cjs');
const { lowerHlslToGlsl } = require('./unity-semantic-lowering.cjs');
const { buildStd140Ubo } = require('./ubo-layout-builder.cjs');
const { emitCocosEffect, emitSurfaceShaderEffect } = require('./cocos-effect-generator.cjs');
const { validateCceffectStructure } = require('./shader-validator.cjs');
const { transpileShaderFile } = require('./unity-shader-compiler.cjs');
const { UnityIncludeResolver } = require('./unity-include-resolver.cjs');
const { convertUnityMatToCocosMtl } = require('./unity-material-converter.cjs');

describe('UCShaderTranspiler Test Suite', () => {

  describe('1. ShaderLab Parser', () => {
    test('parses properties with Range, Color, Vector, Float, 2D, Cube, and Attributes', () => {
      const shaderSource = `
Shader "Test/CustomProps" {
  Properties {
    _MainTex ("Albedo", 2D) = "white" {}
    _Color ("Color Tint", Color) = (1, 0.5, 0.2, 1)
    _Cutoff ("Alpha Cutoff", Range(0, 1)) = 0.5
    _Speed ("Speed", Float) = 2.5
    _Offset ("Offset", Vector) = (0, 1, 0, 0)
    [Toggle] _UseGlow ("Enable Glow", Float) = 1
    [Header(Animation)]
    _WaveFreq ("Wave Frequency", Range(0.1, 10.0)) = 1.0
  }
  SubShader {
    Tags { "Queue"="Transparent" "RenderType"="Transparent" }
    Cull Off
    ZWrite Off
    ZTest LEqual
    Blend SrcAlpha OneMinusSrcAlpha

    Pass {
      Name "Forward"
      Tags { "LightMode"="UniversalForward" }
      HLSLPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      #pragma target 3.0
      #pragma shader_feature _USE_GLOW
      ENDHLSL
    }
  }
}
      `;

      const docIR = parseShaderLab(shaderSource, 'TestCustomProps.shader');
      assert.equal(docIR.shaderName, 'Test/CustomProps');
      assert.equal(docIR.properties.length, 7);

      const mainTex = docIR.properties.find(p => p.name === '_MainTex');
      assert.ok(mainTex);
      assert.equal(mainTex.cocosName, 'mainTexture');
      assert.equal(mainTex.cocosType, 'sampler2D');

      const color = docIR.properties.find(p => p.name === '_Color');
      assert.ok(color);
      assert.equal(color.cocosType, 'vec4');
      assert.deepEqual(color.defaultValue, [1, 0.5, 0.2, 1]);

      const cutoff = docIR.properties.find(p => p.name === '_Cutoff');
      assert.ok(cutoff);
      assert.equal(cutoff.type, 'Range');
      assert.deepEqual(cutoff.range, [0, 1]);

      assert.equal(docIR.subShaders.length, 1);
      const pass = docIR.subShaders[0].passes[0];
      assert.equal(pass.renderState.cull, 'none');
      assert.equal(pass.renderState.zWrite, false);
      assert.equal(pass.renderState.blend.enabled, true);
      assert.equal(pass.program.vertexEntry, 'vert');
      assert.equal(pass.program.fragmentEntry, 'frag');
    });
  });

  describe('2. HLSL Semantic Lowering', () => {
    test('lowers types, intrinsics, and texture sampling to GLSL 300 ES', () => {
      const hlsl = `
        fixed4 col = tex2D(_MainTex, uv);
        half3 mixed = lerp(col.rgb, _TintColor.rgb, _BlendFactor);
        float f = frac(uv.x * 10.0);
        float sat = saturate(f);
        float inv = rsqrt(sat);
        float dx = ddx(uv.x);
        clip(col.a - _Cutoff);
        float4 clipPos = UnityObjectToClipPos(v.vertex);
        float3 normalWS = UnityObjectToWorldNormal(v.normal);
        float4 screenPos = ComputeScreenPos(clipPos);
        float2 uvST = TRANSFORM_TEX(v.uv, _MainTex);
      `;

      const glsl = lowerHlslToGlsl(hlsl);

      assert.ok(glsl.includes('texture(_MainTex, uv)'), 'Should convert tex2D to texture');
      assert.ok(glsl.includes('mix(col.rgb'), 'Should convert lerp to mix');
      assert.ok(glsl.includes('fract('), 'Should convert frac to fract');
      assert.ok(glsl.includes('clamp('), 'Should convert saturate to clamp');
      assert.ok(glsl.includes('inversesqrt('), 'Should convert rsqrt to inversesqrt');
      assert.ok(glsl.includes('dFdx('), 'Should convert ddx to dFdx');
      assert.ok(glsl.includes('if ((col.a - _Cutoff) < 0.0) { discard; }'), 'Should convert clip to if discard');
      assert.ok(glsl.includes('cc_matViewProj * cc_matWorld'), 'Should lower UnityObjectToClipPos');
      assert.ok(glsl.includes('cc_matWorldIT'), 'Should lower UnityObjectToWorldNormal');
      assert.ok(glsl.includes('_MainTex_ST.xy'), 'Should lower TRANSFORM_TEX');
    });
  });

  describe('3. std140 UBO Layout & Packing', () => {
    test('ensures 16-byte alignment for vec4/vec3 and 8-byte for vec2', () => {
      const fields = [
        { name: 'speed', type: 'float' },
        { name: 'tintColor', type: 'vec4' },
        { name: 'uvOffset', type: 'vec2' },
        { name: 'cutoff', type: 'float' },
      ];

      const ubo = buildStd140Ubo(fields, true);
      assert.ok(ubo.glsl.includes('uniform Constant {'));
      assert.equal(ubo.totalSize % 16, 0, 'Total UBO size must be multiple of 16 bytes');

      const tintField = ubo.fields.find(f => f.name === 'tintColor');
      assert.equal(tintField.offset % 16, 0, 'vec4 must align to 16-byte boundary');

      const uvField = ubo.fields.find(f => f.name === 'uvOffset');
      assert.equal(uvField.offset % 8, 0, 'vec2 must align to 8-byte boundary');
    });
  });

  describe('4. Golden Shader Transpilation Fixtures', () => {
    test('transpiles Unlit Wobble & Dissolve Shader to valid CCEffect', () => {
      const source = `
Shader "Custom/UnlitWobbleDissolve" {
  Properties {
    _MainTex ("Texture", 2D) = "white" {}
    _NoiseTex ("Noise", 2D) = "white" {}
    _Color ("Tint Color", Color) = (1, 1, 1, 1)
    _DissolveAmount ("Dissolve Amount", Range(0, 1)) = 0.5
    _WaveSpeed ("Wave Speed", Float) = 2.0
  }
  SubShader {
    Tags { "RenderType"="Opaque" }
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
      };

      struct v2f {
        float4 pos : SV_POSITION;
        float2 uv : TEXCOORD0;
      };

      sampler2D _MainTex;
      sampler2D _NoiseTex;
      float4 _Color;
      float _DissolveAmount;
      float _WaveSpeed;

      v2f vert(appdata v) {
        v2f o;
        float wobble = sin(_Time.y * _WaveSpeed + v.vertex.x * 5.0) * 0.1;
        v.vertex.y += wobble;
        o.pos = UnityObjectToClipPos(v.vertex);
        o.uv = v.uv;
        return o;
      }

      fixed4 frag(v2f i) : SV_Target {
        fixed4 col = tex2D(_MainTex, i.uv) * _Color;
        fixed4 noise = tex2D(_NoiseTex, i.uv);
        if (noise.r < _DissolveAmount) discard;
        return col;
      }
      ENDCG
    }
  }
}
      `;

      const docIR = parseShaderLab(source, 'WobbleDissolve.shader');
      const effectCode = emitCocosEffect(docIR);
      const validation = validateCceffectStructure(effectCode);

      assert.equal(validation.valid, true, `Validation should pass: ${validation.errors.join(', ')}`);
      assert.ok(effectCode.includes('CCEffect %{'));
      assert.ok(effectCode.includes('CCProgram vs %{'));
      assert.ok(effectCode.includes('CCProgram fs %{'));
      assert.ok(effectCode.includes('texture(mainTexture, v_uv)'));
      assert.ok(effectCode.includes('if (noise.r < dissolveAmount) discard;'));
    });
  });

  describe('5. Real HoleScrum4 Project Shaders Verification', () => {
    const holeScrumShaders = [
      'd:/_Projects/Unity/HoleScrum4/Assets/_Game/Shaders/WaterDispose.shader',
      'd:/_Projects/Unity/HoleScrum4/Assets/_Game/Shaders/LogoShader/ShaderLogo/ToonLightBase.shader',
      'd:/_Projects/Unity/HoleScrum4/Assets/_Game/Shaders/LogoShader/ShaderXray/Custom_SeeThroughXRay.shader',
      'd:/_Projects/Unity/HoleScrum4/Assets/Free Game VFX/Shaders/Additive.shader',
      'd:/_Projects/Unity/HoleScrum4/Assets/Shader/WaterHoleGround.shader',
      'd:/_Projects/Unity/HoleScrum4/Assets/_Game/_Map/HoleBusters/game/Shader/Custom_CircularFill.shader',
      'd:/_Projects/Unity/HoleScrum4/Assets/_Game/_Map/HoleBusters/game/Shader/Custom_StencilMask.shader',
    ];

    for (const shaderPath of holeScrumShaders) {
      const basename = path.basename(shaderPath);
      test(`transpiles real shader: ${basename}`, () => {
        if (!fs.existsSync(shaderPath)) {
          return; // skip if running in environment without local external Unity folder
        }

        const outPath = path.join(__dirname, `.temp-test-${basename}.effect`);
        const result = transpileShaderFile(shaderPath, outPath, { dryRun: true, report: false });

        // Some engine inputs have no Cocos counterpart at all. Additive.shader
        // fades particles against _CameraDepthTexture, which a playable build
        // does not render; there is no lowering that makes it link, so the
        // honest expectation is a diagnostic, not a pass. Anything NOT on this
        // list must come out compile-clean.
        const manualOnly = {
          'Additive.shader': [/_CameraDepthTexture/],
        };
        const allowed = manualOnly[basename] || [];
        const unexpected = result.validationResult.errors
          .filter(e => !allowed.some(rx => rx.test(e)));

        assert.deepEqual(unexpected, [], `Shader ${basename} produced unexpected errors: ${unexpected.join(', ')}`);
        if (allowed.length === 0) {
          assert.ok(result.scoreInfo.score >= 80, `Shader ${basename} score should be >= 80, got ${result.scoreInfo.score}`);
        }
      });
    }
  });

  describe('6. Explicit Descriptor Sets & Layout Remapping', () => {
    test('emits layout(set = 2, binding = 0) on Constant UBO and layout(set = 2, binding = 1..N) on samplers', () => {
      const source = `
Shader "Custom/DescriptorSetTest" {
  Properties {
    _MainTex ("Base", 2D) = "white" {}
    _NoiseTex ("Noise", 2D) = "white" {}
    _BaseColor ("Color", Color) = (1, 1, 1, 1)
    _Cutoff ("Cutoff", Float) = 0.5
  }
  SubShader {
    Pass {
      CGPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      ENDCG
    }
  }
}
      `;

      const docIR = parseShaderLab(source, 'DescriptorSetTest.shader');
      const effectCode = emitCocosEffect(docIR, { explicitBindings: true });

      assert.ok(effectCode.includes('layout(set = 2, binding = 0) uniform Constant {'), 'Should have explicit layout on UBO');
      assert.ok(effectCode.includes('layout(set = 2, binding = 1) uniform sampler2D mainTexture;'), 'Should have layout on sampler 1');
      assert.ok(effectCode.includes('layout(set = 2, binding = 2) uniform sampler2D noiseTex;'), 'Should have layout on sampler 2');
    });
  });

  describe('7. Cocos Surface Shader Bridge Mode', () => {
    test('generates Surface Shader format for PBR Lit shaders (--mode surface-pbr)', () => {
      const source = `
Shader "Universal Forward/Lit" {
  Properties {
    _BaseMap ("Texture", 2D) = "white" {}
    _BaseColor ("Color", Color) = (1, 1, 1, 1)
    _Smoothness ("Smoothness", Range(0, 1)) = 0.5
    _Metallic ("Metallic", Range(0, 1)) = 0.0
  }
  SubShader {
    Pass {
      HLSLPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      ENDHLSL
    }
  }
}
      `;

      const docIR = parseShaderLab(source, 'Lit.shader');
      const effectCode = emitCocosEffect(docIR, { mode: 'surface-pbr' });

      assert.ok(effectCode.includes('CCProgram surface-vertex %{'), 'Should include surface-vertex program');
      assert.ok(effectCode.includes('CCProgram surface-fragment %{'), 'Should include surface-fragment program');

      // Hook names and signatures are fixed by the engine
      // (chunks/surfaces/default-functions/*.chunk). An invented name such as
      // SurfacesFragmentModifyBaseColorAndAlpha is simply never called, so the
      // effect compiles and renders as an untouched default -- assert against
      // the real API instead.
      assert.ok(effectCode.includes('SurfacesVertexModifyLocalSharedData'), 'Should define the vertex shared-data hook');
      assert.ok(effectCode.includes('SurfacesFragmentModifySharedData(inout SurfacesMaterialData surfaceData)'),
        'Should define the fragment shared-data hook with the engine signature');
      assert.ok(effectCode.includes('#include <surfaces/data-structures/standard>'),
        'SurfacesMaterialData must be declared before the hook that takes it');

      // The entry point comes from the engine's shading-entry chunks; without
      // these includes there is no main() and no lighting.
      for (const inc of [
        'surfaces/effect-macros/common-macros',
        'surfaces/includes/common-vs',
        'surfaces/includes/standard-vs',
        'shading-entries/main-functions/render-to-scene/vs',
        'surfaces/includes/common-fs',
        'lighting-models/includes/standard',
        'surfaces/includes/standard-fs',
        'shading-entries/main-functions/render-to-scene/fs',
      ]) {
        assert.ok(effectCode.includes(`<${inc}>`), `Should include <${inc}>`);
      }
      assert.ok(/vert:\s*standard-vs/.test(effectCode), 'Pass should reference vert: standard-vs');
      assert.ok(/frag:\s*standard-fs/.test(effectCode), 'Pass should reference frag: standard-fs');
    });

    test('maps URP SurfaceData channels onto SurfacesMaterialData', () => {
      const source = `
Shader "Custom/UrpLit" {
  Properties {
    _BaseMap ("Texture", 2D) = "white" {}
    _Smoothness ("Smoothness", Range(0, 1)) = 0.25
    _Metallic ("Metallic", Range(0, 1)) = 0.0
  }
  SubShader {
    Pass {
      HLSLPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; };
      half4 frag (Varyings i) : SV_Target {
        half4 c = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, i.uv);
        SurfaceData surfaceData = (SurfaceData)0;
        surfaceData.albedo = c.rgb;
        surfaceData.alpha = c.a;
        surfaceData.metallic = _Metallic;
        surfaceData.smoothness = _Smoothness;
        surfaceData.occlusion = 1;
        InputData inputData = (InputData)0;
        return UniversalFragmentPBR(inputData, surfaceData);
      }
      ENDHLSL
    }
  }
}
      `;

      const docIR = parseShaderLab(source, 'UrpLit.shader');
      const effectCode = emitCocosEffect(docIR, { mode: 'surface-pbr' });

      // Cocos stores roughness, Unity authors smoothness (spec section 29).
      assert.ok(effectCode.includes('surfaceData.roughness = (1.0 - (smoothness));'),
        'smoothness must be inverted into roughness');
      assert.ok(effectCode.includes('surfaceData.metallic = metallic;'), 'metallic should bind to the Cocos uniform name');
      assert.ok(effectCode.includes('surfaceData.baseColor.rgb = c.rgb;'), 'albedo should feed baseColor.rgb');
      assert.ok(effectCode.includes('surfaceData.baseColor.a = c.a;'), 'alpha should feed baseColor.a');
      // GLSL ES 300 has no implicit int->float conversion.
      assert.ok(effectCode.includes('surfaceData.ao = 1.0;'), 'an integer literal must be emitted as a float');
      // The preamble that produced those values has to come along.
      assert.ok(effectCode.includes('texture(mainTexture, FSInput_texcoord)'),
        'fragment preamble should be ported with Unity names bound to Cocos ones');
      assert.ok(!/_BaseMap|_Smoothness|_Metallic/.test(effectCode), 'no Unity property names should survive');
    });

    test('every #include resolves against the installed Cocos 3.8.8 engine chunks', () => {
      // The surface path is entirely include-driven, so a typo'd chunk name is
      // invisible in review and fatal at import. Check the emitted includes
      // against the real engine tree when it is installed. This is the check
      // that would have caught CC_SURFACES_FRAGMENT_MODIFY_BASECOLOR_AND_ALPHA,
      // a macro name the engine never defines.
      const engineRoot = 'C:/ProgramData/cocos/editors/Creator/3.8.8/resources/resources/3d/engine/editor/assets';
      if (!fs.existsSync(engineRoot)) return; // engine not installed here

      const source = `
Shader "Custom/UrpLit2" {
  Properties { _BaseMap ("Texture", 2D) = "white" {} }
  SubShader { Pass { HLSLPROGRAM
    #pragma vertex vert
    #pragma fragment frag
    struct Varyings { float4 positionCS : SV_POSITION; float2 uv : TEXCOORD0; };
    half4 frag (Varyings i) : SV_Target {
      SurfaceData surfaceData = (SurfaceData)0;
      surfaceData.albedo = half3(1, 1, 1);
      InputData inputData = (InputData)0;
      return UniversalFragmentPBR(inputData, surfaceData);
    }
  ENDHLSL } }
}
      `;
      const docIR = parseShaderLab(source, 'UrpLit2.shader');
      const effectCode = emitCocosEffect(docIR, { mode: 'surface-pbr' });

      const localPrograms = new Set(
        [...effectCode.matchAll(/CCProgram\s+(\S+)\s*%\{/g)].map(m => m[1])
      );
      const unresolved = [];
      for (const m of effectCode.matchAll(/#include\s+<([^>]+)>/g)) {
        const inc = m[1];
        if (localPrograms.has(inc)) continue;
        if (fs.existsSync(path.join(engineRoot, 'chunks', `${inc}.chunk`))) continue;
        unresolved.push(inc);
      }
      assert.deepEqual(unresolved, [], `Unresolved engine includes: ${unresolved.join(', ')}`);

      // Hook signatures are engine contracts; a mismatch means the override is
      // silently never called.
      const defaults = fs.readFileSync(
        path.join(engineRoot, 'chunks/surfaces/default-functions/standard-fs.chunk'), 'utf8');
      assert.ok(defaults.includes('void SurfacesFragmentModifySharedData(inout SurfacesMaterialData surfaceData)'),
        'engine still declares the shared-data hook with the signature we emit');
      assert.ok(effectCode.includes('void SurfacesFragmentModifySharedData(inout SurfacesMaterialData surfaceData)'),
        'emitted hook must match the engine signature exactly');
    });
  });

  describe('8. Tangent Space Normal Unpack & Screen-Space Math', () => {
    test('lowers ComputeScreenPos and UnpackNormal helpers', () => {
      const hlsl = `
        float4 clipPos = UnityObjectToClipPos(v.vertex);
        float4 screenPos = ComputeScreenPos(clipPos);
        float3 normal = UnpackNormal(tex2D(_BumpMap, uv));
      `;

      const glsl = lowerHlslToGlsl(hlsl);
      assert.ok(glsl.includes('vec4(vec2((clipPos).x, (clipPos).y) * 0.5 + vec2((clipPos).w * 0.5), (clipPos).zw)'), 'Should lower ComputeScreenPos');
    });
  });

  describe('9. In-Memory Virtual File System (VFS)', () => {
    test('resolves in-memory registered virtual files without disk I/O', () => {
      const resolver = new UnityIncludeResolver();
      resolver.registerVirtualFile('MyCustomLighting.hlsl', 'vec3 customLight() { return vec3(1.0); }');

      const resolved = resolver.resolveInclude('MyCustomLighting.hlsl', null);
      assert.equal(resolved.isVfs, true);
      assert.ok(resolved.content.includes('customLight()'));
    });
  });

  describe('10. Unity Material (.mat) YAML -> Cocos (.mtl) JSON Converter', () => {
    test('converts Unity material YAML with colors, floats, textures, and defines', () => {
      const unityMatYaml = `
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!21 &2100000
Material:
  serializedVersion: 8
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: Enemy_Dissolve
  m_Shader: {fileID: 4800000, guid: a1b2c3d4e5f6, type: 3}
  m_ShaderKeywords: "_USE_DISSOLVE _ALPHATEST_ON"
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs:
      - _MainTex:
          m_Texture: {fileID: 2800000, guid: 8a7b9c1d2e3f, type: 3}
          m_Scale: {x: 1, y: 1}
          m_Offset: {x: 0, y: 0}
    m_Floats:
      - _Cutoff: 0.45
      - _Speed: 2.5
    m_Colors:
      - _Color: {r: 1, g: 0.5, b: 0, a: 1}
      - _EmissionColor: {r: 0, g: 0, b: 0, a: 1}
      `;

      const mtlJson = convertUnityMatToCocosMtl(unityMatYaml, {
        materialName: 'Enemy_Dissolve',
        effectUuid: 'test-effect-uuid-1234',
      });

      const mtlObj = JSON.parse(mtlJson);
      assert.equal(mtlObj.__type__, 'cc.Material');
      assert.equal(mtlObj._name, 'Enemy_Dissolve');
      assert.equal(mtlObj._effectAsset.__uuid__, 'test-effect-uuid-1234');
      assert.equal(mtlObj._defines[0]._USE_DISSOLVE, true);
      assert.equal(mtlObj._defines[0]._ALPHATEST_ON, true);

      const props = mtlObj._props[0];
      assert.equal(props.cutoff, 0.45);
      assert.equal(props.speed, 2.5);
      assert.deepEqual(props.baseColor, { __type__: 'cc.Color', r: 255, g: 128, b: 0, a: 255 });
      assert.equal(props.mainTexture.__uuid__, '8a7b9c1d2e3f');
    });

    test('generates structured material asset manifest with texture diagnostics', () => {
      const { generateMaterialAssetManifest, performTextureAssetDiagnostics } = require('./unity-material-converter.cjs');

      const unityMatYaml = `
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!21 &2100000
Material:
  m_Shader: {fileID: 4800000, guid: 9876543210fedcba, type: 3}
  m_SavedProperties:
    m_TexEnvs:
      - _MainTex:
          m_Texture: {fileID: 2800000, guid: 8a7b9c1d2e3f, type: 3}
          m_Scale: {x: 2, y: 2}
          m_Offset: {x: 0.1, y: 0.1}
      - _BumpMap:
          m_Texture: {fileID: 2800000, guid: ffeeddccbbaa, type: 3}
    m_Floats:
      - _Cutoff: 0.5
    m_Colors:
      - _Color: {r: 1, g: 1, b: 1, a: 1}
      `;

      const manifest = generateMaterialAssetManifest(unityMatYaml, {
        materialName: 'TestMaterial',
        shaderName: 'Custom/Shader',
      });

      assert.equal(manifest.material, 'TestMaterial');
      assert.equal(manifest.shader, 'Custom/Shader');
      assert.equal(manifest.shaderGuid, '9876543210fedcba');
      assert.equal(manifest.cocos.properties.cutoff, 0.5);
      assert.deepEqual(manifest.cocos.properties.mainTexture_ST, [2, 2, 0.1, 0.1]);
      assert.equal(manifest.textureDiagnostics._MainTex.colorSpace, 'sRGB');
      assert.equal(manifest.textureDiagnostics._BumpMap.colorSpace, 'linear');
      assert.equal(manifest.textureDiagnostics._BumpMap.normalMapGreenInvert, true);
    });
  });

  describe('11. ShaderLab Preprocessor & Include Resolution v2', () => {
    const {
      evaluateCondition,
      preprocessShaderSource,
      extractAndSpliceIncludes,
    } = require('./shader-preprocessor.cjs');

    test('evaluates complex preprocessor conditions with platform macros', () => {
      const defines = new Map([
        ['SHADER_API_GLES3', '1'],
        ['QUALITY_HIGH', '1'],
        ['MAX_LIGHTS', '4'],
      ]);

      assert.equal(evaluateCondition('defined(SHADER_API_GLES3) && !defined(SHADER_API_D3D11)', defines), true);
      assert.equal(evaluateCondition('defined(QUALITY_LOW) || MAX_LIGHTS >= 4', defines), true);
      assert.equal(evaluateCondition('MAX_LIGHTS < 2', defines), false);
    });

    test('preprocesses source code with conditional branches and include graph', () => {
      const source = `
#define CUSTOM_FEATURE 1
#ifdef CUSTOM_FEATURE
float activeFeature() { return 1.0; }
#else
float activeFeature() { return 0.0; }
#endif

#if defined(SHADER_API_GLES3)
vec3 platformGles() { return vec3(1.0); }
#endif
      `;

      const { processedSource, result } = preprocessShaderSource(source);
      assert.ok(processedSource.includes('float activeFeature() { return 1.0; }'));
      assert.ok(!processedSource.includes('float activeFeature() { return 0.0; }'));
      assert.ok(processedSource.includes('vec3 platformGles() { return vec3(1.0); }'));
      assert.ok(result.defines.CUSTOM_FEATURE === '1');
      assert.equal(result.diagnostics.length, 0);
    });

    test('extracts and splices global CGINCLUDE / HLSLINCLUDE blocks into passes', () => {
      const source = `
Shader "Custom/TestInclude" {
  CGINCLUDE
  #include "UnityCG.cginc"
  float helperFunc() { return 42.0; }
  ENDCG

  SubShader {
    Pass {
      CGPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      ENDCG
    }
  }
}
      `;

      const spliced = extractAndSpliceIncludes(source);
      assert.ok(spliced.includes('float helperFunc() { return 42.0; }'));
      assert.ok(!spliced.includes('CGINCLUDE'));
    });
  });

  describe('12. Built-in Unity Virtual Package Map & UsePass / Fallback Resolving', () => {
    test('resolves standard Unity and URP virtual package includes', () => {
      const resolver = new UnityIncludeResolver();

      const expectedPackages = [
        'UnityCG.cginc',
        'UnityShaderVariables.cginc',
        'Lighting.cginc',
        'AutoLight.cginc',
        'UnityGlobalIllumination.cginc',
        'UnityShadowLibrary.cginc',
        'HLSLSupport.cginc',
        'Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl',
        'Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl',
        'Packages/com.unity.shadergraph/ShaderGraphLibrary/Functions.hlsl',
      ];

      for (const pkg of expectedPackages) {
        const resolved = resolver.resolveInclude(pkg, null);
        assert.equal(resolved.isBuiltin, true, `Include ${pkg} should be resolved as builtin`);
        assert.ok(resolved.content.length > 10, `Include ${pkg} content should not be empty`);
      }
    });

    test('parses UsePass and Fallback statements and records dependencies', () => {
      const source = `
Shader "Custom/WithUsePass" {
  SubShader {
    Pass {
      Name "Forward"
      CGPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      ENDCG
    }
    UsePass "Legacy Shaders/VertexLit/SHADOWCASTER"
    UsePass "Hidden/Universal Render Pipeline/Lit/DEPTHONLY"
  }
  Fallback "Diffuse"
}
      `;

      const docIR = parseShaderLab(source, 'WithUsePass.shader');
      assert.equal(docIR.fallBack, 'Diffuse');
      assert.equal(docIR.dependencies.length, 3);
      assert.deepEqual(docIR.dependencies[0], { type: 'Fallback', target: 'Diffuse' });
      assert.deepEqual(docIR.dependencies[1], { type: 'UsePass', target: 'Legacy Shaders/VertexLit/SHADOWCASTER' });
      assert.deepEqual(docIR.dependencies[2], { type: 'UsePass', target: 'Hidden/Universal Render Pipeline/Lit/DEPTHONLY' });
    });
  });

  describe('13. New Normalization Rules (Textures, mul() overloads, precision, interpolation, semantics)', () => {
    const { lowerHlslToGlsl } = require('./unity-semantic-lowering.cjs');
    const { parseStructs } = require('./hlsl-ast-parser.cjs');

    test('normalizes legacy texture functions to standard GLSL form', () => {
      const code = `
        vec4 col = tex2D(_MainTex, uv);
        vec4 pCol = tex2Dproj(_MainTex, pos);
        vec4 lCol = tex2Dlod(_MainTex, vec4(uv, 0.0, 2.0));
        vec4 cCol = texCUBE(_CubeMap, dir);
        vec4 vCol = tex3D(_Volume, uvw);
      `;
      const lowered = lowerHlslToGlsl(code);
      assert.ok(lowered.includes('texture(_MainTex, uv)'));
      assert.ok(lowered.includes('textureProj(_MainTex, pos)'));
      assert.ok(lowered.includes('textureLod(_MainTex, uv, 2.0)'));
      assert.ok(lowered.includes('texture(_CubeMap, dir)'));
      assert.ok(lowered.includes('texture(_Volume, uvw)'));
    });

    test('normalizes mul() operator overloads including float3x3 matrix casts', () => {
      const code = `
        vec4 clipPos = mul(MVP, v);
        vec3 worldNorm = mul((float3x3)unity_WorldToObject, normal);
        vec4 outPos = mul(M, v);
        vec4 rowVec = mul(v, M);
      `;
      const lowered = lowerHlslToGlsl(code);
      assert.ok(lowered.includes('(MVP * v)'));
      assert.ok(lowered.includes('(mat3(cc_matWorldIT) * (normal))'));
      assert.ok(lowered.includes('(M * v)'));
      assert.ok(lowered.includes('(v * M)'));
    });

    test('parses struct interpolation qualifiers and extended semantics', () => {
      const structCode = `
        struct v2f {
          float4 pos : SV_POSITION;
          centroid float2 uv : TEXCOORD0;
          nointerpolation float4 customData : TEXCOORD3;
          fixed4 color : COLOR0;
          uint vertID : SV_VertexID;
        };
      `;
      const structs = parseStructs(structCode);
      assert.equal(structs.length, 1);
      const fields = structs[0].fields;
      assert.equal(fields[0].semantic, 'SV_POSITION');
      assert.equal(fields[1].qualifier, 'centroid');
      assert.equal(fields[1].glslQualifier, 'centroid');
      assert.equal(fields[2].qualifier, 'nointerpolation');
      assert.equal(fields[2].glslQualifier, 'flat');
      assert.equal(fields[3].semantic, 'COLOR0');
      assert.equal(fields[4].semantic, 'SV_VERTEXID');
    });
  });

  describe('14. Shader Variant & Keyword Manifest Manager', () => {
    const {
      parsePragmaKeywords,
      buildVariantTree,
      enforceVariantPolicy,
      generateVariantManifest,
    } = require('./shader-variant-manager.cjs');

    test('parses all pragma keyword forms and calculates total combinations', () => {
      const hlsl = `
        #pragma shader_feature _ FEATURE_A FEATURE_B
        #pragma shader_feature_local _ LOCAL_FEATURE
        #pragma multi_compile _ MULTI_A MULTI_B
        #pragma multi_compile_fragment _ FRAG_FEATURE
        #pragma multi_compile_vertex _ VERT_FEATURE
      `;

      const groups = parsePragmaKeywords(hlsl);
      assert.equal(groups.length, 5);
      assert.equal(groups[0].isFeature, true);
      assert.equal(groups[1].scope, 'local');
      assert.equal(groups[2].scope, 'global');
      assert.equal(groups[3].stage, 'fragment');
      assert.equal(groups[4].stage, 'vertex');

      const { totalCombinations, nodes } = buildVariantTree(groups, hlsl);
      // (2 + 1) * (1 + 1) * (2 + 1) * (1 + 1) * (1 + 1) = 3 * 2 * 3 * 2 * 2 = 72
      assert.equal(totalCombinations, 72);
      assert.equal(nodes.length, 7);
    });

    test('enforces single-playable policy and generates manifest with UCST-VARIANT-002', () => {
      const hlsl = `
        #pragma shader_feature _ USE_DISSOLVE USE_EMISSION
        #pragma multi_compile _ SHADOWS_SHADOWMASK
        #if defined(USE_DISSOLVE)
        float dissolveAmount;
        #endif
      `;

      const result = generateVariantManifest('Game/Dissolve', hlsl, {
        policy: 'single-playable',
        materialKeywords: ['USE_DISSOLVE'],
      });

      assert.equal(result.manifest.shader, 'Game/Dissolve');
      assert.equal(result.manifest.policy, 'single-playable');
      assert.equal(result.manifest.totalCombinations, 6);
      assert.equal(result.manifest.keywords.USE_DISSOLVE, true);
      assert.equal(result.manifest.keywords.USE_EMISSION, false);
      assert.ok(result.reportMessage.includes('UCST-VARIANT-002'));
      assert.ok(result.glslDefines.includes('#define USE_DISSOLVE 1'));
      assert.ok(result.glslDefines.includes('// #define USE_EMISSION 0'));
    });
  });

  describe('15. Unity Built-in Function Library Expansion', () => {
    const { lowerHlslToGlsl } = require('./unity-semantic-lowering.cjs');

    test('lowers expanded matrix built-ins and bridge symbols', () => {
      const code = `
        mat4 m1 = UNITY_MATRIX_T_MV;
        mat4 m2 = UNITY_MATRIX_IT_MV;
        mat4 m3 = UNITY_MATRIX_I_M;
        mat4 m4 = unity_WorldToCamera;
        mat4 m5 = _UCST_MatWorld;
        mat4 m6 = _UCST_MatViewProj;
      `;
      const lowered = lowerHlslToGlsl(code);
      assert.ok(lowered.includes('transpose(cc_matView * cc_matWorld)'));
      assert.ok(lowered.includes('transpose(inverse(cc_matView * cc_matWorld))'));
      assert.ok(lowered.includes('cc_matWorldIT'));
      assert.ok(lowered.includes('cc_matView'));
      assert.ok(lowered.includes('cc_matWorld'));
      assert.ok(lowered.includes('cc_matViewProj'));
    });

    test('lowers lighting, camera, and normal unpacking helpers', () => {
      const code = `
        vec3 lightDir = WorldSpaceLightDir(pos);
        vec3 objLight = ObjSpaceLightDir(pos);
        vec3 amb = UNITY_LIGHTMODEL_AMBIENT;
        vec3 viewDir = UnityWorldSpaceViewDir(pos);
        vec4 screenP = UnityViewToScreenPos(pos);
        vec3 dxtNorm = UnpackNormalDXT5nm(packedNorm);
        vec3 scaledNorm = UnpackScaleNormal(packedNorm, 1.5);
      `;
      const lowered = lowerHlslToGlsl(code);
      assert.ok(lowered.includes('normalize(-cc_mainLitDir.xyz)'));
      assert.ok(lowered.includes('normalize((cc_matWorldIT * vec4(-cc_mainLitDir.xyz, 0.0)).xyz)'));
      assert.ok(lowered.includes('cc_ambientSky.rgb'));
      assert.ok(lowered.includes('(cc_cameraPos.xyz - (pos).xyz)'));
      assert.ok(lowered.includes('vec4(vec2((pos).x, (pos).y) * 0.5'));
      // Normal unpacking routes through the UnpackNormalMap() helper the effect
      // generator emits. Inlining it duplicated the argument three times, which
      // turns one texture fetch into three.
      assert.ok(lowered.includes('UnpackNormalMap(packedNorm, 1.0)'));
      assert.ok(lowered.includes('normalize(') && lowered.includes('1.5'));
    });
  });

  describe('16. URP & ShaderGraph Rule Packs', () => {
    const { lowerHlslToGlsl } = require('./unity-semantic-lowering.cjs');
    const { isShaderGraphSource } = require('./urp-shadergraph-rules.cjs');

    test('lowers common URP library functions', () => {
      const code = `
        vec3 camPos = GetCameraPositionWS();
        vec3 viewDir = GetViewForwardDir();
        Light mainL = GetMainLight(shadowCoord);
        vec4 col = SampleAlbedoAlpha(uv, _MainTex, sampler_MainTex);
        float fog = ComputeFogFactor(posCS.z);
        vec4 shadowCoord = TransformWorldToShadowCoord(posWS);
      `;
      const lowered = lowerHlslToGlsl(code);
      assert.ok(lowered.includes('cc_cameraPos.xyz'));
      assert.ok(lowered.includes('(-cc_matView[2].xyz)'));
      assert.ok(lowered.includes('GetMainLight()'));
      assert.ok(lowered.includes('texture(_MainTex, uv)'));
      assert.ok(lowered.includes('1.0'));
      assert.ok(lowered.includes('vec4(0.0)'));
    });

    test('detects ShaderGraph sources and provides node functions', () => {
      const sgSource = `
        // Shader Graph Generated
        #include "Packages/com.unity.shadergraph/ShaderGraphLibrary/Functions.hlsl"
        void SG_CustomNode_float(vec2 UV, out vec2 Out) {
          Unity_TilingAndOffset_float(UV, vec2(1.0), vec2(0.0), Out);
        }
      `;
      assert.equal(isShaderGraphSource(sgSource), true);
    });
  });

  describe('17. Cocos 3.8 ABI Lowering Enhancements', () => {
    const { buildStd140Ubo } = require('./ubo-layout-builder.cjs');
    const { allocateBindings } = require('./binding-allocator.cjs');

    test('calculates std140 UBO layout with arrayStride and matrixStride', () => {
      const fields = [
        { name: 'u_color', type: 'vec4' },
        { name: 'u_mat', type: 'mat4' },
        { name: 'u_array', type: 'float', arraySize: 4 },
        { name: 'u_float', type: 'float' },
      ];
      const ubo = buildStd140Ubo(fields, true);
      assert.equal(ubo.totalSize % 16, 0);

      const matField = ubo.fields.find(f => f.name === 'u_mat');
      assert.equal(matField.matrixStride, 16);

      const arrayField = ubo.fields.find(f => f.name === 'u_array');
      assert.equal(arrayField.arrayStride, 16);
      assert.equal(arrayField.size, 64); // 4 * 16
    });

    test('allocates deterministic descriptor sets and bindings', () => {
      const samplers = [
        { name: '_MainTex', type: 'sampler2D', cocosName: 'mainTexture' },
        { name: '_BumpMap', type: 'sampler2D', cocosName: 'normalMap' },
        { name: '_Cube', type: 'samplerCube', cocosName: 'cubeMap' },
      ];
      const alloc = allocateBindings(samplers, {
        bindings: { baseSet: 2, baseBinding: 10, step: 1 },
      });

      assert.equal(alloc.manifest._MainTex.set, 2);
      assert.equal(alloc.manifest._MainTex.binding, 10);
      assert.equal(alloc.manifest._BumpMap.set, 2);
      assert.equal(alloc.manifest._BumpMap.binding, 11);
      assert.equal(alloc.manifest._Cube.set, 2);
      assert.equal(alloc.manifest._Cube.binding, 12);
      assert.equal(alloc.collisions.length, 0);
    });
  });

  describe('18. Render State Translation Expansion', () => {
    const { parseShaderLab } = require('./shaderlab-parser.cjs');
    const { emitCocosEffect } = require('./cocos-effect-generator.cjs');

    test('parses separate Blend and BlendOp equations and Offset', () => {
      const shader = `
        Shader "Custom/ComplexBlend" {
          SubShader {
            Pass {
              Blend One One, SrcAlpha OneMinusSrcAlpha
              BlendOp Sub, Max
              Offset 1, -1
              AlphaToMask On
              CGPROGRAM
              #pragma vertex vert
              #pragma fragment frag
              float4 vert(float4 v:POSITION):SV_POSITION { return v; }
              float4 frag():SV_Target { return float4(1,1,1,1); }
              ENDCG
            }
          }
        }
      `;
      const docIR = parseShaderLab(shader);
      const pass = docIR.subShaders[0].passes[0];

      assert.equal(pass.renderState.blend.enabled, true);
      assert.equal(pass.renderState.blend.srcRGB, 'one');
      assert.equal(pass.renderState.blend.dstRGB, 'one');
      assert.equal(pass.renderState.blend.srcAlpha, 'src_alpha');
      assert.equal(pass.renderState.blend.dstAlpha, 'one_minus_src_alpha');
      assert.equal(pass.renderState.blend.opRGB, 'sub');
      assert.equal(pass.renderState.blend.opAlpha, 'max');
      assert.equal(pass.renderState.depthBias, 1);
      assert.equal(pass.renderState.depthBiasSlope, -1);
      assert.equal(pass.renderState.alphaToCoverage, true);

      const effect = emitCocosEffect(docIR);
      assert.ok(effect.includes('blendEq: sub'));
      assert.ok(effect.includes('blendAlphaEq: max'));
      assert.ok(effect.includes('depthBias: 1'));
      assert.ok(effect.includes('depthBiasSlope: -1'));
    });

    test('parses and emits comprehensive Stencil operations', () => {
      const shader = `
        Shader "Custom/StencilTest" {
          SubShader {
            Pass {
              Stencil {
                Ref 1
                Comp Equal
                Pass Keep
                Fail Replace
                ZFail IncrSat
                ReadMask 255
                WriteMask 255
              }
              CGPROGRAM
              #pragma vertex vert
              #pragma fragment frag
              float4 vert(float4 v:POSITION):SV_POSITION { return v; }
              float4 frag():SV_Target { return float4(1,1,1,1); }
              ENDCG
            }
          }
        }
      `;
      const docIR = parseShaderLab(shader);
      const pass = docIR.subShaders[0].passes[0];

      assert.equal(pass.renderState.stencil.enabled, true);
      assert.equal(pass.renderState.stencil.ref, 1);
      assert.equal(pass.renderState.stencil.comp, 'equal');
      assert.equal(pass.renderState.stencil.pass, 'keep');
      assert.equal(pass.renderState.stencil.fail, 'replace');
      assert.equal(pass.renderState.stencil.zFail, 'incr_sat');

      const effect = emitCocosEffect(docIR);
      assert.ok(effect.includes('stencilTest: true'));
      assert.ok(effect.includes('stencilFuncFront: equal'));
      assert.ok(effect.includes('stencilPassOpFront: keep'));
      assert.ok(effect.includes('stencilFailOpFront: replace'));
      assert.ok(effect.includes('stencilZFailOpFront: incr_sat'));
    });
  });

  describe('19. Texture and Sampler State Migration', () => {
    const { parseSamplerStates, buildTextureSamplerManifest } = require('./sampler-state-manager.cjs');
    const { lowerHlslToGlsl } = require('./unity-semantic-lowering.cjs');

    test('parses legacy Cg sampler_state blocks and extracts SamplerStateIR', () => {
      const code = `
        sampler2D _MainTex = sampler_state {
          Texture = <_MainTex>;
          AddressU = Wrap;
          AddressV = Clamp;
          MinFilter = Linear;
          MagFilter = Linear;
          MipFilter = Linear;
        };
      `;
      const states = parseSamplerStates(code);
      assert.ok(states._MainTex);
      assert.equal(states._MainTex.targetTexture, '_MainTex');
      assert.equal(states._MainTex.addressU, 'wrap');
      assert.equal(states._MainTex.addressV, 'clamp');
      assert.equal(states._MainTex.minFilter, 'linear');
      assert.equal(states._MainTex.magFilter, 'linear');

      const manifest = buildTextureSamplerManifest(
        [{ name: '_MainTex', type: 'sampler2D' }],
        states,
        { _MainTex: 'mainTexture' }
      );
      assert.equal(manifest._MainTex.cocosProperty, 'mainTexture');
      assert.equal(manifest._MainTex.samplerState.addressV, 'clamp');
    });

    test('lowers camera, screen, and projection built-in constants', () => {
      const code = `
        vec4 screen = _ScreenParams;
        vec4 proj = _ProjectionParams;
        vec4 zbuf = _ZBufferParams;
        vec4 ortho = _OrthoParams;
        vec4 sinT = _SinTime;
      `;
      const lowered = lowerHlslToGlsl(code);
      assert.ok(lowered.includes('cc_screenSize'));
      assert.ok(lowered.includes('cc_nearFar'));
      assert.ok(lowered.includes('cc_screenScale'));
      assert.ok(lowered.includes('sin('));
    });
  });

  describe('20. Surface Shader & PBR Intent Extractor', () => {
    const { parseSurfacePragma, extractSurfaceShaderIntent, detectPackedMaps } = require('./surface-shader-intent-extractor.cjs');

    test('parses #pragma surface directives and extracts surface intent', () => {
      const surfaceHlsl = `
        #pragma surface surf Standard fullforwardshadows
        struct Input {
          float2 uv_MainTex;
        };
        void surf(Input IN, inout SurfaceOutputStandard o) {
          fixed4 c = tex2D(_MainTex, IN.uv_MainTex) * _Color;
          o.Albedo = c.rgb;
          o.Metallic = _Metallic;
          o.Smoothness = _Glossiness;
          o.Emission = _EmissionColor.rgb;
          o.Alpha = c.a;
        }
      `;

      const pragma = parseSurfacePragma(surfaceHlsl);
      assert.equal(pragma.surfaceFunction, 'surf');
      assert.equal(pragma.lightingModel, 'Standard');
      assert.ok(pragma.options.includes('fullforwardshadows'));

      const intent = extractSurfaceShaderIntent(surfaceHlsl);
      assert.equal(intent.surfaceFunction, 'surf');
      assert.equal(intent.lightingModel, 'Standard');
      assert.equal(intent.outputFields.albedo, 'c.rgb');
      assert.equal(intent.outputFields.metallic, '_Metallic');
      assert.equal(intent.outputFields.smoothness, '_Glossiness');
      assert.equal(intent.outputFields.roughness, '(1.0 - (_Glossiness))');
      assert.equal(intent.outputFields.emission, '_EmissionColor.rgb');
      assert.equal(intent.outputFields.alpha, 'c.a');
    });

    test('detects packed maps (_MetallicGlossMap, _MaskMap)', () => {
      const samplers = [{ name: '_MetallicGlossMap' }, { name: '_MaskMap' }];
      const packed = detectPackedMaps(samplers);

      assert.ok(packed._MetallicGlossMap);
      assert.equal(packed._MetallicGlossMap.type, 'MetallicGlossMap');
      assert.equal(packed._MetallicGlossMap.channels.metallic, 'r');
      assert.equal(packed._MetallicGlossMap.channels.smoothness, 'a');

      assert.ok(packed._MaskMap);
      assert.equal(packed._MaskMap.type, 'MaskMap');
      assert.equal(packed._MaskMap.channels.occlusion, 'g');
    });
  });

  describe('21. Shader Family & Confidence Scoring Engine', () => {
    const { detectShaderFamily, calculateConfidenceBreakdown, UnityShaderFamily } = require('./confidence-evaluator.cjs');

    test('detects various Unity shader families', () => {
      assert.equal(detectShaderFamily({ shaderName: 'Universal Render Pipeline/Lit' }), UnityShaderFamily.URPLit);
      assert.equal(detectShaderFamily({ shaderName: 'Universal Render Pipeline/Unlit' }), UnityShaderFamily.URPUnlit);
      assert.equal(detectShaderFamily({ shaderName: 'Sprites/Default' }), UnityShaderFamily.Sprite);
      assert.equal(detectShaderFamily({ shaderName: 'Particles/Standard Surface' }), UnityShaderFamily.Particle);
      assert.equal(detectShaderFamily({ shaderName: 'Hidden/PostProcess' }), UnityShaderFamily.PostProcess);
      assert.equal(detectShaderFamily({ shaderName: 'Custom/ShaderGraph' }, 'ShaderGraphLibrary'), UnityShaderFamily.ShaderGraphGenerated);
    });

    test('calculates multi-tier sub-scores and reports deductions', () => {
      const docIR = {
        shaderName: 'Custom/TestShader',
        subShaders: [{ passes: [{ renderState: { blend: { enabled: true, srcRGB: 'one' } } }] }],
      };
      const effectText = `
        CCProgram vs %{ vec4 vert() { return vec4(1.0); } }%
        CCProgram fs %{ vec4 frag() { return vec4(1.0); } }%
      `;
      const validation = {
        errors: [],
        warnings: ['Residual UnityObjectToClipPos found in GLSL'],
      };

      const result = calculateConfidenceBreakdown(docIR, effectText, validation);
      assert.equal(result.breakdown.parse, 20);
      assert.equal(result.breakdown.hlslCompile, 25);
      assert.equal(result.breakdown.semanticMapping, 22); // 25 - 3
      assert.equal(result.breakdown.cocosAbi, 15);
      assert.equal(result.breakdown.renderState, 15);
      assert.equal(result.breakdown.final, 97);
      assert.equal(result.grade, 'A');
      assert.ok(result.deductions.some(d => d.category === 'semanticMapping'));
    });
  });

  describe('22. WebGL / Playable Optimization Linter & Optimizer', () => {
    const { lintWebGLPlayable, optimizePlayableEffect } = require('./webgl-playable-optimizer.cjs');

    test('lints WebGL compatibility rules and generates summary report', () => {
      const effectText = `
        CCProgram vs %{
          precision highp float;
          out vec4 v_uv0; out vec4 v_uv1; out vec4 v_uv2; out vec4 v_uv3;
          out vec4 v_uv4; out vec4 v_uv5; out vec4 v_uv6; out vec4 v_uv7;
          out vec4 v_uv8;
          vec4 vert() {
            for (int i = 0; i < u_dynamicCount; i++) {}
            return vec4(1.0);
          }
        }%
        CCProgram fs %{
          precision highp float;
          uniform sampler2D tex1; uniform sampler2D tex2; uniform sampler2D tex3;
          uniform sampler2D tex4; uniform sampler2D tex5; uniform sampler2D tex6;
          uniform sampler2D tex7; uniform sampler2D tex8; uniform sampler2D tex9;
          vec4 frag() {
            vec2 d = dFdx(v_uv0.xy);
            return textureLod(tex1, v_uv0.xy, 0.0);
          }
        }%
      `;

      const result = lintWebGLPlayable(effectText);
      assert.ok(result.issues.some(i => i.rule === 'dynamicLoopIndex'));
      assert.ok(result.issues.some(i => i.rule === 'samplerCountAboveProfileLimit'));
      assert.ok(result.issues.some(i => i.rule === 'highVaryingCount'));
      assert.ok(result.issues.some(i => i.rule === 'derivativeFunctions'));
      assert.ok(result.issues.some(i => i.rule === 'textureLodInFragment'));
      assert.equal(result.webgl1Fallback, 'FAIL');
    });

    test('optimizes playable effects (unused varyings, precision reduction, dead branch removal)', () => {
      const effectText = `
        CCProgram vs %{
          out vec4 v_used;
          out vec4 v_unused;
          vec4 vert() {
            v_used = vec4(1.0);
            v_unused = vec4(0.0);
            return vec4(1.0);
          }
        }%
        CCProgram fs %{
          precision highp float;
          in vec4 v_used;
          in vec4 v_unused;
          #if 0
          vec4 deadCode = vec4(0.0);
          #endif
          vec4 frag() {
            return v_used;
          }
        }%
      `;

      const opt = optimizePlayableEffect(effectText, { apply: true });
      assert.equal(opt.suggestions.length, 3);
      assert.ok(opt.suggestions.some(s => s.type === 'unusedVarying'));
      assert.ok(opt.suggestions.some(s => s.type === 'reducePrecision'));
      assert.ok(opt.suggestions.some(s => s.type === 'deadBranchRemoval'));
      assert.ok(opt.optimizedText.includes('precision mediump float;'));
      assert.ok(!opt.optimizedText.includes('v_unused'));
      assert.ok(!opt.optimizedText.includes('#if 0'));
    });
  });

  describe('23. AI-Polish Context & Structured Patch Generation', () => {
    const {
      generateUcstAiJson,
      generateStructuredPatch,
      generateReadmeAiPolishMd,
      getCocosShaderApi,
      queryHlslMapping,
    } = require('./ai-polish-patch-generator.cjs');

    test('generates per-shader ucst-ai.json with todos and dependencies', () => {
      const docIR = {
        shaderName: 'Game/Dissolve',
        sourceFile: 'Assets/Shaders/Dissolve.shader',
        family: 'CustomVertexFragment',
        properties: [{ name: '_MainTex', type: '2D' }, { name: '_DissolveTex', type: '2D' }],
        subShaders: [{ passes: [{ program: { includes: ['UnityCG.cginc'] } }] }],
      };
      const validation = {
        errors: ['Syntax error in frag'],
        warnings: ['Residual UnityObjectToClipPos found in GLSL'],
      };
      const scoreInfo = { score: 85, grade: 'B' };

      const aiJson = generateUcstAiJson(docIR, '', validation, scoreInfo);
      assert.equal(aiJson.shader, 'Game/Dissolve');
      assert.equal(aiJson.confidence, 85);
      assert.equal(aiJson.grade, 'B');
      assert.equal(aiJson.todos.length, 2);
      assert.ok(aiJson.todos.some(t => t.code.startsWith('UCST-ERR-')));
      assert.ok(aiJson.todos.some(t => t.code.startsWith('UCST-WARN-')));
      assert.deepEqual(aiJson.dependencies.includes, ['UnityCG.cginc']);
      assert.deepEqual(aiJson.dependencies.resources, ['_MainTex', '_DissolveTex']);
    });

    test('generates structured patch format identifying fragment chunk', () => {
      const docIR = { shaderName: 'Game/Dissolve' };
      const effectText = `
        CCProgram vs %{
          vec4 vert() { return vec4(1.0); }
        }%
        CCProgram fs %{
          vec4 frag() { return vec4(0.0); }
        }%
      `;

      const patch = generateStructuredPatch(docIR, effectText);
      assert.equal(patch.file, 'Dissolve.effect');
      assert.equal(patch.chunks.length, 1);
      assert.equal(patch.chunks[0].nodeId, 'fragment:body');
      assert.equal(patch.chunks[0].patch, 'replace');
      assert.ok(patch.chunks[0].startLine > 0);
    });

    test('generates minimal context README.ai-polish.md and exposes API helpers', () => {
      const docIR = {
        shaderName: 'Game/Dissolve',
        properties: [{ name: '_DissolveAmount', type: 'Float' }, { name: '_EmissionColor', type: 'Color' }],
      };
      const md = generateReadmeAiPolishMd(docIR, 'Shader "Game/Dissolve" {}', 'CCEffect %{}%');
      assert.ok(md.includes('# AI Polish Context: Game/Dissolve'));
      assert.ok(md.includes('Dissolve / Noise wipe + Emissive edge / glow.'));
      assert.ok(md.includes('Target Cocos Creator 3.8.8+'));

      const api = getCocosShaderApi();
      assert.equal(api.version, 'Cocos Creator 3.8.8+');
      assert.ok(api.builtins.includes('cc_matViewProj'));

      const mapping = queryHlslMapping('UnityObjectToClipPos');
      assert.ok(mapping.includes('cc_matViewProj'));
    });
  });

  describe('24. Validation & Differential Testing Expansion', () => {
    const {
      validateCocosEffect,
      compareSpirvDiff,
      validateWithGlslang,
      runShaderFixture,
    } = require('./validation-differential-runner.cjs');

    test('validates Cocos effect consistency (property/UBO, duplicate uniforms, sampler collisions)', () => {
      const docIR = {
        shaderName: 'TestConsistency',
        properties: [{ name: '_Color', cocosName: 'color', type: 'Color' }],
      };

      // Valid effect text
      const validText = `
        CCEffect %{
          techniques:
          - passes:
            - vert: vs:vert
              frag: fs:frag
        }%
        CCProgram vs %{
          #include <builtin/uniforms/cc-global>
          #include <builtin/uniforms/cc-local>
          out vec2 v_uv;
          vec4 vert() {
            return cc_matViewProj * cc_matWorld * vec4(1.0);
          }
        }%
        CCProgram fs %{
          #include <builtin/uniforms/cc-global>
          uniform Constants {
            vec4 color;
          };
          layout(set = 2, binding = 1) uniform sampler2D mainTexture;
          in vec2 v_uv;
          vec4 frag() {
            return color * texture(mainTexture, v_uv);
          }
        }%
      `;

      const validResult = validateCocosEffect(docIR, validText);
      assert.equal(validResult.valid, true);

      // Faulty text with sampler binding collision and duplicate uniform
      const faultyText = `
        CCEffect %{ techniques: [] passes: [] }%
        CCProgram vs %{ vec4 vert() { return vec4(1.0); } }%
        CCProgram fs %{
          uniform Constants {
            vec4 color;
            float color;
          };
          layout(set = 2, binding = 1) uniform sampler2D tex1;
          layout(set = 2, binding = 1) uniform sampler2D tex2;
          vec4 frag() { return vec4(1.0); }
        }%
      `;
      const faultyResult = validateCocosEffect(docIR, faultyText);
      assert.equal(faultyResult.valid, false);
      assert.ok(faultyResult.errors.some(e => e.includes('Duplicate uniform')));
      assert.ok(faultyResult.errors.some(e => e.includes('Sampler binding collision')));
    });

    test('compares SPIR-V instruction and branch differential metrics', () => {
      const hlslSource = 'mul(UNITY_MATRIX_MVP, v.vertex); tex2D(_MainTex, uv); if (x > 0.0) discard;';
      const glslSource = 'cc_matViewProj * cc_matWorld * vec4(pos, 1.0); texture(mainTexture, uv); if (x > 0.0) discard;';

      const diff = compareSpirvDiff(hlslSource, glslSource);
      assert.ok(diff.hlslInstructionEstimate > 0);
      assert.ok(diff.glslInstructionEstimate > 0);
      assert.equal(diff.hlslBranchCount, 2);
      assert.equal(diff.glslBranchCount, 2);
      assert.equal(diff.isFunctionallyEquivalent, true);
    });

    test('validates glslangValidator gracefully when host tool is present or missing', () => {
      const res = validateWithGlslang('void main() {}', 'frag');
      assert.ok(typeof res.valid === 'boolean');
    });
  });

  describe('25. CLI & Batch Workflow Enhancements', () => {
    const {
      computeCacheKey,
      cmdStats,
      cmdDiff,
      cmdMaterialMap,
      cmdAiContext,
      cmdBatch,
    } = require('./cli-batch-engine.cjs');

    test('computes deterministic cache keys sensitive to source, profile, and config', () => {
      const key1 = computeCacheKey('float x = 1.0;', [], 'playable-ad', { opt: true });
      const key2 = computeCacheKey('float x = 1.0;', [], 'playable-ad', { opt: true });
      const keyDiff = computeCacheKey('float x = 2.0;', [], 'playable-ad', { opt: true });

      assert.equal(key1, key2);
      assert.notEqual(key1, keyDiff);
    });

    test('executes CLI helpers (diff, material-map, ai-context)', () => {
      const tempDir = path.join(__dirname, '.temp-cli-test');
      fs.mkdirSync(tempDir, { recursive: true });

      const shaderPath = path.join(tempDir, 'Test.shader');
      fs.writeFileSync(shaderPath, 'Shader "Test/Shader" { SubShader { Pass { CGPROGRAM #pragma vertex vert\n#pragma fragment frag\nfixed4 frag() : SV_Target { return fixed4(1,1,1,1); } ENDCG } } }');

      const effectPath = path.join(tempDir, 'Test.effect');
      fs.writeFileSync(effectPath, 'CCEffect %{}% CCProgram vs %{ vec4 vert() { return vec4(1.0); } }% CCProgram fs %{ vec4 frag() { return vec4(1.0); } }%');

      const diff = cmdDiff(shaderPath, effectPath);
      assert.ok(diff !== null);

      const matPath = path.join(tempDir, 'Test.mat');
      fs.writeFileSync(matPath, 'Material:\n  m_SavedProperties:\n    m_Colors:\n      - _Color: {r: 1, g: 0, b: 0, a: 1}\n');

      const matMap = cmdMaterialMap(matPath, 'effects/Test.effect');
      assert.equal(matMap.material, 'Test');
      assert.equal(matMap.cocos.effect, 'effects/Test.effect');

      const aiContextJson = cmdAiContext(shaderPath, { format: 'json' });
      assert.equal(aiContextJson.shader, 'Test/Shader');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('26. Security & Robustness Hardening', () => {
    const {
      validateSafeIncludePath,
      validateSourceFileSize,
      validateOutputSizeCap,
      safeExecTool,
      withTempDir,
    } = require('./security-hardening.cjs');

    test('rejects path traversal attempts and null byte attacks in includes', () => {
      const allowedRoots = ['d:/_Projects/Unity/MyProject/Assets'];

      // Null byte attack
      assert.throws(() => {
        validateSafeIncludePath('file.cginc\x00.exe', allowedRoots);
      }, /Security Violation/);

      // Traversal escaping root
      assert.throws(() => {
        validateSafeIncludePath('../../../Windows/System32/drivers.hlsl', allowedRoots, 'd:/_Projects/Unity/MyProject/Assets/Shaders');
      }, /Security Violation/);
    });

    test('enforces file size caps and output size limits', () => {
      const hugeContent = 'a'.repeat(11 * 1024 * 1024);
      assert.throws(() => {
        validateSourceFileSize(hugeContent);
      }, /exceeds maximum allowed limit/);

      const hugeOutput = 'b'.repeat(6 * 1024 * 1024);
      assert.throws(() => {
        validateOutputSizeCap(hugeOutput);
      }, /exceeds maximum cap/);
    });

    test('guarantees temporary directory lifecycle and automatic cleanup', () => {
      let createdDir = null;
      withTempDir((dir) => {
        createdDir = dir;
        assert.ok(fs.existsSync(dir));
        fs.writeFileSync(path.join(dir, 'test.txt'), 'temp file');
      });
      // After callback finishes, directory must be automatically deleted
      assert.ok(!fs.existsSync(createdDir));
    });

    test('executes safe tool commands with argument arrays and timeout protection', () => {
      const res = safeExecTool('node', ['-e', 'console.log("SAFE_EXEC_OK")'], { timeout: 2000 });
      assert.equal(res.status, 0);
      assert.ok(res.stdout.includes('SAFE_EXEC_OK'));
    });
  });

  describe('27. Golden Fixture Expansion', () => {
    const { runAllGoldenFixtures } = require('./golden-fixture-runner.cjs');

    test('executes all structured golden fixtures with 100% pass rate', () => {
      const fixturesRoot = path.join(__dirname, 'fixtures');
      const results = runAllGoldenFixtures(fixturesRoot);

      assert.ok(results.length >= 3, `Expected at least 3 golden fixtures, found ${results.length}`);
      for (const res of results) {
        assert.equal(res.passed, true, `Golden fixture '${res.fixtureName}' failed: ${JSON.stringify(res.assertions)}`);
      }
    });
  });

});

















