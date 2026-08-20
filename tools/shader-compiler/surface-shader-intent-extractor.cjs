'use strict';

/**
 * Surface Shader & PBR Intent Extractor
 * for UCShaderTranspiler
 *
 * Implements:
 * 1. #pragma surface parsing (surf function, lighting model, options)
 * 2. SurfaceShaderIntent extraction (albedo, normal, emission, metallic, smoothness, occlusion, alpha)
 * 3. Packed map detection (_MetallicGlossMap, _MaskMap, _OcclusionMap)
 * 4. Surface shader body rewriting for Cocos Creator material output
 */

const KNOWN_LIGHTING_MODELS = ['Lambert', 'BlinnPhong', 'Standard', 'StandardSpecular'];

/**
 * Parses #pragma surface directives from shader code
 */
function parseSurfacePragma(hlslCode) {
  if (!hlslCode) return null;

  // e.g. #pragma surface surf Standard fullforwardshadows
  // e.g. #pragma surface surf Lambert alpha:fade
  const match = /#pragma\s+surface\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)([\s\S]*?)(?:\r?\n|$)/i.exec(hlslCode);
  if (!match) return null;

  const surfaceFunction = match[1];
  const rawLighting = match[2];
  const rawOptions = match[3] ? match[3].trim().split(/\s+/).filter(Boolean) : [];

  let lightingModel = 'Custom';
  for (const model of KNOWN_LIGHTING_MODELS) {
    if (model.toLowerCase() === rawLighting.toLowerCase()) {
      lightingModel = model;
      break;
    }
  }

  return {
    surfaceFunction,
    lightingModel,
    rawLighting,
    options: rawOptions,
  };
}

/**
 * Extracts surface shader output assignments from surf() function body
 */
function extractSurfaceShaderIntent(hlslCode) {
  const pragma = parseSurfacePragma(hlslCode);
  if (!pragma) return null;

  const funcName = pragma.surfaceFunction;
  // Match void surf(Input IN, inout SurfaceOutputStandard o) { ... }
  const funcRegex = new RegExp(`void\\s+${funcName}\\s*\\(\\s*([A-Za-z_]\\w*)\\s+([A-Za-z_]\\w*)\\s*,\\s*(?:inout|out)\\s+([A-Za-z_]\\w*)\\s+([A-Za-z_]\\w*)\\s*\\)\\s*\\{([\\s\\S]*?)\\}`, 'i');
  const funcMatch = funcRegex.exec(hlslCode);

  let inputStruct = 'Input';
  let inputVar = 'IN';
  let outStruct = 'SurfaceOutputStandard';
  let outVar = 'o';
  let body = '';

  if (funcMatch) {
    inputStruct = funcMatch[1];
    inputVar = funcMatch[2];
    outStruct = funcMatch[3];
    outVar = funcMatch[4];
    body = funcMatch[5];
  } else {
    // Fallback search for any surf body
    const fallbackRegex = new RegExp(`void\\s+${funcName}[^{]*\\{([\\s\\S]*?)\\}`, 'i');
    const fbMatch = fallbackRegex.exec(hlslCode);
    if (fbMatch) {
      body = fbMatch[1];
    }
  }

  const outputFields = {};

  if (body) {
    // Extract o.Albedo = expr;
    const albedoMatch = new RegExp(`\\b${outVar}\\.Albedo\\s*=\\s*([^;]+);`, 'i').exec(body);
    if (albedoMatch) outputFields.albedo = albedoMatch[1].trim();

    // Extract o.Normal = expr;
    const normalMatch = new RegExp(`\\b${outVar}\\.Normal\\s*=\\s*([^;]+);`, 'i').exec(body);
    if (normalMatch) outputFields.normal = normalMatch[1].trim();

    // Extract o.Emission = expr;
    const emissionMatch = new RegExp(`\\b${outVar}\\.Emission\\s*=\\s*([^;]+);`, 'i').exec(body);
    if (emissionMatch) outputFields.emission = emissionMatch[1].trim();

    // Extract o.Metallic = expr;
    const metallicMatch = new RegExp(`\\b${outVar}\\.Metallic\\s*=\\s*([^;]+);`, 'i').exec(body);
    if (metallicMatch) outputFields.metallic = metallicMatch[1].trim();

    // Extract o.Smoothness = expr;
    const smoothnessMatch = new RegExp(`\\b${outVar}\\.Smoothness\\s*=\\s*([^;]+);`, 'i').exec(body);
    if (smoothnessMatch) {
      outputFields.smoothness = smoothnessMatch[1].trim();
      outputFields.roughness = `(1.0 - (${outputFields.smoothness}))`;
    }

    // Extract o.Occlusion = expr;
    const occlusionMatch = new RegExp(`\\b${outVar}\\.Occlusion\\s*=\\s*([^;]+);`, 'i').exec(body);
    if (occlusionMatch) outputFields.occlusion = occlusionMatch[1].trim();

    // Extract o.Alpha = expr;
    const alphaMatch = new RegExp(`\\b${outVar}\\.Alpha\\s*=\\s*([^;]+);`, 'i').exec(body);
    if (alphaMatch) outputFields.alpha = alphaMatch[1].trim();
  }

  return {
    surfaceFunction: funcName,
    lightingModel: pragma.lightingModel,
    inputStruct,
    inputVar,
    outputStruct: outStruct,
    outputVar: outVar,
    outputFields,
    options: pragma.options,
    body,
  };
}

// ============================================================================
// URP HLSL PBR intent
// ============================================================================

/**
 * URP's SurfaceData field -> the Cocos SurfacesMaterialData member it feeds.
 * `smoothness` is deliberately absent: Cocos stores roughness, so it needs the
 * 1 - x inversion applied rather than a straight rename (spec section 29).
 */
const URP_SURFACE_FIELD_MAP = {
  albedo: 'albedo',
  alpha: 'alpha',
  metallic: 'metallic',
  occlusion: 'occlusion',
  emission: 'emission',
  specular: 'specular',
  normalTS: 'normalTS',
  clearCoatMask: null,
  clearCoatSmoothness: null,
};

const IDENTITY_NORMAL_TS = /^(?:float3|half3|vec3)\s*\(\s*0\s*,\s*0\s*,\s*1(?:\.0)?\s*\)$/;

/** Body of the first function whose return type looks like a fragment output. */
function findFragmentBody(hlslCode, entryName) {
  const names = entryName ? [entryName] : ['frag', 'Fragment', 'LitPassFragment'];
  for (const n of names) {
    const re = new RegExp(`\\b(?:half4|float4|fixed4|vec4)\\s+${n}\\s*\\(`, 'i');
    const m = re.exec(hlslCode);
    if (!m) continue;
    // brace-match the body
    const open = hlslCode.indexOf('{', m.index);
    if (open === -1) continue;
    let depth = 0;
    for (let i = open; i < hlslCode.length; i++) {
      if (hlslCode[i] === '{') depth++;
      else if (hlslCode[i] === '}') { depth--; if (depth === 0) return hlslCode.slice(open + 1, i); }
    }
  }
  return '';
}

/**
 * Extract PBR intent from a URP HLSL fragment that builds a `SurfaceData` and
 * hands it to `UniversalFragmentPBR`.
 *
 * The struct assignments are only half the story: everything computed *before*
 * them (texture samples, lerps, masks) is what actually produces the values, so
 * that preamble is captured too and replayed inside the Cocos surface function.
 * Dropping it would leave `surfaceData.albedo = finalAlbedo` referring to
 * nothing.
 *
 * @param {string} hlslCode
 * @param {string} [fragmentEntry]
 * @returns {null | {style: 'urp', outputFields: object, preamble: string,
 *                   inputFields: object, body: string}}
 */
function extractUrpPbrIntent(hlslCode, fragmentEntry) {
  if (!hlslCode || !/\bUniversalFragmentPBR\b/.test(hlslCode)) return null;

  const body = findFragmentBody(hlslCode, fragmentEntry);
  if (!body) return null;

  const surfDecl = /\b(?:SurfaceData)\s+([A-Za-z_]\w*)\s*=/.exec(body);
  if (!surfDecl) return null;
  const surfVar = surfDecl[1];

  const inputDecl = /\b(?:InputData)\s+([A-Za-z_]\w*)\s*=/.exec(body);
  const inputVar = inputDecl ? inputDecl[1] : null;

  const outputFields = {};
  const assignRe = new RegExp(`\\b${surfVar}\\.([A-Za-z_]\\w*)\\s*=\\s*([^;]+);`, 'g');
  let m;
  while ((m = assignRe.exec(body)) !== null) {
    const field = m[1];
    const expr = m[2].trim();
    if (!(field in URP_SURFACE_FIELD_MAP)) continue;
    if (URP_SURFACE_FIELD_MAP[field] === null) continue;
    if (field === 'normalTS' && IDENTITY_NORMAL_TS.test(expr)) continue; // no-op
    outputFields[field] = expr;
  }
  // smoothness -> roughness, per spec section 29
  const smoothMatch = new RegExp(`\\b${surfVar}\\.smoothness\\s*=\\s*([^;]+);`).exec(body);
  if (smoothMatch) {
    outputFields.smoothness = smoothMatch[1].trim();
    outputFields.roughness = `(1.0 - (${outputFields.smoothness}))`;
  }

  const inputFields = {};
  if (inputVar) {
    const inRe = new RegExp(`\\b${inputVar}\\.([A-Za-z_]\\w*)\\s*=\\s*([^;]+);`, 'g');
    while ((m = inRe.exec(body)) !== null) inputFields[m[1]] = m[2].trim();
  }

  // Preamble: statements before the SurfaceData declaration. Anything after it
  // is struct plumbing that the Cocos surface model supplies itself.
  const preamble = body.slice(0, surfDecl.index).trim();

  return { style: 'urp', outputFields, inputFields, preamble, body, surfaceVar: surfVar };
}

/**
 * Unified PBR intent for both shader dialects, so the emitter has one shape to
 * consume: legacy `#pragma surface` (SurfaceOutputStandard) and URP HLSL
 * (SurfaceData + UniversalFragmentPBR).
 *
 * @returns {null | {style: 'legacy'|'urp', outputFields: object, preamble: string, ...}}
 */
function extractPbrIntent(hlslCode, fragmentEntry) {
  const legacy = extractSurfaceShaderIntent(hlslCode);
  if (legacy) {
    // Normalise legacy field names onto the URP-ish keys the emitter reads.
    const f = legacy.outputFields;
    return {
      style: 'legacy',
      outputFields: {
        albedo: f.albedo,
        alpha: f.alpha,
        metallic: f.metallic,
        smoothness: f.smoothness,
        roughness: f.roughness,
        occlusion: f.occlusion,
        emission: f.emission,
        normalTS: f.normal,
      },
      inputFields: {},
      // The surf() body assigns straight into o.*, so there is no separate
      // preamble to replay; local declarations inside it are kept verbatim.
      preamble: stripSurfaceAssignments(legacy.body, legacy.outputVar || 'o'),
      // surf(Input IN, ...) -- the emitter needs IN's name to rewrite IN.uv_X
      // and friends. A legacy shader has no `frag` entry to take it from.
      inputParam: legacy.inputVar,
      lightingModel: legacy.lightingModel,
      options: legacy.options,
      body: legacy.body,
    };
  }
  return extractUrpPbrIntent(hlslCode, fragmentEntry);
}

/** Drop `o.Field = ...;` lines, keeping the local computation around them. */
function stripSurfaceAssignments(body, outVar) {
  if (!body) return '';
  return body
    .replace(new RegExp(`\\b${outVar}\\.[A-Za-z_]\\w*\\s*=\\s*[^;]+;`, 'g'), '')
    .trim();
}

/**
 * Detects packed textures (MetallicGlossMap, MaskMap, OcclusionMap)
 */
function detectPackedMaps(samplers = [], properties = []) {
  const packed = {};
  const names = samplers.map(s => s.name || s).concat(properties.map(p => p.name || p));

  for (const name of names) {
    if (/_MetallicGlossMap|_MetallicMap/i.test(name)) {
      packed[name] = {
        name,
        type: 'MetallicGlossMap',
        channels: {
          metallic: 'r',
          smoothness: 'a',
          occlusion: null,
        },
      };
    } else if (/_MaskMap/i.test(name)) {
      packed[name] = {
        name,
        type: 'MaskMap',
        channels: {
          metallic: 'r',
          occlusion: 'g',
          detail: 'b',
          smoothness: 'a',
        },
      };
    } else if (/_OcclusionMap/i.test(name)) {
      packed[name] = {
        name,
        type: 'OcclusionMap',
        channels: {
          occlusion: 'g',
        },
      };
    }
  }

  return packed;
}

module.exports = {
  KNOWN_LIGHTING_MODELS,
  URP_SURFACE_FIELD_MAP,
  parseSurfacePragma,
  extractSurfaceShaderIntent,
  extractUrpPbrIntent,
  extractPbrIntent,
  findFragmentBody,
  detectPackedMaps,
};
