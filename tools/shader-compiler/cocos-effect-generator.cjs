'use strict';

/**
 * Cocos Creator 3.8.8+ .effect Generator (EffectEmitter)
 *
 * Emits complete, valid Cocos Creator `.effect` files:
 * - CCEffect YAML frontmatter (techniques, passes, rasterizerState, depthStencilState, blendState, properties)
 * - CCProgram vs / CCProgram fs with 3-tier Descriptor Sets (Set 0, Set 1, Set 2)
 * - Cocos Surface Shader mode (CCProgram surface-vertex, CCProgram surface-fragment)
 * - Single-pass Lighting lowering & Normal map unpack helpers
 * - Optional Cocos .mtl material generator
 */

const fs = require('fs');
const path = require('path');
const { buildStd140Ubo } = require('./ubo-layout-builder.cjs');
const { lowerHlslToGlsl } = require('./unity-semantic-lowering.cjs');
const { allocateBindings } = require('./binding-allocator.cjs');
const { extractSurfaceShaderIntent, detectPackedMaps } = require('./surface-shader-intent-extractor.cjs');

/**
 * Lớp tương thích HLSL->GLSL, inline vào program nào thực sự dùng tới.
 *
 * Chỉ chèn khi có tham chiếu: một effect unlit đơn giản không cần 40 dòng helper,
 * và chèn thừa sẽ làm lệch mọi golden fixture đang có.
 */
const UNITY_COMPAT_GLSL = fs.readFileSync(path.join(__dirname, 'compat', 'unity-compat.glsl'), 'utf8').trimEnd();

/** Tên các helper trong lớp tương thích; dùng để biết có cần chèn hay không. */
const UNITY_COMPAT_SYMBOLS = /\b(?:texU|hmod|rotRow|rotCol|sat|CLIP)\s*\(/;

/** Trả về khối helper (đã thụt lề) nếu `code` có dùng, ngược lại trả chuỗi rỗng. */
function unityCompatBlockFor(code) {
  if (!code || !UNITY_COMPAT_SYMBOLS.test(code)) return '';
  return '  ' + UNITY_COMPAT_GLSL.split('\n').join('\n  ') + '\n';
}

/** Các trường mang mã HLSL thô của một hàm trong IR. */
const IR_BODY_FIELDS = ['raw', 'body'];

const LOCAL_DECL_TYPES = '(?:float|half|fixed|min16float|int|bool)(?:[234](?:x[234])?)?';

/**
 * Tên property nào bị một biến cục bộ trong thân shader dùng trùng?
 *
 * Chỉ quan trọng khi có đóng gói scalar: alias `#define alpha pack0.x` sẽ biến dòng
 * `float alpha = ...` thành `float pack0.x = ...`. AllIn1SpriteShader có đúng ca này
 * (`_Alpha` và biến `alpha` trong nhánh HOLOGRAM).
 */
function findLocalNameCollisions(programIR, aliasNames) {
  const probe = (programIR.functions || [])
    .map((f) => IR_BODY_FIELDS.map((k) => f[k] || '').join('\n'))
    .join('\n');
  return aliasNames.filter((name) => new RegExp(`\\b${LOCAL_DECL_TYPES}\\s+${name}\\s*[=;,)]`).test(probe));
}

/** Đổi tên biến cục bộ trong HLSL thô để nhường tên cho property. */
function renameLocals(programIR, names) {
  for (const f of programIR.functions || []) {
    for (const key of IR_BODY_FIELDS) {
      if (typeof f[key] !== 'string') continue;
      for (const name of names) {
        f[key] = f[key].replace(new RegExp(`\\b${name}\\b`, 'g'), `${name}_local`);
      }
    }
  }
}

/**
 * Fragment shader của Unity sửa UV tại chỗ: `i.uv += offset`, `i.uv = twist(i.uv)`.
 * `i` là bản sao cục bộ của struct nên hợp lệ. Sau khi remap, `i.uv` thành `v_uv`
 * — mà varying là `in`, CHỈ ĐỌC trong GLSL ES 3.0. Đo trên AllIn1SpriteShader:
 * 18 lệnh ghi vào `v_uv`, không cái nào compile được.
 *
 * Với mỗi varying thực sự bị GHI, khai báo một bản sao cục bộ ở đầu hàm và đổi tên
 * mọi tham chiếu sang nó. Varying chỉ đọc thì giữ nguyên, không sinh bản sao thừa.
 */
function shadowWrittenVaryings(body, varyingDecls) {
  const prologue = [];
  for (const decl of varyingDecls) {
    const m = /^\s*in\s+(?:lowp\s+|mediump\s+|highp\s+)?([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*;/.exec(decl);
    if (!m) continue;
    const [, type, name] = m;
    // Ghi = có `=` phía sau nhưng không phải `==`, và không phải `<=`/`>=`/`!=`.
    const writeRe = new RegExp(`\\b${name}(?:\\.[xyzwrgba]+)?\\s*(?:[-+*/]=|=(?!=))`);
    if (!writeRe.test(body)) continue;
    const local = `${name}_rw`;
    body = body.replace(new RegExp(`\\b${name}\\b`, 'g'), local);
    prologue.push(`${type} ${local} = ${name};`);
  }
  return { body, prologue };
}

// ============================================================================
// Built-in Shading Model Snippets
// ============================================================================

const GLSL_SIMPLE_LIGHTING_SNIPPET = `
  vec3 CalculateSimpleLighting(vec3 worldNormal, vec3 albedo, vec3 emission) {
    vec3 N = normalize(worldNormal);
    vec3 L = normalize(-cc_mainLitDir.xyz);
    float NdotL = max(dot(N, L), 0.0);
    vec3 directDiffuse = albedo * cc_mainLitColor.rgb * (NdotL * cc_mainLitColor.w);
    vec3 ambient = albedo * cc_ambientSky.rgb;
    return directDiffuse + ambient + emission;
  }
`;

// URP's GetVertexPositionInputs/GetVertexNormalInputs return library structs.
// Lowering their *uses* one field at a time cannot work -- the call site binds a
// local (`VertexPositionInputs posInputs = ...`) and reads fields from it later,
// so without the struct the local is undeclared and the GLSL will not compile.
// Providing the struct and the function verbatim lets the original code stand.
const GLSL_URP_VERTEX_INPUTS_SNIPPET = `
  struct VertexPositionInputs {
    vec3 positionWS;
    vec3 positionVS;
    vec4 positionCS;
    vec4 positionNDC;
  };

  VertexPositionInputs GetVertexPositionInputs(vec3 positionOS) {
    VertexPositionInputs o;
    o.positionWS = (cc_matWorld * vec4(positionOS, 1.0)).xyz;
    o.positionVS = (cc_matView * vec4(o.positionWS, 1.0)).xyz;
    o.positionCS = cc_matViewProj * vec4(o.positionWS, 1.0);
    o.positionNDC = vec4(o.positionCS.xy * 0.5 + vec2(o.positionCS.w * 0.5), o.positionCS.zw);
    return o;
  }

  struct VertexNormalInputs {
    vec3 tangentWS;
    vec3 bitangentWS;
    vec3 normalWS;
  };

  VertexNormalInputs GetVertexNormalInputs(vec3 normalOS) {
    VertexNormalInputs o;
    o.normalWS = normalize((cc_matWorldIT * vec4(normalOS, 0.0)).xyz);
    o.tangentWS = vec3(1.0, 0.0, 0.0);
    o.bitangentWS = cross(o.normalWS, o.tangentWS);
    return o;
  }

  VertexNormalInputs GetVertexNormalInputs(vec3 normalOS, vec4 tangentOS) {
    VertexNormalInputs o;
    o.normalWS = normalize((cc_matWorldIT * vec4(normalOS, 0.0)).xyz);
    o.tangentWS = normalize((cc_matWorld * vec4(tangentOS.xyz, 0.0)).xyz);
    o.bitangentWS = cross(o.normalWS, o.tangentWS) * tangentOS.w;
    return o;
  }
`;

// URP's lighting API also hands back library structs. `GetMainLight()` returns
// a `Light`, and `InitializeInputData` fills an `InputData`; code then reads
// `light.shadowAttenuation` or `inputData.normalizedScreenSpaceUV` from the
// local. Without the struct the local is undeclared and nothing compiles.
//
// The values are mapped to their Cocos equivalents where one exists. Real-time
// shadow attenuation has no cheap equivalent in a playable, so it is 1.0 and the
// caller is told -- see URP_LIGHTING_NOTES.
const GLSL_URP_LIGHTING_SNIPPET = `
  struct Light {
    vec3 direction;
    vec3 color;
    float distanceAttenuation;
    float shadowAttenuation;
  };

  Light GetMainLight() {
    Light l;
    l.direction = normalize(-cc_mainLitDir.xyz);
    l.color = cc_mainLitColor.rgb * cc_mainLitColor.w;
    l.distanceAttenuation = 1.0;
    // No shadow map is sampled here: fully lit.
    l.shadowAttenuation = 1.0;
    return l;
  }

  Light GetMainLight(vec4 shadowCoord) {
    return GetMainLight();
  }

  int GetAdditionalLightsCount() {
    return 0;
  }
`;

const GLSL_URP_INPUT_DATA_SNIPPET = `
  struct InputData {
    vec3 positionWS;
    vec4 positionCS;
    vec3 normalWS;
    vec3 viewDirectionWS;
    vec4 shadowCoord;
    float fogCoord;
    vec3 vertexLighting;
    vec3 bakedGI;
    vec2 normalizedScreenSpaceUV;
    vec4 shadowMask;
  };
`;

const GLSL_NORMAL_UNPACK_SNIPPET = `
  vec3 UnpackNormalMap(vec4 packedNormal, float scale) {
    #if USE_DXT5NM_NORMAL
      vec2 normalXY = (packedNormal.wy * 2.0 - 1.0) * scale;
    #else
      vec2 normalXY = (packedNormal.xy * 2.0 - 1.0) * scale;
    #endif
    float normalZ = sqrt(max(1.0 - dot(normalXY, normalXY), 0.0));
    return normalize(vec3(normalXY, normalZ));
  }
`;

const GLSL_TOON_SNIPPET = `
  vec3 computeToonLighting(vec3 baseColor, vec3 worldNormal, vec3 worldPos, vec3 highlightCol, vec3 shadowCol, float rampThreshold, float rampSmoothing, vec3 rimCol, vec4 rimParams, vec3 specCol, vec2 specParams, vec3 emissiveCol) {
    vec3 normal = normalize(worldNormal);
    vec3 lightDir = normalize(-cc_mainLitDir.xyz);
    vec3 viewDir = normalize(cc_cameraPos.xyz - worldPos);
    vec3 halfDir = normalize(lightDir + viewDir);

    float noL = max(dot(normal, lightDir), 0.0);
    float noV = max(dot(normal, viewDir), 0.0001);

    float halfLambert = dot(normal, lightDir) * 0.5 + 0.5;
    float halfWidth = max(rampSmoothing * 0.5, 0.0001);
    float ramp = smoothstep(rampThreshold - halfWidth, rampThreshold + halfWidth, halfLambert);

    vec3 mainLight = cc_mainLitColor.rgb * cc_mainLitColor.w;
    vec3 toonTint = mix(shadowCol, highlightCol, ramp);
    vec3 direct = baseColor * toonTint * mainLight;

    float hemisphere = normal.y * 0.5 + 0.5;
    vec3 ambient = mix(cc_ambientGround.rgb, cc_ambientSky.rgb, hemisphere) * cc_ambientSky.w;
    vec3 indirect = baseColor * ambient;

    float rim = smoothstep(rimParams.x, max(rimParams.y, rimParams.x + 0.0001), 1.0 - noV);
    vec3 rimContrib = rimCol * rim * mix(vec3(1.0), mainLight * ramp, rimParams.z) * rimParams.w;

    float specPower = max(specParams.x * 128.0, 1.0);
    float spec = pow(max(dot(normal, halfDir), 0.0), specPower) * specParams.y;
    vec3 specularContrib = specCol * spec * mainLight * noL;

    return direct + indirect + rimContrib + specularContrib + emissiveCol;
  }
`;

const GLSL_MATCAP_SNIPPET = `
  vec2 computeMatCapUV(vec3 worldNormal) {
    vec3 viewNormal = normalize((cc_matView * vec4(worldNormal, 0.0)).xyz);
    return viewNormal.xy * 0.5 + 0.5;
  }
`;

const GLSL_DISSOLVE_SNIPPET = `
  vec4 applyDissolve(vec4 baseColor, float noiseVal, float dissolveAmount, float edgeWidth, vec4 edgeColor) {
    float threshold = dissolveAmount;
    if (noiseVal < threshold) discard;
    float edge = smoothstep(threshold, threshold + max(edgeWidth, 0.001), noiseVal);
    vec3 finalRgb = mix(edgeColor.rgb, baseColor.rgb, edge);
    return vec4(finalRgb, baseColor.a);
  }
`;

/**
 * Maps property default value to YAML string representation
 */
// ============================================================================
// Generic varying pass-through
// ============================================================================

// Alias tables cover the conventional field names (uv, color, normalWS, ...).
// Anything else a shader author put in their v2f struct -- `wn`, `uvShadow`,
// `data0` -- has no alias, so `i.wn` used to survive into the emitted GLSL as
// an undeclared identifier and the shader simply would not compile. Declare a
// varying for each such field instead, driven by the parsed struct.

const ALIASED_STRUCT_FIELDS = new Set([
  'vertex', 'pos', 'positionHCS', 'positionOS', 'positionCS',
  'uv', 'texcoord', 'color', 'normal', 'normalOS', 'normalWS',
  'positionWS', 'worldPos', 'viewDirWS', 'screenPos', 'tangent', 'tangentWS',
]);

const HLSL_TO_GLSL_TYPE = {
  float: 'float', float2: 'vec2', float3: 'vec3', float4: 'vec4',
  half: 'float', half2: 'vec2', half3: 'vec3', half4: 'vec4',
  fixed: 'float', fixed2: 'vec2', fixed3: 'vec3', fixed4: 'vec4',
  min16float: 'float', min16float2: 'vec2', min16float3: 'vec3', min16float4: 'vec4',
  int: 'int', int2: 'ivec2', int3: 'ivec3', int4: 'ivec4',
};

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fields of the vertex-output struct that no alias covers, and that therefore
 * need their own varying declared in both stages.
 * @returns {{field: string, varying: string, glslType: string}[]}
 */
function collectExtraVaryings(programIR) {
  const fragFunc = (programIR.functions || []).find(f => f.name === programIR.fragmentEntry);
  const structName = fragFunc && fragFunc.params && fragFunc.params[0] && fragFunc.params[0].type;
  const struct = (programIR.structs || []).find(s => s.name === structName);
  if (!struct) return [];

  const seen = new Set();
  const extra = [];
  for (const f of struct.fields) {
    if (ALIASED_STRUCT_FIELDS.has(f.name)) continue;
    // SV_POSITION is the clip-space output, not a varying.
    if (/^SV_POSITION$/i.test(f.semantic || '')) continue;
    const glslType = HLSL_TO_GLSL_TYPE[f.type];
    if (!glslType) continue; // unknown/struct type: leave for the diagnostics pass
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    extra.push({ field: f.name, varying: `v_${f.name}`, glslType });
  }
  return extra;
}

/** Rewrite `<param>.<field>` -> `v_<field>` for every unaliased field. */
function remapExtraVaryings(body, paramName, extras) {
  let out = body;
  for (const e of extras) {
    out = out.replace(new RegExp(`\\b${paramName}\\.${e.field}\\b`, 'g'), e.varying);
  }
  return out;
}

function formatYamlPropertyValue(prop) {
  if (prop.type === 'Color' || prop.type === 'Vector') {
    const val = Array.isArray(prop.defaultValue) ? prop.defaultValue : [1, 1, 1, 1];
    return `[${val.join(', ')}]`;
  }
  if (prop.type === '2D' || prop.type === 'Cube' || prop.type === '3D') {
    return prop.textureDefault || 'white';
  }
  if (typeof prop.defaultValue === 'number') {
    return String(prop.defaultValue);
  }
  return '0.0';
}

/**
 * Builds CCEffect YAML frontmatter
 */
function buildCceffectYaml(docIR, passIR, uboInfo, options = {}) {
  const isTransparent = passIR.renderState.blend && passIR.renderState.blend.enabled;
  const techniqueName = isTransparent ? 'transparent' : 'opaque';
  const isSurface = options.mode === 'surface-pbr';

  const lines = [
    'CCEffect %{',
    '  techniques:',
    `  - name: ${techniqueName}`,
    '    passes:',
    // Surface shaders take their entry point from
    // <shading-entries/main-functions/render-to-scene/{vs,fs}>, which defines
    // main() -- so the pass names the program with no `:entry` suffix, matching
    // the engine's own advanced effects. `surface-vertex:vert` named a function
    // that does not exist in the surface model.
    `    - vert: ${isSurface ? 'standard-vs' : 'vs:vert'}`,
    `      frag: ${isSurface ? 'standard-fs' : 'fs:frag'}`,
  ];

  // Rasterizer State
  const cull = passIR.renderState.cull || 'back';
  lines.push('      rasterizerState:');
  lines.push(`        cullMode: ${cull}`);
  if (passIR.renderState.depthBias !== undefined && passIR.renderState.depthBias !== 0) {
    lines.push(`        depthBias: ${passIR.renderState.depthBias}`);
  }
  if (passIR.renderState.depthBiasSlope !== undefined && passIR.renderState.depthBiasSlope !== 0) {
    lines.push(`        depthBiasSlope: ${passIR.renderState.depthBiasSlope}`);
  }

  // Depth Stencil State
  lines.push('      depthStencilState:');
  lines.push(`        depthTest: ${passIR.renderState.zTest !== 'Off'}`);
  lines.push(`        depthWrite: ${passIR.renderState.zWrite}`);
  if (passIR.renderState.zTest && passIR.renderState.zTest !== 'LEqual' && passIR.renderState.zTest !== 'Off') {
    lines.push(`        depthFunc: ${passIR.renderState.zTest.toLowerCase()}`);
  }
  if (passIR.renderState.stencil && passIR.renderState.stencil.enabled) {
    const st = passIR.renderState.stencil;
    lines.push('        stencilTest: true');
    lines.push(`        stencilFuncFront: ${st.compFront || st.comp || 'always'}`);
    lines.push(`        stencilRefFront: ${st.ref !== undefined ? st.ref : 1}`);
    lines.push(`        stencilReadMaskFront: ${st.readMask !== undefined ? st.readMask : 255}`);
    lines.push(`        stencilWriteMaskFront: ${st.writeMask !== undefined ? st.writeMask : 255}`);
    lines.push(`        stencilPassOpFront: ${st.passFront || st.pass || 'keep'}`);
    lines.push(`        stencilFailOpFront: ${st.failFront || st.fail || 'keep'}`);
    lines.push(`        stencilZFailOpFront: ${st.zFailFront || st.zFail || 'keep'}`);
    lines.push(`        stencilFuncBack: ${st.compBack || st.comp || 'always'}`);
    lines.push(`        stencilRefBack: ${st.ref !== undefined ? st.ref : 1}`);
    lines.push(`        stencilReadMaskBack: ${st.readMask !== undefined ? st.readMask : 255}`);
    lines.push(`        stencilWriteMaskBack: ${st.writeMask !== undefined ? st.writeMask : 255}`);
    lines.push(`        stencilPassOpBack: ${st.passBack || st.pass || 'keep'}`);
    lines.push(`        stencilFailOpBack: ${st.failBack || st.fail || 'keep'}`);
    lines.push(`        stencilZFailOpBack: ${st.zFailBack || st.zFail || 'keep'}`);
  }

  // Blend State
  if (isTransparent) {
    lines.push('      blendState:');
    lines.push('        targets:');
    lines.push('        - blend: true');
    lines.push(`          blendSrc: ${passIR.renderState.blend.srcRGB || 'src_alpha'}`);
    lines.push(`          blendDst: ${passIR.renderState.blend.dstRGB || 'one_minus_src_alpha'}`);
    lines.push(`          blendSrcAlpha: ${passIR.renderState.blend.srcAlpha || 'src_alpha'}`);
    lines.push(`          blendDstAlpha: ${passIR.renderState.blend.dstAlpha || 'one_minus_src_alpha'}`);
    if (passIR.renderState.blend.opRGB && passIR.renderState.blend.opRGB !== 'add') {
      lines.push(`          blendEq: ${passIR.renderState.blend.opRGB}`);
    }
    if (passIR.renderState.blend.opAlpha && passIR.renderState.blend.opAlpha !== 'add') {
      lines.push(`          blendAlphaEq: ${passIR.renderState.blend.opAlpha}`);
    }
  }

  // Properties Block
  if (docIR.properties.length > 0) {
    lines.push('      properties:');
    for (const prop of docIR.properties) {
      const pName = prop.cocosName || prop.name;
      const valStr = formatYamlPropertyValue(prop);

      // Scalar đã gộp vào lát cắt vec4 phải khai báo `target:`, nếu không Cocos
      // không biết ghi giá trị vào đâu và property trở thành vô nghĩa.
      const packTarget = (uboInfo && uboInfo.scalarAliases) ? uboInfo.scalarAliases[pName] : undefined;
      const targetPart = packTarget ? `, target: ${packTarget}` : '';

      if (prop.editor && (prop.editor.type || prop.editor.range || prop.editor.displayName)) {
        const editorParts = [];
        if (prop.editor.type) editorParts.push(`type: ${prop.editor.type}`);
        if (prop.editor.range) editorParts.push(`range: [${prop.editor.range.join(', ')}]`);
        if (prop.editor.step) editorParts.push(`step: ${prop.editor.step}`);
        if (prop.editor.displayName) editorParts.push(`displayName: "${prop.editor.displayName}"`);

        lines.push(`        ${pName}: { value: ${valStr}${targetPart}, editor: { ${editorParts.join(', ')} } }`);
      } else {
        lines.push(`        ${pName}: { value: ${valStr}${targetPart} }`);
      }

      // Every sampler gets a tiling/offset uniform in the UBO, but it was never
      // mirrored here. A uniform absent from the properties block cannot be
      // authored or written by a material, so it stayed at zero -- collapsing
      // every UV to (0,0) for any shader that applied TRANSFORM_TEX.
      if (prop.cocosType === 'sampler2D' || prop.unityType === '2D') {
        lines.push(`        ${pName}_ST: { value: [1, 1, 0, 0] }`);
      }
    }
  }

  lines.push('}%');
  return lines.join('\n');
}

/**
 * Emits Cocos Creator Surface Shader mode (--mode surface-pbr)
 */
function emitSurfaceShaderEffect(docIR, passIR, options = {}) {
  const uboFields = [];
  const samplers = [];
  // Unity property name -> Cocos uniform name. Without this the emitted GLSL
  // still says `_BaseMap` while the UBO declares `mainTexture`, so nothing links.
  const propertyNameMap = new Map();

  for (const prop of docIR.properties) {
    const cName = prop.cocosName || prop.name;
    propertyNameMap.set(prop.name, cName);
    if (prop.type === '2D' || prop.type === 'Cube' || prop.type === '3D') {
      samplers.push({ name: cName, type: prop.cocosType || 'sampler2D', originalName: prop.name });
      uboFields.push({ name: `${cName}_ST`, type: 'vec4' });
      propertyNameMap.set(`${prop.name}_ST`, `${cName}_ST`);
    } else {
      uboFields.push({ name: cName, type: prop.cocosType || 'float' });
    }
  }

  // Surface programs are `#include`d by the entry programs rather than being
  // the entry themselves, so their uniforms live in an unnumbered `Constants`
  // block -- the engine's own layout. Explicit set/binding here would collide
  // with the descriptor set the shading-entry chunks set up.
  const ubo = buildStd140Ubo(uboFields, true, { explicitBindings: false, blockName: 'Constants' });
  const yaml = buildCceffectYaml(docIR, passIR, ubo, { mode: 'surface-pbr' });

  const { buildSurfacePbrEffect } = require('./surface-pbr-emitter.cjs');
  const built = buildSurfacePbrEffect({ docIR, passIR, yaml, ubo, samplers, propertyNameMap });

  // Surface diagnostics have to reach the caller: the channels this mode cannot
  // map (tangent-space normals, engine-supplied GI) are the difference between
  // "ported" and "looks like Unity".
  if (built.diagnostics.length) {
    docIR.surfaceDiagnostics = (docIR.surfaceDiagnostics || []).concat(built.diagnostics);
  }
  docIR.surfaceIntentStyle = built.intentStyle;

  return built.text;
}

/**
 * Generates vertex & fragment CCProgram blocks
 */
function generateCocosPrograms(docIR, passIR, options = {}) {
  const programIR = passIR.program;
  const rawCode = programIR.rawHlsl || '';
  const loweredCode = lowerHlslToGlsl(rawCode, options);

  // 1. Gather all properties and ST vectors for UBO
  const uboFields = [];
  const samplers = [];
  const propertyNameMap = new Map();

  for (const prop of docIR.properties) {
    const cName = prop.cocosName || prop.name;
    propertyNameMap.set(prop.name, cName);

    if (prop.type === '2D' || prop.type === 'Cube' || prop.type === '3D') {
      samplers.push({
        name: cName,
        type: prop.cocosType || 'sampler2D',
        originalName: prop.name,
      });

      // Add corresponding tiling & offset vector (_ST)
      uboFields.push({
        name: `${cName}_ST`,
        type: 'vec4',
      });
      propertyNameMap.set(`${prop.name}_ST`, `${cName}_ST`);
    } else {
      uboFields.push({
        name: cName,
        type: prop.cocosType || 'float',
      });
    }
  }

  // Also include any explicit HLSL uniforms that weren't in Properties block
  for (const u of programIR.uniforms || []) {
    if (!propertyNameMap.has(u.name) && !uboFields.some(f => f.name === u.name)) {
      uboFields.push({
        name: u.name,
        type: u.type,
      });
    }
  }

  // Build std140 UBO layout with explicit descriptor set binding (Set 2, Binding 0)
  const ubo = buildStd140Ubo(uboFields, true, {
    explicitBindings: options.explicitBindings !== undefined ? options.explicitBindings : true,
    set: 2,
    binding: 0,
    // Trên ngưỡng này, scalar được gộp vào lát cắt vec4 và phơi lại qua `target:`.
    // Shader nhỏ giữ nguyên bố cục cũ; chỉ uber-shader mới đổi.
    packScalarsThreshold: options.packScalarsThreshold !== undefined ? options.packScalarsThreshold : 24,
  });

  /*
   * Thân shader vẫn gọi scalar bằng tên gốc: alias làm phần đóng gói trở nên vô hình.
   *
   * Cạm bẫy: nếu shader có BIẾN CỤC BỘ trùng tên property (Unity `_Alpha` hạ thành
   * `alpha`, mà thân shader cũng có thể khai báo `float alpha`), thì `#define` biến
   * dòng khai báo đó thành `float pack0.x = ...` — lỗi cú pháp. Token là một, không
   * phân biệt được đâu là property đâu là biến, nên khi phát hiện đụng độ thì bỏ hẳn
   * việc đóng gói cho shader này và quay về bố cục scalar rời (hành vi cũ, luôn đúng).
   */
  let packAliasLines = Object.entries(ubo.scalarAliases || {})
    .map(([name, slot]) => `  #define ${name} ${slot}`);

  if (packAliasLines.length) {
    const collisions = findLocalNameCollisions(programIR, Object.keys(ubo.scalarAliases));
    if (collisions.length) {
      // Đổi tên trong HLSL GỐC, nơi property (`_Alpha`) và biến cục bộ (`alpha`) vẫn
      // là hai token khác nhau. Sau khi hạ mã thì cả hai đều thành `alpha` và không
      // còn phân biệt được nữa — nên phải làm ở đây, không phải sau.
      renameLocals(programIR, collisions);
      const stillColliding = findLocalNameCollisions(programIR, Object.keys(ubo.scalarAliases));
      if (stillColliding.length) {
        // Không tách được: quay về scalar rời (hành vi cũ, luôn đúng).
        const relaxed = buildStd140Ubo(uboFields, true, {
          explicitBindings: options.explicitBindings !== undefined ? options.explicitBindings : true,
          set: 2,
          binding: 0,
        });
        ubo.glsl = relaxed.glsl;
        ubo.fields = relaxed.fields;
        ubo.totalSize = relaxed.totalSize;
        ubo.scalarAliases = {};
        packAliasLines = [];
        (ubo.diagnostics = ubo.diagnostics || []).push({
          severity: 'info',
          message: `Scalar packing disabled: property name(s) ${stillColliding.slice(0, 3).join(', ')} still collide with locals after renaming. Falling back to loose scalars.`,
        });
      }
    }
  }

  // 2. Determine Vertex Attributes needed. Prefer the parsed input semantics;
  // substring probes such as /COLOR/ mistake material names like _BaseColor for
  // a COLOR vertex channel and cannot discover TEXCOORD1 at all.
  const vertFunc = (programIR.functions || []).find(f => f.name === programIR.vertexEntry);
  const vertexInputStruct = vertFunc && vertFunc.params && vertFunc.params[0]
    ? (programIR.structs || []).find(s => s.name === vertFunc.params[0].type)
    : null;
  const vertexInputSemantics = new Set(
    (vertexInputStruct && vertexInputStruct.fields || []).map(f => String(f.semantic || '').toUpperCase())
  );
  const attributes = [
    'in vec3 a_position;',
    'in vec2 a_texCoord;',
  ];
  if (vertexInputSemantics.has('TEXCOORD1') || /\bTEXCOORD1\b/i.test(rawCode)) {
    attributes.push('in vec2 a_texCoord1;');
  }
  if (vertexInputSemantics.has('NORMAL') || /worldNormal|\ba_normal\b/i.test(rawCode) || docIR.family === 'Toon' || docIR.family === 'MatCap' || docIR.family === 'PBR') {
    attributes.push('in vec3 a_normal;');
  }
  if (vertexInputSemantics.has('TANGENT') || /\ba_tangent\b/i.test(rawCode)) {
    attributes.push('in vec4 a_tangent;');
  }
  if ([...vertexInputSemantics].some(s => /^COLOR\d*$/.test(s)) || /\ba_color\b/i.test(rawCode)) {
    attributes.push('in vec4 a_color;');
  }

  const extraVaryings = collectExtraVaryings(programIR);

  // 3. Determine Varyings (Stage IO)
  const varyings = [
    'out vec2 v_uv;',
  ];
  if (attributes.some(a => a.includes('a_color'))) {
    varyings.push('out vec4 v_color;');
  }
  if (attributes.some(a => a.includes('a_normal')) || /v_worldNormal|normalWS/i.test(loweredCode)) {
    varyings.push('out vec3 v_worldNormal;');
  }
  if (/worldPos|positionWS|v_worldPos/i.test(loweredCode) || docIR.family === 'Toon' || docIR.family === 'PBR') {
    varyings.push('out vec3 v_worldPos;');
  }
  if (/screenPos|ComputeScreenPos/i.test(rawCode)) {
    varyings.push('out vec4 v_screenPos;');
  }
  for (const e of extraVaryings) {
    const decl = `out ${e.glslType} ${e.varying};`;
    if (!varyings.includes(decl)) varyings.push(decl);
  }

  // Helper to replace Unity identifiers with Cocos names in code body
  function remapIdentifiers(codeStr) {
    let res = codeStr;
    for (const [uName, cName] of propertyNameMap.entries()) {
      if (uName !== cName) {
        res = res.replace(new RegExp(`\\b${uName}\\b`, 'g'), cName);
      }
    }
    return res;
  }

  // 4. Translate Helper Functions in source
  const helperFunctions = [];
  for (const func of programIR.functions || []) {
    if (func.name !== programIR.vertexEntry && func.name !== programIR.fragmentEntry) {
      let funcGlsl = lowerHlslToGlsl(func.raw, options);
      funcGlsl = remapIdentifiers(funcGlsl);
      helperFunctions.push(funcGlsl);
    }
  }

  // 5. Generate Vertex Program (CCProgram vs)
  const vsIncludes = [
    '  #include <builtin/uniforms/cc-global>',
    '  #include <builtin/uniforms/cc-local>',
  ];
  if (/cc_fog|cc_fogColor|UNITY_FOG/i.test(rawCode)) vsIncludes.push('  #include <builtin/uniforms/cc-fog>');
  if (/cc_shadow|TRANSFER_SHADOW|SHADOW_COORDS/i.test(rawCode)) vsIncludes.push('  #include <builtin/uniforms/cc-shadow>');
  if (/cc_joints|cc_jointTexture|a_joints|a_weights/i.test(rawCode)) vsIncludes.push('  #include <builtin/uniforms/cc-skinning>');

  const vsLines = [
    'CCProgram vs %{',
    '  precision highp float;',
    ...vsIncludes,
    '',
    '  ' + attributes.join('\n  '),
    '',
    '  ' + varyings.join('\n  '),
    '',
  ];

  if (ubo.glsl) {
    vsLines.push('  ' + ubo.glsl.split('\n').join('\n  '));
    if (packAliasLines.length) vsLines.push(...packAliasLines);
    vsLines.push('');
  }

  // Samplers the vertex stage itself touches. `_MainTex_TexelSize` lowers to
  // textureSize(mainTexture, 0), and vertex code that scales by texel size then
  // references a sampler that was only ever declared in the fragment stage.
  if (samplers.length > 0) {
    const vertProbe = (() => {
      const vf = (programIR.functions || []).find(f => f.name === programIR.vertexEntry);
      const body = vf && vf.body ? lowerHlslToGlsl(vf.body, options) : '';
      // Helper functions are emitted into both stages, so a sampler referenced
      // only from a helper still needs declaring here.
      return `${body}\n${helperFunctions.join('\n')}`;
    })();
    const vsSamplers = samplers.filter(s => new RegExp(`\\b${s.name}\\b`).test(vertProbe));
    if (vsSamplers.length > 0) {
      // Same allocator as the fragment stage: a sampler must carry the same
      // set/binding in both stages or Cocos rejects the pipeline layout.
      const vsAlloc = allocateBindings(samplers, options);
      for (const s of vsSamplers) {
        const b = vsAlloc.manifest[s.name] || { set: 2, binding: 1 };
        vsLines.push(`  layout(set = ${b.set}, binding = ${b.binding}) uniform ${s.type} ${s.name};`);
      }
      vsLines.push('');
    }
  }

  // URP library-struct shims. Which stage needs them depends on where the
  // shader calls them, so each is emitted per stage rather than assumed to be
  // vertex-only -- a fragment that calls GetVertexPositionInputs for screen UVs
  // otherwise gets an undeclared local.
  const urpShims = [
    { re: /GetVertexPositionInputs|GetVertexNormalInputs|VertexPositionInputs|VertexNormalInputs/, snippet: GLSL_URP_VERTEX_INPUTS_SNIPPET },
    { re: /\bGetMainLight\b|\bLight\s+\w+\s*=|GetAdditionalLightsCount/, snippet: GLSL_URP_LIGHTING_SNIPPET },
    { re: /\bInputData\b/, snippet: GLSL_URP_INPUT_DATA_SNIPPET },
  ];
  const vertexSource = (() => {
    const vf = (programIR.functions || []).find(f => f.name === programIR.vertexEntry);
    return `${vf && vf.body ? vf.body : ''}\n${helperFunctions.join('\n')}`;
  })();
  for (const shim of urpShims) {
    if (shim.re.test(vertexSource)) vsLines.push(shim.snippet);
  }
  if (/\bGetMainLight\b/.test(rawCode)) {
    docIR.urpLightingNotes = (docIR.urpLightingNotes || []).concat([
      'GetMainLight() is shimmed onto cc_mainLitDir/cc_mainLitColor. shadowAttenuation is 1.0: no shadow map is sampled, so shadows from the Unity shader are not ported.',
    ]);
  }

  // Lớp tương thích HLSL đứng TRƯỚC helper: helper có thể gọi hmod/sat/texU.
  const vsCompat = unityCompatBlockFor(lowerHlslToGlsl(vertexSource, options));
  if (vsCompat) vsLines.push(vsCompat);

  // Insert helper functions in VS if any
  if (helperFunctions.length > 0) {
    vsLines.push('  ' + helperFunctions.join('\n\n  '));
    vsLines.push('');
  }

  // Vertex Main Entry
  vsLines.push('  vec4 vert () {');
  vsLines.push('    vec4 pos = vec4(a_position, 1.0);');
  vsLines.push('    v_uv = a_texCoord;');
  if (varyings.some(v => v.includes('v_color'))) {
    vsLines.push('    v_color = a_color;');
  }
  if (varyings.some(v => v.includes('v_worldPos'))) {
    vsLines.push('    v_worldPos = (cc_matWorld * pos).xyz;');
  }
  if (varyings.some(v => v.includes('v_worldNormal'))) {
    vsLines.push('    v_worldNormal = normalize((cc_matWorldIT * vec4(a_normal, 0.0)).xyz);');
  }

  let customVertAssignedClipPos = false;

  if (vertFunc && vertFunc.body) {
    // Translate custom vertex body
    let vBody = lowerHlslToGlsl(vertFunc.body, options);
    vBody = remapIdentifiers(vBody);

    // The generated entry reserves `pos` for the final clip/object position.
    // URP commonly declares `VertexPositionInputs pos`, which previously made
    // two locals named `pos` with different types and then rewrote
    // `o.positionCS = pos.positionCS` into the nonsensical `pos = pos`.
    // Rename only a source local binding (not a struct field such as `o.pos`).
    if (/\b[A-Za-z_]\w*\s+pos\s*(?:=|;)/.test(vBody)) {
      let sourcePosName = '_cc_sourcePos';
      let suffix = 1;
      while (new RegExp(`\\b${escapeRegExp(sourcePosName)}\\b`).test(vBody)) {
        sourcePosName = `_cc_sourcePos${suffix++}`;
      }
      vBody = vBody.replace(/(?<!\.)\bpos\b/g, sourcePosName);
    }

    // Capture the actual vertex-output variable before removing its struct
    // declaration. All output rewrites below are scoped to this base so helper
    // structs (`posInputs.positionCS`) keep their fields intact.
    const outputDeclRe = vertFunc.returnType
      ? new RegExp(`\\b${escapeRegExp(vertFunc.returnType)}\\s+([A-Za-z_]\\w*)\\s*;`)
      : null;
    const outputDecl = outputDeclRe ? outputDeclRe.exec(vBody) : null;
    const outputVar = outputDecl ? outputDecl[1] : null;
    const outputStruct = vertFunc.returnType
      ? (programIR.structs || []).find(s => s.name === vertFunc.returnType)
      : null;
    const clipOutputFields = (outputStruct && outputStruct.fields || [])
      .filter(f => /^SV_POSITION$/i.test(f.semantic || ''))
      .map(f => f.name);
    if (outputVar && clipOutputFields.some(field =>
      new RegExp(`\\b${escapeRegExp(outputVar)}\\.${escapeRegExp(field)}\\s*[-+*/]?=`).test(vBody))) {
      customVertAssignedClipPos = true;
    }

    // Strip struct local var declaration like "Varyings o;" or "v2f o;" or "Vertex_Stage_Output output;"
    vBody = vBody.replace(/\b(?:Varyings|v2f|appdata|Attributes|\w+_Output|\w+_Input)\s+\w+\s*;?/g, '');

    // Replace param references with attributes
    if (vertFunc.params.length > 0) {
      const pName = vertFunc.params[0].name;

      // GHI vào vị trí đỉnh phải đi trước phần đọc. Trong HLSL `v` là struct cục bộ
      // nên `v.vertex.xyz += ...` (RECTSIZE, wind, vertex offset) hợp lệ; hạ thẳng
      // thành `a_position += ...` là GHI VÀO ATTRIBUTE — `in` trong GLSL ES 3.0 chỉ
      // đọc, shader không compile. Prologue đã có `vec4 pos = vec4(a_position, 1.0);`
      // và chính `pos` mới là thứ được biến đổi ở cuối, nên đó là đích đúng.
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.(?:vertex|pos|position|positionOS)\\.xyz\\s*([-+*/]?=)\\s*`, 'g'), 'pos.xyz $1 ');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.(?:vertex|pos|position|positionOS)\\s*([-+*/]?=)\\s*`, 'g'), 'pos $1 ');

      vBody = vBody.replace(new RegExp(`\\b${pName}\\.vertex\\.xyz\\b`, 'g'), 'a_position');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.vertex\\b`, 'g'), 'vec4(a_position, 1.0)');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.pos\\.xyz\\b`, 'g'), 'a_position');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.pos\\b`, 'g'), 'a_position');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.positionOS\\.xyz\\b`, 'g'), 'a_position');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.positionOS\\b`, 'g'), 'vec4(a_position, 1.0)');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.texcoord\\b`, 'g'), 'vec4(a_texCoord, 0.0, 0.0)');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.uv\\b`, 'g'), 'a_texCoord');
      // Unity's second UV set is conventionally named uv2 but carries the
      // TEXCOORD1 semantic. Use the parsed semantic as the authority and keep
      // common aliases as a fallback for hand-written structs.
      if (vertexInputStruct) {
        for (const field of vertexInputStruct.fields || []) {
          if (/^TEXCOORD1$/i.test(field.semantic || '')) {
            vBody = vBody.replace(new RegExp(`\\b${pName}\\.${escapeRegExp(field.name)}\\b`, 'g'), 'a_texCoord1');
          }
        }
      }
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.(?:uv1|uv2|texcoord1)\\b`, 'g'), 'a_texCoord1');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.normal\\b`, 'g'), 'a_normal');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.normalOS\\b`, 'g'), 'a_normal');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.color\\b`, 'g'), 'a_color');
      // URP/HDRP and hand-rolled naming for the same object-space inputs.
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.(?:posOS|positionObj|vertexOS)\\.xyz\\b`, 'g'), 'a_position');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.(?:posOS|positionObj|vertexOS)\\b`, 'g'), 'vec4(a_position, 1.0)');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.position\\.xyz\\b`, 'g'), 'a_position');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.position\\b`, 'g'), 'vec4(a_position, 1.0)');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.(?:uv0|texcoord0)\\b`, 'g'), 'a_texCoord');
      vBody = vBody.replace(new RegExp(`\\b${pName}\\.tangentOS\\b`, 'g'), 'a_tangent');
    }

    // Clean any residual vec4(vec4(a_position, 1.0).xyz, 1.0)
    vBody = vBody.replace(/vec4\s*\(\s*vec4\s*\(\s*a_position\s*,\s*1\.0\s*\)\.xyz\s*,\s*1\.0\s*\)/g, 'vec4(a_position, 1.0)');

    if (/\b(?:positionHCS|pos|vertex)\s*=\s*\(+cc_matViewProj/i.test(vBody)) {
      customVertAssignedClipPos = true;
    }

    // Remap output struct fields. When the parser found the returned local,
    // constrain every replacement to that exact variable. The old `\w+` base
    // also rewrote reads from URP helper structs and produced type-invalid GLSL.
    const outputBase = outputVar ? escapeRegExp(outputVar) : '\\w+';
    const replaceOutputField = (fieldPattern, target) => {
      vBody = vBody.replace(new RegExp(`\\b${outputBase}\\.(?:${fieldPattern})\\b`, 'g'), target);
    };

    // Remap output struct assignments.
    // Clip-space output goes by many names across URP versions and hand-written
    // shaders; any spelling we miss here survives as `OUT.<field>` in the
    // emitted GLSL, reading through a variable that was never declared.
    // `([-+*/]?=)` chứ không phải `=`: HLSL hay tinh chỉnh trường output tại chỗ
    // (`o.uv += center;` trong ROTATEUV). Chỉ khớp phép gán đơn thì dòng đó sống sót
    // nguyên văn thành `o.uv += ...`, đọc qua một biến chưa từng khai báo.
    replaceOutputField('vertex|positionHCS|positionCS|posHCS|posCS|clipPos|pos', 'pos');
    replaceOutputField('worldPos|positionWS', 'v_worldPos');
    replaceOutputField('uv0|texcoord0|texcoord|uv', 'v_uv');
    replaceOutputField('color', 'v_color');
    replaceOutputField('screenPos', 'v_screenPos');
    replaceOutputField('normalWS', 'v_worldNormal');
    for (const e of extraVaryings) {
      replaceOutputField(escapeRegExp(e.field), e.varying);
    }
    vBody = vBody.replace(new RegExp(`\\b${outputBase}\\.viewDirWS\\s*=\\s*[^;]+;?`, 'g'), '');
    if (outputVar) {
      vBody = vBody.replace(new RegExp(`\\breturn\\s+${escapeRegExp(outputVar)}\\s*;`, 'g'), '');
    } else {
      vBody = vBody.replace(/\breturn\s+\w+\s*;/g, '');
    }

    const trimmedBody = vBody.trim();
    if (trimmedBody) {
      vsLines.push('    // Custom vertex logic:');
      vsLines.push('    ' + trimmedBody.split('\n').map(l => l.trimEnd()).join('\n    '));
    }
  }

  if (customVertAssignedClipPos) {
    vsLines.push('    return pos;');
  } else if (varyings.some(v => v.includes('v_screenPos')) && !vertFunc) {
    vsLines.push('    vec4 clipPos = cc_matViewProj * cc_matWorld * pos;');
    vsLines.push('    v_screenPos = vec4(vec2(clipPos.x, clipPos.y) * 0.5 + vec2(clipPos.w * 0.5), clipPos.zw);');
    vsLines.push('    return clipPos;');
  } else {
    vsLines.push('    return cc_matViewProj * cc_matWorld * pos;');
  }
  vsLines.push('  }');
  vsLines.push('}%');

  // 6. Generate Fragment Program (CCProgram fs)
  const fsVaryings = varyings.map(v => v.replace(/^out\s+/, 'in '));
  const fsIncludes = [
    '  #include <builtin/uniforms/cc-global>',
  ];
  if (/cc_fog|cc_fogColor|UNITY_APPLY_FOG/i.test(rawCode)) fsIncludes.push('  #include <builtin/uniforms/cc-fog>');
  if (/cc_shadow|SHADOW_ATTENUATION/i.test(rawCode)) fsIncludes.push('  #include <builtin/uniforms/cc-shadow>');
  if (/cc_mainLitDir|Shade4PointLights|cc_forward_light/i.test(rawCode)) fsIncludes.push('  #include <builtin/uniforms/cc-forward-light>');
  if (docIR.family === 'PBR' || /cc-pbr|StandardPBR/i.test(rawCode)) fsIncludes.push('  #include <builtin/includes/cc-pbr>');

  const fsLines = [
    'CCProgram fs %{',
    // Cocos links the material UBO across vertex and fragment stages. GLSL ES
    // applies the stage's default float precision to unqualified UBO members,
    // so using highp in VS and mediump in FS makes an otherwise identical
    // `Constant` block fail at runtime (WebGL: precisions differ between
    // shaders). Keep both stages highp; an optimizer may lower both together.
    '  precision highp float;',
    ...fsIncludes,
    '',
    '  ' + fsVaryings.join('\n  '),
    '',
  ];

  if (ubo.glsl) {
    fsLines.push('  ' + ubo.glsl.split('\n').join('\n  '));
    if (packAliasLines.length) fsLines.push(...packAliasLines);
    fsLines.push('');
  }

  // Samplers with deterministic descriptor allocation
  if (samplers.length > 0) {
    const bindingAlloc = allocateBindings(samplers, options);
    for (const s of samplers) {
      const bindingInfo = bindingAlloc.manifest[s.name] || { set: 2, binding: 1 };
      if (options.explicitBindings !== false) {
        fsLines.push(`  layout(set = ${bindingInfo.set}, binding = ${bindingInfo.binding}) uniform ${s.type} ${s.name};`);
      } else {
        fsLines.push(`  uniform ${s.type} ${s.name};`);
      }
    }
    fsLines.push('');
  }

  // Shading Model & Helper Snippets
  if (docIR.family === 'Toon') {
    fsLines.push(GLSL_TOON_SNIPPET);
  } else if (docIR.family === 'MatCap') {
    fsLines.push(GLSL_MATCAP_SNIPPET);
  } else if (docIR.family === 'Dissolve') {
    fsLines.push(GLSL_DISSOLVE_SNIPPET);
  }

  if (rawCode.includes('UnpackNormal')) {
    fsLines.push(GLSL_NORMAL_UNPACK_SNIPPET);
  }

  // Same URP struct shims as the vertex stage, gated on the fragment's own code.
  const fragmentSource = (() => {
    const ff = (programIR.functions || []).find(f => f.name === programIR.fragmentEntry);
    return `${ff && ff.body ? ff.body : ''}\n${helperFunctions.join('\n')}`;
  })();
  for (const shim of urpShims) {
    if (shim.re.test(fragmentSource)) fsLines.push(shim.snippet);
  }

  const fsCompat = unityCompatBlockFor(lowerHlslToGlsl(fragmentSource, options));
  if (fsCompat) fsLines.push(fsCompat);

  // Insert helper functions in FS
  if (helperFunctions.length > 0) {
    fsLines.push('  ' + helperFunctions.join('\n\n  '));
    fsLines.push('');
  }

  // Fragment Main Entry
  const fragFunc = (programIR.functions || []).find(f => f.name === programIR.fragmentEntry);
  fsLines.push('  vec4 frag () {');

  if (fragFunc && fragFunc.body) {
    let fBody = lowerHlslToGlsl(fragFunc.body, options);
    fBody = remapIdentifiers(fBody);

    // Replace param references with varyings
    if (fragFunc.params.length > 0) {
      const pName = fragFunc.params[0].name;
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.uv\\b`, 'g'), 'v_uv');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.texcoord\\b`, 'g'), 'v_uv');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.color\\b`, 'g'), 'v_color');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.normalWS\\b`, 'g'), 'v_worldNormal');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.viewDirWS\\b`, 'g'), 'normalize(cc_cameraPos.xyz - v_worldPos)');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.screenPos\\b`, 'g'), 'v_screenPos');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.positionWS\\b`, 'g'), 'v_worldPos');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.worldPos\\b`, 'g'), 'v_worldPos');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.(?:uv0|texcoord0)\\b`, 'g'), 'v_uv');
      fBody = fBody.replace(new RegExp(`\\b${pName}\\.(?:positionHCS|positionCS|posHCS|posCS|clipPos)\\b`, 'g'), 'gl_FragCoord');
      fBody = remapExtraVaryings(fBody, pName, extraVaryings);
    }

    // Remap texture names to Cocos names
    for (const s of samplers) {
      if (s.originalName && s.originalName !== s.name) {
        fBody = fBody.replace(new RegExp(`\\b${s.originalName}\\b`, 'g'), s.name);
      }
    }

    // Wrap returns
    fBody = fBody.replace(/\breturn\s+fixed4\s*\(/g, 'return vec4(');
    fBody = fBody.replace(/\breturn\s+half4\s*\(/g, 'return vec4(');

    const shadowed = shadowWrittenVaryings(fBody, fsVaryings);
    fBody = shadowed.body;
    for (const line of shadowed.prologue) fsLines.push('    ' + line);

    fsLines.push('    ' + fBody.trim().split('\n').map(l => l.trimEnd()).join('\n    '));
  } else {
    // Default fragment fallback based on properties and family
    const hasTexture = samplers.length > 0;
    const texName = hasTexture ? samplers[0].name : '';
    const colorProp = docIR.properties.find(p => p.type === 'Color');
    const colorName = colorProp ? (colorProp.cocosName || colorProp.name) : 'baseColor';

    if (hasTexture) {
      fsLines.push(`    vec4 col = texture(${texName}, v_uv);`);
      if (colorProp) {
        fsLines.push(`    col *= ${colorName};`);
      }
      fsLines.push('    return col;');
    } else if (colorProp) {
      fsLines.push(`    return ${colorName};`);
    } else {
      fsLines.push('    return vec4(1.0, 1.0, 1.0, 1.0);');
    }
  }

  fsLines.push('  }');
  fsLines.push('}%');

  return {
    vsCode: vsLines.join('\n'),
    fsCode: fsLines.join('\n'),
    ubo,
  };
}

/**
 * Emits full .effect source code from ShaderDocumentIR
 */
function emitCocosEffect(docIR, options = {}) {
  if (options.mode === 'surface-pbr') {
    return emitSurfaceShaderEffect(docIR, docIR.subShaders[0]?.passes[0] || { renderState: {} }, options);
  }

  const subShader = docIR.subShaders[0] || { passes: [{ renderState: {}, program: {} }] };
  const pass = subShader.passes[0] || { renderState: {}, program: {} };

  const { vsCode, fsCode, ubo } = generateCocosPrograms(docIR, pass, options);
  const yaml = buildCceffectYaml(docIR, pass, ubo, options);

  return `${yaml}\n\n${vsCode}\n\n${fsCode}\n`;
}

/**
 * Emits Cocos Material (.mtl) scaffold matching the effect
 */
function emitCocosMaterial(docIR, effectRelativePath) {
  const mtl = {
    __type__: 'cc.Material',
    _name: docIR.shaderName.replace(/[\/\\]/g, '_'),
    _objFlags: 0,
    _native: '',
    _effectAsset: {
      __uuid__: effectRelativePath,
    },
    _techIdx: 0,
    _defines: [{}],
    _states: [{}],
    _props: [{}],
  };

  const propsObj = {};
  for (const prop of docIR.properties) {
    const pName = prop.cocosName || prop.name;
    if (prop.type === 'Color' || prop.type === 'Vector') {
      propsObj[pName] = {
        __type__: 'cc.Color',
        r: Math.round((prop.defaultValue[0] || 0) * 255),
        g: Math.round((prop.defaultValue[1] || 0) * 255),
        b: Math.round((prop.defaultValue[2] || 0) * 255),
        a: Math.round((prop.defaultValue[3] || 1) * 255),
      };
    } else if (prop.type === 'Float' || prop.type === 'Range' || prop.type === 'Int') {
      propsObj[pName] = prop.defaultValue;
    }
  }

  mtl._props = [propsObj];
  return JSON.stringify(mtl, null, 2);
}

module.exports = {
  buildCceffectYaml,
  generateCocosPrograms,
  emitCocosEffect,
  emitSurfaceShaderEffect,
  emitCocosMaterial,
  GLSL_SIMPLE_LIGHTING_SNIPPET,
  GLSL_NORMAL_UNPACK_SNIPPET,
};
