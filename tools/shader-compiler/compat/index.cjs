'use strict';

/**
 * Built-in Unity / URP / ShaderGraph Compatibility Shims for UCShaderTranspiler
 * Expanded Function Library v2
 */

const UNITY_CG_SHIM = `
#ifndef UNITY_CG_INCLUDED
#define UNITY_CG_INCLUDED

struct appdata_base {
    float4 vertex : POSITION;
    float3 normal : NORMAL;
    float4 texcoord : TEXCOORD0;
};

struct appdata_tan {
    float4 vertex : POSITION;
    float4 tangent : TANGENT;
    float3 normal : NORMAL;
    float4 texcoord : TEXCOORD0;
};

struct appdata_full {
    float4 vertex : POSITION;
    float4 tangent : TANGENT;
    float3 normal : NORMAL;
    float4 texcoord : TEXCOORD0;
    float4 texcoord1 : TEXCOORD1;
    fixed4 color : COLOR;
};

struct appdata_img {
    float4 vertex : POSITION;
    half2 texcoord : TEXCOORD0;
};

#define TRANSFORM_TEX(tex,name) ((tex.xy) * name##_ST.xy + name##_ST.zw)
#define TRANSFORM_TEX_LOD(tex,name) ((tex.xy) * name##_ST.xy + name##_ST.zw)

vec3 UnpackNormalDXT5nm(vec4 packed) {
    vec3 normal;
    normal.xy = packed.wy * 2.0 - 1.0;
    normal.z = sqrt(max(0.0, 1.0 - dot(normal.xy, normal.xy)));
    return normal;
}

vec3 UnpackNormalmapRGorAG(vec4 packed) {
    #if defined(UNITY_NO_DXT5nm)
        return packed.xyz * 2.0 - 1.0;
    #else
        return UnpackNormalDXT5nm(packed);
    #endif
}

vec3 UnpackScaleNormal(vec4 packed, float bumpScale) {
    vec3 normal = packed.xyz * 2.0 - 1.0;
    normal.xy *= bumpScale;
    return normalize(normal);
}

vec3 DecodeLightmap(vec4 color) {
    return 2.0 * color.rgb;
}

vec4 DecodeHDR(vec4 data, vec4 decodeInstructions) {
    return vec4(data.rgb * (decodeInstructions.x * pow(data.a, decodeInstructions.y)), 1.0);
}

#endif
`;

const UNITY_SHADER_VARIABLES_SHIM = `
#ifndef UNITY_SHADER_VARIABLES_INCLUDED
#define UNITY_SHADER_VARIABLES_INCLUDED

#define UNITY_MATRIX_MVP (cc_matViewProj * cc_matWorld)
#define UNITY_MATRIX_MV  (cc_matView * cc_matWorld)
#define UNITY_MATRIX_V   cc_matView
#define UNITY_MATRIX_P   cc_matProj
#define UNITY_MATRIX_VP  cc_matViewProj
#define UNITY_MATRIX_T_MV transpose(cc_matView * cc_matWorld)
#define UNITY_MATRIX_IT_MV transpose(inverse(cc_matView * cc_matWorld))
#define UNITY_MATRIX_I_M cc_matWorldIT
#define UNITY_MATRIX_M   cc_matWorld

#define unity_ObjectToWorld cc_matWorld
#define unity_WorldToObject cc_matWorldIT
#define unity_WorldToCamera cc_matView
#define unity_CameraToWorld inverse(cc_matView)

#define _UCST_MatWorld cc_matWorld
#define _UCST_MatWorldIT cc_matWorldIT
#define _UCST_MatView cc_matView
#define _UCST_MatProj cc_matProj
#define _UCST_MatViewProj cc_matViewProj
#define _UCST_MatWorldToCamera cc_matView

#define UNITY_LIGHTMODEL_AMBIENT (cc_ambientSky.rgb)

#endif
`;

const LIGHTING_SHIM = `
#ifndef LIGHTING_INCLUDED
#define LIGHTING_INCLUDED

struct SurfaceOutput {
    fixed3 Albedo;
    fixed3 Normal;
    fixed3 Emission;
    half Specular;
    fixed Gloss;
    fixed Alpha;
};

vec3 WorldSpaceLightDir(vec4 v) {
    return normalize(-cc_mainLitDir.xyz);
}

vec3 ObjSpaceLightDir(vec4 v) {
    return normalize((cc_matWorldIT * vec4(-cc_mainLitDir.xyz, 0.0)).xyz);
}

vec3 Shade4PointLights(
    vec4 lightPosX, vec4 lightPosY, vec4 lightPosZ,
    vec3 lightColor0, vec3 lightColor1, vec3 lightColor2, vec3 lightColor3,
    vec4 lightAttenSq,
    vec3 pos, vec3 normal)
{
    // Simplified evaluation for portable mobile webgl
    float ndotl = max(0.0, dot(normal, -cc_mainLitDir.xyz));
    return cc_mainLitColor.rgb * ndotl;
}

vec3 ShadeVertexLights(vec4 vertex, vec3 normal) {
    float ndotl = max(0.0, dot(normal, -cc_mainLitDir.xyz));
    return cc_mainLitColor.rgb * ndotl + cc_ambientSky.rgb;
}

#endif
`;

const AUTOLIGHT_SHIM = `
#ifndef AUTOLIGHT_INCLUDED
#define AUTOLIGHT_INCLUDED

#define UNITY_LIGHTING_COORDS(idx1, idx2)
#define UNITY_TRANSFER_LIGHTING(a, coord)
#define UNITY_LIGHT_ATTENUATION(destName, input, worldPos) float destName = 1.0;

#define SHADOW_COORDS(idx)
#define TRANSFER_SHADOW(a)
#define SHADOW_ATTENUATION(a) 1.0

#endif
`;

const UNITY_GLOBAL_ILLUMINATION_SHIM = `
#ifndef UNITY_GLOBAL_ILLUMINATION_INCLUDED
#define UNITY_GLOBAL_ILLUMINATION_INCLUDED

struct UnityGI {
    vec3 light;
    vec3 indirect;
};

#endif
`;

const UNITY_SHADOW_LIBRARY_SHIM = `
#ifndef UNITY_SHADOW_LIBRARY_INCLUDED
#define UNITY_SHADOW_LIBRARY_INCLUDED

#define TRANSFER_SHADOW(a)
#define SHADOW_ATTENUATION(a) 1.0

#endif
`;

const HLSL_SUPPORT_SHIM = `
#ifndef HLSL_SUPPORT_INCLUDED
#define HLSL_SUPPORT_INCLUDED

#define fixed float
#define fixed2 vec2
#define fixed3 vec3
#define fixed4 vec4
#define half float
#define half2 vec2
#define half3 vec3
#define half4 vec4
#define float2 vec2
#define float3 vec3
#define float4 vec4
#define float4x4 mat4
#define float3x3 mat3
#define float2x2 mat2
#define lerp mix
#define frac fract
#define saturate(x) clamp(x, 0.0, 1.0)
#define rsqrt inversesqrt

#endif
`;

const { URP_CORE_HLSL_DECLARATIONS, SHADERGRAPH_NODE_FUNCTIONS } = require('../urp-shadergraph-rules.cjs');

const URP_CORE_SHIM = `
#ifndef UNIVERSAL_PIPELINE_CORE_INCLUDED
#define UNIVERSAL_PIPELINE_CORE_INCLUDED

#define TEXTURE2D(textureName) sampler2D textureName
#define SAMPLER(samplerName)
#define TEXTURECUBE(textureName) samplerCube textureName
#define SAMPLE_TEXTURE2D(textureName, samplerName, coord2) texture(textureName, coord2)
#define SAMPLE_TEXTURE2D_LOD(textureName, samplerName, coord2, lod) textureLod(textureName, coord2, lod)
#define SAMPLE_TEXTURECUBE(textureName, samplerName, coord3) texture(textureName, coord3)

#define TransformObjectToHClip(pos) (cc_matViewProj * cc_matWorld * vec4(pos.xyz, 1.0))
#define TransformWorldToHClip(posWS) (cc_matViewProj * vec4(posWS.xyz, 1.0))
#define TransformObjectToWorld(posOS) ((cc_matWorld * vec4(posOS.xyz, 1.0)).xyz)
#define TransformObjectToWorldNormal(normOS) normalize((cc_matWorldIT * vec4(normOS.xyz, 0.0)).xyz)
#define TransformWorldToObject(posWS) ((cc_matWorldIT * vec4(posWS.xyz, 1.0)).xyz)

#define GetCameraPositionWS() (cc_cameraPos.xyz)
#define GetViewForwardDir() (-cc_matView[2].xyz)

${URP_CORE_HLSL_DECLARATIONS}

#endif
`;

const URP_LIGHTING_SHIM = `
#ifndef UNIVERSAL_LIGHTING_INCLUDED
#define UNIVERSAL_LIGHTING_INCLUDED

struct Light {
    vec3 direction;
    vec3 color;
    float distanceAttenuation;
    float shadowAttenuation;
};

Light GetMainLight() {
    Light light;
    light.direction = -cc_mainLitDir.xyz;
    light.color = cc_mainLitColor.rgb * cc_mainLitColor.w;
    light.distanceAttenuation = 1.0;
    light.shadowAttenuation = 1.0;
    return light;
}

Light GetMainLight(vec4 shadowCoord) {
    return GetMainLight();
}

#endif
`;

const SHADERGRAPH_FUNCTIONS_SHIM = `
#ifndef SHADERGRAPH_FUNCTIONS_INCLUDED
#define SHADERGRAPH_FUNCTIONS_INCLUDED

${SHADERGRAPH_NODE_FUNCTIONS}

#endif
`;

const VIRTUAL_PACKAGE_MAP = {
  // Built-in Unity CG
  'unitycg.cginc': UNITY_CG_SHIM,
  'unityshadervariables.cginc': UNITY_SHADER_VARIABLES_SHIM,
  'lighting.cginc': LIGHTING_SHIM,
  'autolight.cginc': AUTOLIGHT_SHIM,
  'unityglobalillumination.cginc': UNITY_GLOBAL_ILLUMINATION_SHIM,
  'unityshadowlibrary.cginc': UNITY_SHADOW_LIBRARY_SHIM,
  'hlslsupport.cginc': HLSL_SUPPORT_SHIM,

  // URP
  'packages/com.unity.render-pipelines.universal/shaderlibrary/core.hlsl': URP_CORE_SHIM,
  'packages/com.unity.render-pipelines.universal/shaderlibrary/lighting.hlsl': URP_LIGHTING_SHIM,
  'packages/com.unity.render-pipelines.universal/shaderlibrary/input.hlsl': URP_CORE_SHIM,
  'packages/com.unity.render-pipelines.universal/shaderlibrary/commongroup.hlsl': URP_CORE_SHIM,
  'packages/com.unity.render-pipelines.universal/shaderlibrary/declaredepthtexture.hlsl': URP_CORE_SHIM,
  'packages/com.unity.render-pipelines.universal/shaderlibrary/shadows.hlsl': URP_LIGHTING_SHIM,
  'packages/com.unity.render-pipelines.universal/shaderlibrary/surfaceinput.hlsl': URP_CORE_SHIM,

  // ShaderGraph
  'packages/com.unity.shadergraph/shadergraphlibrary/functions.hlsl': SHADERGRAPH_FUNCTIONS_SHIM,
  'packages/com.unity.shadergraph/shadergraphlibrary/shadervariablesfunctions.hlsl': SHADERGRAPH_FUNCTIONS_SHIM,
  'packages/com.unity.shadergraph/shadergraphlibrary/shadervariables.hlsl': SHADERGRAPH_FUNCTIONS_SHIM,
  'shadergraphlibrary/pass.hlsl': SHADERGRAPH_FUNCTIONS_SHIM,
};

module.exports = {
  UNITY_CG_SHIM,
  UNITY_SHADER_VARIABLES_SHIM,
  LIGHTING_SHIM,
  AUTOLIGHT_SHIM,
  UNITY_GLOBAL_ILLUMINATION_SHIM,
  UNITY_SHADOW_LIBRARY_SHIM,
  HLSL_SUPPORT_SHIM,
  URP_CORE_SHIM,
  URP_LIGHTING_SHIM,
  SHADERGRAPH_FUNCTIONS_SHIM,
  VIRTUAL_PACKAGE_MAP,
};
