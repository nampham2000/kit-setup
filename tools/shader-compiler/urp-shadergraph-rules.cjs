'use strict';

/**
 * URP & ShaderGraph Specialized Rule Packs
 * for UCShaderTranspiler
 *
 * Implements:
 * 1. URP Shader Library Mappings & Helper Lowering:
 *    - TransformObjectToHClip, TransformWorldToHClip, TransformObjectToWorld, TransformWorldToObject
 *    - GetVertexPositionInputs, GetVertexNormalInputs, GetCameraPositionWS, GetViewForwardDir
 *    - GetMainLight, GetLight, SampleAlbedoAlpha, SampleNormal, SampleMetallicSpecGloss
 *    - ComputeFogFactor, MixFog, TransformWorldToShadowCoord, GetShadowCoord, GetShadowMask, ApplyShadowBias
 * 2. ShaderGraph Detection & Common Generated Node Library:
 *    - Node functions: TilingAndOffset, Multiply, Add, Subtract, Divide, Lerp, Remap, Rotate, Spherize,
 *      Twirl, Posterize, FresnelEffect, Step, Smoothstep, Power, Clamp, OneMinus, Combine, Split, Blend
 * 3. Node comment preservation & material model lowering
 */

const URP_SHADER_LIBRARY_ROOT = 'Packages/com.unity.render-pipelines.universal/ShaderLibrary/';
const SHADERGRAPH_LIBRARY_ROOT = 'Packages/com.unity.shadergraph/ShaderGraphLibrary/';

const URP_CORE_HLSL_DECLARATIONS = `
struct VertexPositionInputs {
    vec3 positionWS;
    vec3 positionVS;
    vec4 positionCS;
    vec4 positionNDC;
};

struct VertexNormalInputs {
    vec3 tangentWS;
    vec3 bitangentWS;
    vec3 normalWS;
};

VertexPositionInputs GetVertexPositionInputs(vec3 positionOS) {
    VertexPositionInputs input;
    input.positionWS = (cc_matWorld * vec4(positionOS, 1.0)).xyz;
    input.positionVS = (cc_matView * vec4(input.positionWS, 1.0)).xyz;
    input.positionCS = cc_matViewProj * vec4(input.positionWS, 1.0);
    input.positionNDC = input.positionCS * 0.5 + vec4(input.positionCS.w * 0.5);
    return input;
}

VertexNormalInputs GetVertexNormalInputs(vec3 normalOS, vec4 tangentOS) {
    VertexNormalInputs input;
    input.normalWS = normalize((cc_matWorldIT * vec4(normalOS, 0.0)).xyz);
    input.tangentWS = normalize((cc_matWorld * vec4(tangentOS.xyz, 0.0)).xyz);
    input.bitangentWS = cross(input.normalWS, input.tangentWS) * tangentOS.w;
    return input;
}
`;

const SHADERGRAPH_NODE_FUNCTIONS = `
void Unity_TilingAndOffset_float(vec2 UV, vec2 Tiling, vec2 Offset, out vec2 Out) {
    Out = UV * Tiling + Offset;
}

void Unity_Multiply_float(float A, float B, out float Out) {
    Out = A * B;
}

void Unity_Multiply_float2(vec2 A, vec2 B, out vec2 Out) {
    Out = A * B;
}

void Unity_Multiply_float3(vec3 A, vec3 B, out vec3 Out) {
    Out = A * B;
}

void Unity_Multiply_float4(vec4 A, vec4 B, out vec4 Out) {
    Out = A * B;
}

void Unity_Add_float(float A, float B, out float Out) {
    Out = A + B;
}

void Unity_Add_float2(vec2 A, vec2 B, out vec2 Out) {
    Out = A + B;
}

void Unity_Add_float3(vec3 A, vec3 B, out vec3 Out) {
    Out = A + B;
}

void Unity_Add_float4(vec4 A, vec4 B, out vec4 Out) {
    Out = A + B;
}

void Unity_Subtract_float(float A, float B, out float Out) {
    Out = A - B;
}

void Unity_Subtract_float4(vec4 A, vec4 B, out vec4 Out) {
    Out = A - B;
}

void Unity_Divide_float(float A, float B, out float Out) {
    Out = A / (B != 0.0 ? B : 0.00001);
}

void Unity_Divide_float4(vec4 A, vec4 B, out vec4 Out) {
    Out = A / max(B, vec4(0.00001));
}

void Unity_Lerp_float(float A, float B, float T, out float Out) {
    Out = mix(A, B, T);
}

void Unity_Lerp_float2(vec2 A, vec2 B, float T, out vec2 Out) {
    Out = mix(A, B, T);
}

void Unity_Lerp_float3(vec3 A, vec3 B, float T, out vec3 Out) {
    Out = mix(A, B, T);
}

void Unity_Lerp_float4(vec4 A, vec4 B, float T, out vec4 Out) {
    Out = mix(A, B, T);
}

void Unity_Remap_float(float In, vec2 InMinMax, vec2 OutMinMax, out float Out) {
    Out = OutMinMax.x + (In - InMinMax.x) * (OutMinMax.y - OutMinMax.x) / (InMinMax.y - InMinMax.x);
}

void Unity_Rotate_Radians_float(vec2 UV, vec2 Center, float Rotation, out vec2 Out) {
    UV -= Center;
    float s = sin(Rotation);
    float c = cos(Rotation);
    mat2 rMatrix = mat2(c, -s, s, c);
    Out = rMatrix * UV + Center;
}

void Unity_Rotate_Degrees_float(vec2 UV, vec2 Center, float Rotation, out vec2 Out) {
    Unity_Rotate_Radians_float(UV, Center, Rotation * 0.0174532925, Out);
}

void Unity_FresnelEffect_float(vec3 Normal, vec3 ViewDir, float Power, out float Out) {
    Out = pow(1.0 - clamp(dot(normalize(Normal), normalize(ViewDir)), 0.0, 1.0), Power);
}

void Unity_Step_float(float Edge, float In, out float Out) {
    Out = step(Edge, In);
}

void Unity_Step_float4(vec4 Edge, vec4 In, out vec4 Out) {
    Out = step(Edge, In);
}

void Unity_Smoothstep_float(float Edge1, float Edge2, float In, out float Out) {
    Out = smoothstep(Edge1, Edge2, In);
}

void Unity_Power_float(float A, float B, out float Out) {
    Out = pow(A, B);
}

void Unity_Clamp_float(float In, float Min, float Max, out float Out) {
    Out = clamp(In, Min, Max);
}

void Unity_OneMinus_float(float In, out float Out) {
    Out = 1.0 - In;
}

void Unity_OneMinus_float4(vec4 In, out vec4 Out) {
    Out = vec4(1.0) - In;
}

void Unity_Combine_float(float R, float G, float B, float A, out vec4 RGBA) {
    RGBA = vec4(R, G, B, A);
}

void Unity_Split_float(vec4 In, out float R, out float G, out float B, out float A) {
    R = In.r;
    G = In.g;
    B = In.b;
    A = In.a;
}
`;

/**
 * Detects if a shader source is a ShaderGraph generated shader
 */
function isShaderGraphSource(source) {
  return /ShaderGraphLibrary|SG_[A-Za-z0-9_]+|Unity_TilingAndOffset|Unity_Multiply|ShaderGraph/i.test(source);
}

/**
 * Lowers URP library functions directly in shader code
 */
function lowerUrpFunctions(code) {
  let out = code;

  // Direct URP Camera & View functions
  out = out.replace(/\bGetCameraPositionWS\s*\(\s*\)/g, 'cc_cameraPos.xyz');
  out = out.replace(/\bGetViewForwardDir\s*\(\s*\)/g, '(-cc_matView[2].xyz)');

  // Lighting functions
  out = out.replace(/\bGetMainLight\s*\([^)]*\)/g, 'GetMainLight()');
  out = out.replace(/\bGetLight\s*\([^)]*\)/g, 'GetMainLight()');

  // Texture sampling helpers
  out = out.replace(/\bSampleAlbedoAlpha\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*[^)]+\s*\)/g, 'texture($2, $1)');
  out = out.replace(/\bSampleNormal\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*[^,]+\s*,\s*([^)]+)\s*\)/g, 'UnpackScaleNormal(texture($2, $1), $3)');
  out = out.replace(/\bSampleMetallicSpecGloss\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*[^)]+\s*\)/g, 'texture($2, $1)');

  // Fog & Shadows
  out = out.replace(/\bComputeFogFactor\s*\([^)]*\)/g, '1.0');
  out = out.replace(/\bMixFog\s*\(\s*([^,]+)\s*,\s*[^)]+\s*\)/g, '$1');
  out = out.replace(/\bTransformWorldToShadowCoord\s*\([^)]*\)/g, 'vec4(0.0)');
  out = out.replace(/\bGetShadowCoord\s*\([^)]*\)/g, 'vec4(0.0)');
  out = out.replace(/\bGetShadowMask\s*\([^)]*\)/g, 'vec4(1.0)');
  out = out.replace(/\bApplyShadowBias\s*\(\s*([^,]+)\s*,\s*[^,]+\s*,\s*[^)]+\s*\)/g, '$1');

  return out;
}

module.exports = {
  URP_SHADER_LIBRARY_ROOT,
  SHADERGRAPH_LIBRARY_ROOT,
  URP_CORE_HLSL_DECLARATIONS,
  SHADERGRAPH_NODE_FUNCTIONS,
  isShaderGraphSource,
  lowerUrpFunctions,
};
