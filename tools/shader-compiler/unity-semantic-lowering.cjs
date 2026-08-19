'use strict';

/**
 * Unity HLSL/Cg -> GLSL 300 ES & Cocos Creator 3.8.8 Semantic Lowering Engine
 * Expanded Built-in Function Library v2
 */

const { lowerUrpFunctions } = require('./urp-shadergraph-rules.cjs');
const { lowerBuiltinConstants } = require('./sampler-state-manager.cjs');

const DEFAULT_PRECISION_CONFIG = {
  fixed: 'mediump',
  half: 'mediump',
  float: 'highp',
  min16float: 'mediump',
};

function lowerHlslToGlsl(code, options = {}) {
  if (!code) return '';

  let out = code;
  const precisionConfig = { ...DEFAULT_PRECISION_CONFIG, ...(options.precision || {}) };

  // 1. Strip Unity Boilerplate / Stereo / Instancing / Loop Macros
  out = out.replace(/\bUNITY_SETUP_INSTANCE_ID\s*\([^)]*\);?/g, '');
  out = out.replace(/\bUNITY_TRANSFER_INSTANCE_ID\s*\([^)]*\);?/g, '');
  out = out.replace(/\bUNITY_INITIALIZE_OUTPUT\s*\([^)]*\);?/g, '');
  out = out.replace(/\bUNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX\s*\([^)]*\);?/g, '');
  out = out.replace(/\bUNITY_TRANSFER_FOG\s*\([^)]*\);?/g, '');
  out = out.replace(/\bUNITY_APPLY_FOG\s*\([^)]*\);?/g, '');
  out = out.replace(/\bUNITY_FOG_COORDS\s*\([^)]*\)/g, '');
  out = out.replace(/\bUNITY_CALC_FOG_FACTOR\s*\([^)]*\)/g, '1.0');
  out = out.replace(/\bUNITY_VERTEX_INPUT_INSTANCE_ID\b/g, '');
  out = out.replace(/\bUNITY_VERTEX_OUTPUT_STEREO\b/g, '');
  out = out.replace(/\bUNITY_DECLARE_DEPTH_TEXTURE\s*\([^)]*\);?/g, '');
  out = out.replace(/\bSAMPLER\s*\([^)]*\);?/g, '');
  out = out.replace(/\bTEXTURE2D\s*\(\s*([A-Za-z_]\w*)\s*\);?/g, 'uniform sampler2D $1;');
  out = out.replace(/\bTEXTURECUBE\s*\(\s*([A-Za-z_]\w*)\s*\);?/g, 'uniform samplerCube $1;');
  out = out.replace(/\bTEXTURE3D\s*\(\s*([A-Za-z_]\w*)\s*\);?/g, 'uniform sampler3D $1;');
  out = out.replace(/\[\s*(?:unroll|loop|flatten|branch)\s*\]/gi, '');

  // 2. Extended Semantics Lowering
  out = out.replace(/\bSV_VertexID\b/g, 'gl_VertexID');
  out = out.replace(/\bSV_InstanceID\b/g, 'gl_InstanceID');

  // 3. Transform & Camera Helpers
  out = out.replace(/\bTransformWorldToHClip\s*\(\s*([^)]+)\s*\)/g, (match, expr) => {
    return `(cc_matViewProj * vec4((${expr.trim()}).xyz, 1.0))`;
  });

  out = out.replace(/\b(?:UnityObjectToClipPos|TransformObjectToHClip)\s*\(\s*([^)]+)\s*\)/g, (match, expr) => {
    const trimmed = expr.trim();
    if (trimmed.endsWith('.xyz')) {
      return `(cc_matViewProj * cc_matWorld * vec4(${trimmed}, 1.0))`;
    }
    return `(cc_matViewProj * cc_matWorld * vec4((${trimmed}).xyz, 1.0))`;
  });

  out = out.replace(/\b(?:UnityObjectToWorldPos|TransformObjectToWorld)\s*\(\s*([^)]+)\s*\)/g, (match, expr) => {
    return `((cc_matWorld * vec4((${expr.trim()}).xyz, 1.0)).xyz)`;
  });

  out = out.replace(/\b(?:UnityWorldToObjectPos|TransformWorldToObject)\s*\(\s*([^)]+)\s*\)/g, (match, expr) => {
    return `((cc_matWorldIT * vec4((${expr.trim()}).xyz, 1.0)).xyz)`;
  });

  out = out.replace(/\b(?:UnityObjectToWorldNormal|TransformObjectToWorldNormal)\s*\(\s*([^)]+)\s*\)/g, (match, expr) => {
    return `normalize((cc_matWorldIT * vec4((${expr.trim()}).xyz, 0.0)).xyz)`;
  });

  out = out.replace(/\b(?:UnityObjectToWorldDir|TransformObjectToWorldDir)\s*\(\s*([^)]+)\s*\)/g, (match, expr) => {
    return `normalize((cc_matWorld * vec4((${expr.trim()}).xyz, 0.0)).xyz)`;
  });

  out = out.replace(/\b(?:WorldSpaceViewDir|GetWorldSpaceViewDir|UnityWorldSpaceViewDir)\s*\(\s*([^)]+)\s*\)/g, (match, expr) => {
    return `(cc_cameraPos.xyz - (${expr.trim()}).xyz)`;
  });

  out = out.replace(/\bObjSpaceViewDir\s*\(\s*([^)]+)\s*\)/g, (match, expr) => {
    return `(((cc_matWorldIT * vec4(cc_cameraPos.xyz, 1.0)).xyz) - (${expr.trim()}).xyz)`;
  });

  out = out.replace(/\b(?:TRANSFORM_TEX|TRANSFORM_TEX_LOD)\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, (match, uv, tex) => {
    return `((${uv.trim()}).xy * ${tex.trim()}_ST.xy + ${tex.trim()}_ST.zw)`;
  });

  out = out.replace(/\b(?:ComputeScreenPos|UnityViewToScreenPos)\s*\(\s*([^)]+)\s*\)/g, (match, pos) => {
    return `vec4(vec2((${pos.trim()}).x, (${pos.trim()}).y) * 0.5 + vec2((${pos.trim()}).w * 0.5), (${pos.trim()}).zw)`;
  });

  // Normal unpack helpers
  out = out.replace(/\bUnpackNormalDXT5nm\s*\(\s*([^)]+)\s*\)/g, (match, packed) => {
    return `vec3((${packed.trim()}).wy * 2.0 - 1.0, sqrt(max(0.0, 1.0 - dot((${packed.trim()}).wy * 2.0 - 1.0, (${packed.trim()}).wy * 2.0 - 1.0))))`;
  });

  out = out.replace(/\bUnpackScaleNormal\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, (match, packed, scale) => {
    return `normalize(vec3(((${packed.trim()}).rgb * 2.0 - 1.0).xy * (${scale.trim()}), ((${packed.trim()}).rgb * 2.0 - 1.0).z))`;
  });

  out = out.replace(/\bUnpackNormal\s*\(\s*([^)]+)\s*\)/g, (match, packed) => {
    return `((${packed.trim()}).rgb * 2.0 - 1.0)`;
  });

  // Lighting helpers
  out = out.replace(/\bWorldSpaceLightDir\s*\(\s*([^)]*)\s*\)/g, 'normalize(-cc_mainLitDir.xyz)');
  out = out.replace(/\bObjSpaceLightDir\s*\(\s*([^)]*)\s*\)/g, 'normalize((cc_matWorldIT * vec4(-cc_mainLitDir.xyz, 0.0)).xyz)');
  out = out.replace(/\bUNITY_LIGHTMODEL_AMBIENT\b/g, 'cc_ambientSky.rgb');
  out = out.replace(/\bunity_LightColor\b/g, 'cc_mainLitColor');
  out = out.replace(/\bunity_LightPosition\b/g, 'vec4(-cc_mainLitDir.xyz, 0.0)');
  out = out.replace(/\bunity_4LightPos[XYZ]0\b/g, 'vec4(0.0)');
  out = out.replace(/\bunity_4LightAtten0\b/g, 'vec4(0.0)');

  // Shadows / Lightmaps
  out = out.replace(/\bSHADOW_COORDS\s*\([^)]*\)/g, '');
  out = out.replace(/\bTRANSFER_SHADOW\s*\([^)]*\);?/g, '');
  out = out.replace(/\bSHADOW_ATTENUATION\s*\([^)]*\)/g, '1.0');
  out = out.replace(/\bDecodeLightmap\s*\(\s*([^)]+)\s*\)/g, '(2.0 * (${1}).rgb)');
  out = out.replace(/\bunity_ShadowMask\b/g, 'vec4(1.0)');

  // 4. Matrix & Built-in Variables Mapping
  out = out.replace(/\b(?:UNITY_MATRIX_MVP|unity_MatrixMVP)\b/g, '(cc_matViewProj * cc_matWorld)');
  out = out.replace(/\b(?:UNITY_MATRIX_MV|unity_MatrixMV)\b/g, '(cc_matView * cc_matWorld)');
  out = out.replace(/\b(?:UNITY_MATRIX_M|unity_MatrixM|unity_ObjectToWorld|_UCST_MatWorld)\b/g, 'cc_matWorld');
  out = out.replace(/\b(?:unity_WorldToObject|unity_MatrixInvM|UNITY_MATRIX_I_M|_UCST_MatWorldIT)\b/g, 'cc_matWorldIT');
  out = out.replace(/\b(?:UNITY_MATRIX_V|unity_MatrixV|unity_WorldToCamera|_UCST_MatView|_UCST_MatWorldToCamera)\b/g, 'cc_matView');
  out = out.replace(/\b(?:unity_CameraToWorld)\b/g, 'inverse(cc_matView)');
  out = out.replace(/\b(?:UNITY_MATRIX_P|unity_MatrixP|_UCST_MatProj)\b/g, 'cc_matProj');
  out = out.replace(/\b(?:UNITY_MATRIX_VP|unity_MatrixVP|_UCST_MatViewProj)\b/g, 'cc_matViewProj');
  out = out.replace(/\bUNITY_MATRIX_T_MV\b/g, 'transpose(cc_matView * cc_matWorld)');
  out = out.replace(/\bUNITY_MATRIX_IT_MV\b/g, 'transpose(inverse(cc_matView * cc_matWorld))');

  out = out.replace(/\b_WorldSpaceCameraPos\b/g, 'cc_cameraPos.xyz');
  out = out.replace(/\b_ScreenParams\b/g, 'cc_screenSize');
  out = out.replace(/\b_MainLightPosition\b/g, '(-cc_mainLitDir)');
  out = out.replace(/\b_WorldSpaceLightPos0\b/g, 'vec4(-cc_mainLitDir.xyz, 0.0)');
  out = out.replace(/\b_MainLightColor\b/g, 'cc_mainLitColor');
  out = out.replace(/\b_LightColor0\b/g, 'cc_mainLitColor');

  // Time variables
  out = out.replace(/\b_Time\.y\b/g, 'cc_time.x');
  out = out.replace(/\b_Time\.x\b/g, '(cc_time.x * 0.05)');
  out = out.replace(/\b_Time\.z\b/g, '(cc_time.x * 2.0)');
  out = out.replace(/\b_Time\.w\b/g, '(cc_time.x * 3.0)');
  out = out.replace(/\b_Time\b/g, 'vec4(cc_time.x * 0.05, cc_time.x, cc_time.x * 2.0, cc_time.x * 3.0)');

  out = out.replace(/\b_SinTime\.w\b/g, 'sin(cc_time.x)');
  out = out.replace(/\b_CosTime\.w\b/g, 'cos(cc_time.x)');

  // 5. Texture Sampling Functions
  out = out.replace(/\b([A-Za-z_]\w*)\.SampleLevel\s*\(\s*[^,]+\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, 'textureLod($1, $2, $3)');
  out = out.replace(/\b([A-Za-z_]\w*)\.Sample\s*\(\s*[^,]+\s*,\s*([^)]+)\s*\)/g, 'texture($1, $2)');
  out = out.replace(/\bSAMPLE_TEXTURE2D_LOD\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, 'textureLod($1, $3, $4)');
  out = out.replace(/\bSAMPLE_TEXTURE2D\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, 'texture($1, $3)');
  out = out.replace(/\bSAMPLE_TEXTURECUBE_LOD\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, 'textureLod($1, $3, $4)');
  out = out.replace(/\bSAMPLE_TEXTURECUBE\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, 'texture($1, $3)');
  out = out.replace(/\bSAMPLE_TEXTURE3D\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, 'texture($1, $3)');

  out = out.replace(/\btex2Dlod\s*\(\s*([^,]+)\s*,\s*(?:vec4|float4)\s*\(\s*([^,]+)\s*,\s*[^,]+\s*,\s*([^)]+)\s*\)\s*\)/g, 'textureLod($1, $2, $3)');
  out = out.replace(/\btex2Dlod\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, (m, tex, coord) => {
    return `textureLod(${tex}, (${coord}).xy, (${coord}).w)`;
  });
  out = out.replace(/\btex2Dproj\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, 'textureProj($1, $2)');
  out = out.replace(/\btex2D\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, 'texture($1, $2)');
  out = out.replace(/\btexCUBElod\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, (m, cube, coord) => {
    return `textureLod(${cube}, (${coord}).xyz, (${coord}).w)`;
  });
  out = out.replace(/\btexCUBE\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, 'texture($1, $2)');
  out = out.replace(/\btex3Dlod\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, (m, vol, coord) => {
    return `textureLod(${vol}, (${coord}).xyz, (${coord}).w)`;
  });
  out = out.replace(/\btex3D\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, 'texture($1, $2)');

  // 6. HLSL Math Intrinsics
  out = out.replace(/\blerp\s*\(/g, 'mix(');
  out = out.replace(/\bfrac\s*\(/g, 'fract(');
  out = out.replace(/\bsaturate\s*\(\s*([^)]+)\s*\)/g, 'clamp($1, 0.0, 1.0)');
  out = out.replace(/\brsqrt\s*\(/g, 'inversesqrt(');
  out = out.replace(/\bddx\s*\(/g, 'dFdx(');
  out = out.replace(/\bddy\s*\(/g, 'dFdy(');
  out = out.replace(/\batan2\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, 'atan($1, $2)');
  out = out.replace(/\bfmod\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, 'mod($1, $2)');

  // clip() intrinsic
  out = out.replace(/\bclip\s*\(\s*([^)]+)\s*\)\s*;/g, (match, expr) => {
    return `if ((${expr.trim()}) < 0.0) { discard; }`;
  });

  // 7. mul() Overloads
  out = out.replace(/\bmul\s*\(\s*\((?:float3x3|half3x3|mat3)\)\s*([A-Za-z0-9_]+)\s*,\s*([^)]+)\s*\)/g, (match, mName, vName) => {
    return `(mat3(${mName}) * (${vName.trim()}))`;
  });

  out = out.replace(/\bmul\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, (match, a, b) => {
    return `(${a.trim()} * ${b.trim()})`;
  });

  // 8. Types
  out = out.replace(/\bfloat4x4\b/g, 'mat4');
  out = out.replace(/\bfloat3x3\b/g, 'mat3');
  out = out.replace(/\bfloat2x2\b/g, 'mat2');
  out = out.replace(/\bhalf4x4\b/g, 'mat4');
  out = out.replace(/\bhalf3x3\b/g, 'mat3');
  out = out.replace(/\bhalf2x2\b/g, 'mat2');

  out = out.replace(/\b(?:float4|half4|fixed4|min16float4)\b/g, 'vec4');
  out = out.replace(/\b(?:float3|half3|fixed3|min16float3)\b/g, 'vec3');
  out = out.replace(/\b(?:float2|half2|fixed2|min16float2)\b/g, 'vec2');
  out = out.replace(/\b(?:half|fixed|min16float)\b/g, 'float');
  out = out.replace(/\bint4\b/g, 'ivec4');
  out = out.replace(/\bint3\b/g, 'ivec3');
  out = out.replace(/\bint2\b/g, 'ivec2');
  out = out.replace(/\bbool4\b/g, 'bvec4');
  out = out.replace(/\bbool3\b/g, 'bvec3');
  out = out.replace(/\bbool2\b/g, 'bvec2');

  out = out.replace(/\binline\s+/g, '');

  // 9. URP & ShaderGraph Library Functions Lowering
  out = lowerUrpFunctions(out);

  // 10. Texture & Screen Built-in Constants Lowering
  out = lowerBuiltinConstants(out);

  return out;
}

module.exports = {
  lowerHlslToGlsl,
  DEFAULT_PRECISION_CONFIG,
};
