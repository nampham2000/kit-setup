'use strict';

/**
 * Cocos Creator 3.8.8 surface-shader ("surface-pbr") emitter.
 *
 * Spec Module 2 / section 28: for shaders whose intent is PBR material data,
 * map the material concepts onto Cocos's surface-shader hooks instead of
 * reproducing the BRDF by hand. Unity's two PBR dialects -- legacy
 * `#pragma surface surf Standard` and URP's `SurfaceData` +
 * `UniversalFragmentPBR` -- both reduce to the same set of channels, so both
 * feed the single intent shape from surface-shader-intent-extractor.cjs.
 *
 * The emitted layout follows the engine's own advanced effects
 * (editor/assets/effects/advanced/*.effect): named CCProgram blocks that the
 * real entry points include. The entry point is NOT hand-written -- it comes
 * from `shading-entries/main-functions/render-to-scene/{vs,fs}`, which is what
 * makes the engine's lighting, shadows and fog apply.
 *
 *   shared-ubos      material uniforms
 *   macro-remapping   user macros -> CC_SURFACES_* switches
 *   surface-vertex    custom varyings + SurfacesVertexModifyLocalSharedData
 *   surface-fragment  samplers + SurfacesFragmentModifySharedData
 *   standard-vs/fs    includes only; the engine supplies main()
 *
 * All channel writes land in `SurfacesFragmentModifySharedData`, which the
 * engine documents as invoked last. One function means shared preamble work
 * (a texture sample feeding both albedo and alpha) is computed once, rather
 * than duplicated across per-channel hooks.
 */

const { lowerHlslToGlsl } = require('./unity-semantic-lowering.cjs');
const { extractPbrIntent } = require('./surface-shader-intent-extractor.cjs');
const {
  SRGB_SAMPLE_HELPER,
  srgbSamplerNames,
  lowerSrgbTextureSamples,
} = require('./color-space-lowering.cjs');

// Unity varying field -> the engine's fragment-stage input of the same meaning.
const FS_INPUT_MAP = {
  uv: 'FSInput_texcoord',
  uv0: 'FSInput_texcoord',
  texcoord: 'FSInput_texcoord',
  texcoord0: 'FSInput_texcoord',
  uv1: 'FSInput_texcoord1',
  texcoord1: 'FSInput_texcoord1',
  positionWS: 'FSInput_worldPos',
  worldPos: 'FSInput_worldPos',
  normalWS: 'FSInput_worldNormal',
  worldNormal: 'FSInput_worldNormal',
  tangentWS: 'FSInput_worldTangent',
  color: 'FSInput_vertexColor',
  vertexColor: 'FSInput_vertexColor',
};

// Unity vertex-output field -> SurfacesStandardVertexIntermediate member.
const VS_INTERMEDIATE_MAP = {
  positionOS: 'In.position',
  position: 'In.position',
  vertex: 'In.position',
  posOS: 'In.position',
  normalOS: 'In.normal',
  normal: 'In.normal',
  tangentOS: 'In.tangent',
  tangent: 'In.tangent',
  uv: 'In.texCoord',
  uv0: 'In.texCoord',
  texcoord: 'In.texCoord',
  texcoord0: 'In.texCoord',
  uv1: 'In.texCoord1',
  texcoord1: 'In.texCoord1',
  color: 'In.color',
  positionWS: 'In.worldPos',
  worldPos: 'In.worldPos',
  normalWS: 'In.worldNormal.xyz',
  worldNormal: 'In.worldNormal.xyz',
};

// Fields that are the clip-space output or otherwise supplied by the engine,
// so they must never become a custom varying.
const ENGINE_OWNED_FIELDS = new Set([
  'positionCS', 'positionHCS', 'posHCS', 'posCS', 'clipPos', 'vertex', 'pos',
  ...Object.keys(FS_INPUT_MAP),
]);

const HLSL_TO_GLSL_TYPE = {
  float: 'float', float2: 'vec2', float3: 'vec3', float4: 'vec4',
  half: 'float', half2: 'vec2', half3: 'vec3', half4: 'vec4',
  fixed: 'float', fixed2: 'vec2', fixed3: 'vec3', fixed4: 'vec4',
  min16float: 'float', min16float2: 'vec2', min16float3: 'vec3', min16float4: 'vec4',
};

/**
 * Varying fields with no engine equivalent. These have to be forwarded by hand
 * (declared `out` in surface-vertex, `in` in surface-fragment), exactly as the
 * engine's own eye.effect does with v_planeN/v_planeT.
 */
function collectCustomVaryings(programIR) {
  const fragFunc = (programIR.functions || []).find(f => f.name === programIR.fragmentEntry);
  const structName = fragFunc && fragFunc.params && fragFunc.params[0] && fragFunc.params[0].type;
  const struct = (programIR.structs || []).find(s => s.name === structName);
  if (!struct) return [];

  const out = [];
  const seen = new Set();
  for (const f of struct.fields) {
    if (ENGINE_OWNED_FIELDS.has(f.name)) continue;
    if (/^SV_POSITION$/i.test(f.semantic || '')) continue;
    const glslType = HLSL_TO_GLSL_TYPE[f.type];
    if (!glslType || seen.has(f.name)) continue;
    seen.add(f.name);
    out.push({ field: f.name, varying: `v_${f.name}`, glslType });
  }
  return out;
}

/** Rewrite `<param>.<field>` for the fragment stage. */
function remapFragmentInputs(code, paramName, customVaryings) {
  let out = code;
  if (paramName) {
    // Legacy surface shaders name their UV field after the texture
    // (`IN.uv_MainTex`), and derive viewDir from the camera. Handle these before
    // the plain table so `uv_MainTex` is not left dangling.
    out = out.replace(new RegExp(`\\b${paramName}\\.uv2?_[A-Za-z_]\\w*\\b`, 'g'), 'FSInput_texcoord');
    out = out.replace(new RegExp(`\\b${paramName}\\.viewDir\\b`, 'g'), 'normalize(cc_cameraPos.xyz - FSInput_worldPos)');
    // Unity's Input.screenPos is the homogeneous clip position; the surface
    // model exposes the same value as FSInput_clipPos once
    // CC_SURFACES_TRANSFER_CLIP_POS is on (emitted in macro-remapping below).
    out = out.replace(new RegExp(`\\b${paramName}\\.screenPos\\b`, 'g'), 'FSInput_clipPos');
    for (const [field, target] of Object.entries(FS_INPUT_MAP)) {
      out = out.replace(new RegExp(`\\b${paramName}\\.${field}\\b`, 'g'), target);
    }
    for (const cv of customVaryings) {
      out = out.replace(new RegExp(`\\b${paramName}\\.${cv.field}\\b`, 'g'), cv.varying);
    }
  }
  return out;
}

/** Rewrite vertex input/output struct access onto the intermediate struct. */
function remapVertexRefs(code, inParam, customVaryings) {
  let out = code;
  if (inParam) {
    for (const [field, target] of Object.entries(VS_INTERMEDIATE_MAP)) {
      out = out.replace(new RegExp(`\\b${inParam}\\.${field}\\b`, 'g'), target);
    }
  }
  // Output-struct writes: `o.topMask = ...` -> `v_topMask = ...`
  for (const cv of customVaryings) {
    out = out.replace(new RegExp(`\\b\\w+\\.${cv.field}\\b`, 'g'), cv.varying);
  }
  // Anything still addressing the output struct's engine-owned fields maps to
  // the intermediate. `In` is excluded because it is the *target* of these
  // rewrites: re-matching it turns `In.worldNormal.xyz` into
  // `In.worldNormal.xyz.xyz`, which is not a valid swizzle.
  for (const [field, target] of Object.entries(VS_INTERMEDIATE_MAP)) {
    out = out.replace(new RegExp(`\\b(?!In\\b)\\w+\\.${field}\\b`, 'g'), target);
  }
  out = out.replace(/\b(?!In\b)\w+\.(?:positionCS|positionHCS|posHCS|posCS|clipPos)\b/g, 'In.clipPos');
  // The Unity vertex entry returned its output struct; there is nothing to
  // return from a void modify hook.
  out = out.replace(/\breturn\s+\w+\s*;/g, '');
  out = out.replace(/\b(?:Varyings|v2f|Attributes|appdata|\w+_Output|\w+_Input)\s+\w+\s*;?/g, '');
  return out;
}

function indent(text, pad = '    ') {
  return String(text || '')
    .split('\n')
    .map(l => (l.trim() ? pad + l.trim() : ''))
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n');
}

/**
 * Build the surface-pbr `.effect` text.
 *
 * @param {object} args
 * @param {object} args.docIR
 * @param {object} args.passIR
 * @param {string} args.yaml       CCEffect block, already built by the caller
 * @param {{glsl: string}} args.ubo
 * @param {{name: string, type: string}[]} args.samplers
 * @returns {{text: string, diagnostics: object[], intentStyle: string|null}}
 */
function buildSurfacePbrEffect({ docIR, passIR, yaml, ubo, samplers = [], propertyNameMap = new Map() }) {
  const programIR = passIR.program || {};
  const rawCode = programIR.rawHlsl || '';
  const diagnostics = [];

  // Unity property names -> the Cocos uniform names the UBO actually declares.
  const remapProps = (code) => {
    let res = code;
    for (const [uName, cName] of propertyNameMap.entries()) {
      if (uName !== cName) res = res.replace(new RegExp(`\\b${uName}\\b`, 'g'), cName);
    }
    return res;
  };
  /** Lower HLSL to GLSL and bind Unity property names to Cocos uniforms. */
  const lowerAndBind = (code) => remapProps(lowerHlslToGlsl(code));
  const colorSamplerNames = srgbSamplerNames(samplers);
  const lowerFragmentCode = (code) =>
    lowerSrgbTextureSamples(lowerAndBind(code), colorSamplerNames);

  const intent = extractPbrIntent(rawCode, programIR.fragmentEntry);
  if (!intent) {
    diagnostics.push({
      severity: 'high',
      code: 'SURFACE_PBR_INTENT_NOT_FOUND',
      message: 'No PBR intent found: expected either `#pragma surface` (legacy) or a SurfaceData handed to UniversalFragmentPBR (URP). Emitted a passthrough surface shader; the material channels are defaults, not the source shader.',
    });
  }

  const customVaryings = collectCustomVaryings(programIR);
  const fragFunc = (programIR.functions || []).find(f => f.name === programIR.fragmentEntry);
  // A legacy `#pragma surface` shader has no fragment entry at all; its input
  // struct arrives as surf()'s first parameter, so take the name from the intent.
  const fragParam = (intent && intent.inputParam) ||
    (fragFunc && fragFunc.params && fragFunc.params[0] && fragFunc.params[0].name);
  const vertFunc = (programIR.functions || []).find(f => f.name === programIR.vertexEntry);
  const vertParam = vertFunc && vertFunc.params && vertFunc.params[0] && vertFunc.params[0].name;

  // ---- helper functions the shader declared itself (RotateUV etc.) ----
  const helperFns = (programIR.functions || [])
    .filter(f => f.name !== programIR.vertexEntry && f.name !== programIR.fragmentEntry)
    .filter(f => f.body && !/^surf$/i.test(f.name));

  const loweredHelpers = helperFns.map((f) => {
    const params = (f.params || [])
      .map(p => `${HLSL_TO_GLSL_TYPE[p.type] || p.type} ${p.name}`)
      .join(', ');
    const ret = HLSL_TO_GLSL_TYPE[f.returnType] || f.returnType;
    return `  ${ret} ${f.name}(${params}) {\n${indent(lowerAndBind(f.body), '    ')}\n  }`;
  });
  const loweredFragmentHelpers = loweredHelpers.map(code =>
    lowerSrgbTextureSamples(code, colorSamplerNames));

  // ---- surface-vertex ----
  const vsBody = [];
  if (vertFunc && vertFunc.body) {
    let body = lowerAndBind(vertFunc.body);
    body = remapVertexRefs(body, vertParam, customVaryings);
    if (body.trim()) vsBody.push(indent(body));
  }
  for (const cv of customVaryings) {
    // A varying the vertex body never wrote would read as uninitialised.
    if (!vsBody.join('\n').includes(cv.varying)) {
      diagnostics.push({
        severity: 'medium',
        code: 'SURFACE_PBR_VARYING_UNWRITTEN',
        message: `Custom varying '${cv.varying}' is declared for '${cv.field}' but the ported vertex body never assigns it. Check the original vertex shader.`,
      });
    }
  }

  const surfaceVertex = [
    'CCProgram surface-vertex %{',
    ...customVaryings.map(cv => `  out ${cv.glslType} ${cv.varying};`),
    customVaryings.length ? '' : null,
    ...loweredHelpers,
    loweredHelpers.length ? '' : null,
    '  #define CC_SURFACES_VERTEX_MODIFY_LOCAL_SHARED_DATA',
    '  void SurfacesVertexModifyLocalSharedData(inout SurfacesStandardVertexIntermediate In) {',
    vsBody.length ? vsBody.join('\n') : '    // no custom vertex work in the source shader',
    '  }',
    '}%',
  ].filter(l => l !== null);

  // ---- surface-fragment ----
  const fsBody = [];
  if (intent) {
    if (intent.preamble && intent.preamble.trim()) {
      let pre = lowerFragmentCode(intent.preamble);
      pre = remapFragmentInputs(pre, fragParam, customVaryings);
      if (pre.trim()) {
        fsBody.push('    // ported from the Unity fragment body');
        fsBody.push(indent(pre));
      }
    }

    const f = intent.outputFields || {};
    const lower = (expr) => remapFragmentInputs(lowerFragmentCode(String(expr)), fragParam, customVaryings).trim();
    /**
     * Assigning to a float channel. HLSL happily takes `surfaceData.occlusion = 1`,
     * but GLSL ES 300 has no implicit int->float conversion, so a bare integer
     * literal is a compile error. Only whole-literal expressions are touched;
     * anything with an operator is left alone.
     */
    const lowerScalar = (expr) => {
      const v = lower(expr);
      return /^[-+]?\d+$/.test(v) ? `${v}.0` : v;
    };
    /** Same, for a vec3 channel: a scalar literal has to be splatted. */
    const lowerVec3 = (expr) => {
      const v = lower(expr);
      return /^[-+]?\d+(?:\.\d*)?$/.test(v) ? `vec3(${/\./.test(v) ? v : v + '.0'})` : v;
    };

    if (f.albedo) fsBody.push(`    surfaceData.baseColor.rgb = ${lowerVec3(f.albedo)};`);
    if (f.alpha) fsBody.push(`    surfaceData.baseColor.a = ${lowerScalar(f.alpha)};`);
    // Cocos stores roughness; Unity authors smoothness (spec section 29).
    if (f.roughness) fsBody.push(`    surfaceData.roughness = ${lowerScalar(f.roughness)};`);
    if (f.metallic) fsBody.push(`    surfaceData.metallic = ${lowerScalar(f.metallic)};`);
    if (f.occlusion) fsBody.push(`    surfaceData.ao = ${lowerScalar(f.occlusion)};`);
    if (f.emission) fsBody.push(`    surfaceData.emissive = ${lowerVec3(f.emission)};`);
    if (f.specular) fsBody.push(`    surfaceData.specularIntensity = ${lowerScalar(f.specular)};`);

    if (f.normalTS) {
      // A tangent-space normal needs the tangent frame, which only exists when
      // the effect opts into it; flag rather than emit a silently wrong basis.
      diagnostics.push({
        severity: 'medium',
        code: 'SURFACE_PBR_NORMAL_MAP_MANUAL',
        message: `Source assigns a tangent-space normal (${String(f.normalTS).slice(0, 60)}). Enable CC_SURFACES_USE_TANGENT_SPACE and write SurfacesFragmentModifyWorldNormal(); it is not emitted automatically.`,
      });
    }
    for (const k of ['bakedGI', 'shadowCoord']) {
      if (intent.inputFields && intent.inputFields[k]) {
        diagnostics.push({
          severity: 'low',
          code: 'SURFACE_PBR_ENGINE_SUPPLIED',
          message: `inputData.${k} is supplied by the Cocos lighting pipeline; the Unity expression was dropped.`,
        });
      }
    }
  }

  const surfaceFragment = [
    'CCProgram surface-fragment %{',
    colorSamplerNames.length ? '  #include <common/color/gamma>' : null,
    ...samplers.map(s => `  uniform ${s.type} ${s.name};`),
    samplers.length ? '' : null,
    ...customVaryings.map(cv => `  in ${cv.glslType} ${cv.varying};`),
    customVaryings.length ? '' : null,
    colorSamplerNames.length ? SRGB_SAMPLE_HELPER : null,
    ...loweredFragmentHelpers,
    loweredFragmentHelpers.length ? '' : null,
    '  #include <surfaces/data-structures/standard>',
    '  #define CC_SURFACES_FRAGMENT_MODIFY_SHARED_DATA',
    '  void SurfacesFragmentModifySharedData(inout SurfacesMaterialData surfaceData) {',
    fsBody.length ? fsBody.join('\n') : '    // no PBR channel writes recovered from the source shader',
    '  }',
    '}%',
  ].filter(l => l !== null);

  // ---- macro-remapping ----
  const usesVertexColor = /\bCOLOR\b|a_color|vertexColor/i.test(rawCode);
  // FSInput_vertexColor and FSInput_clipPos only exist when the effect opts in.
  // Reading either without its switch is a link error, so the switch is driven
  // by what the ported code actually references.
  const emittedGlsl = surfaceVertex.join('\n') + surfaceFragment.join('\n');
  const needsClipPos = /FSInput_clipPos/.test(emittedGlsl);
  const macroRemapping = [
    'CCProgram macro-remapping %{',
    '  #pragma define-meta HAS_SECOND_UV',
    '  #define CC_SURFACES_USE_SECOND_UV HAS_SECOND_UV',
    usesVertexColor ? '  #define CC_SURFACES_USE_VERTEX_COLOR 1' : null,
    needsClipPos ? '  #define CC_SURFACES_TRANSFER_CLIP_POS 1' : null,
    '}%',
  ].filter(l => l !== null);

  // ---- entry programs: includes only; the engine supplies main() ----
  const standardVs = [
    'CCProgram standard-vs %{',
    '  precision highp float;',
    '  #include <macro-remapping>',
    '  #include <surfaces/effect-macros/common-macros>',
    '  #include <surfaces/includes/common-vs>',
    '  #include <shared-ubos>',
    '  #include <surface-vertex>',
    '  #include <surfaces/includes/standard-vs>',
    '  #include <shading-entries/main-functions/render-to-scene/vs>',
    '}%',
  ];

  const standardFs = [
    'CCProgram standard-fs %{',
    '  precision highp float;',
    '  #include <macro-remapping>',
    '  #include <surfaces/effect-macros/common-macros>',
    '  #include <surfaces/includes/common-fs>',
    '  #include <shared-ubos>',
    '  #include <surface-fragment>',
    '  #include <lighting-models/includes/standard>',
    '  #include <surfaces/includes/standard-fs>',
    '  #include <shading-entries/main-functions/render-to-scene/fs>',
    '}%',
  ];

  const sharedUbos = [
    'CCProgram shared-ubos %{',
    ubo && ubo.glsl ? '  ' + ubo.glsl.split('\n').join('\n  ') : '  uniform Constants { vec4 tilingOffset; };',
    '}%',
  ];

  const text = [
    yaml,
    '',
    sharedUbos.join('\n'),
    '',
    macroRemapping.join('\n'),
    '',
    surfaceVertex.join('\n'),
    '',
    surfaceFragment.join('\n'),
    '',
    standardVs.join('\n'),
    '',
    standardFs.join('\n'),
    '',
  ].join('\n');

  return { text, diagnostics, intentStyle: intent ? intent.style : null };
}

module.exports = {
  buildSurfacePbrEffect,
  collectCustomVaryings,
  FS_INPUT_MAP,
  VS_INTERMEDIATE_MAP,
};
