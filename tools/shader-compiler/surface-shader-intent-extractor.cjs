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
  let outStruct = 'SurfaceOutputStandard';
  let outVar = 'o';
  let body = '';

  if (funcMatch) {
    inputStruct = funcMatch[1];
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
    outputStruct: outStruct,
    outputFields,
    options: pragma.options,
    body,
  };
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
  parseSurfacePragma,
  extractSurfaceShaderIntent,
  detectPackedMaps,
};
