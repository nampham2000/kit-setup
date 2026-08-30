'use strict';

/**
 * Unity Material (.mat) YAML -> Cocos Creator Material (.mtl) JSON Converter
 * with Asset Manifest & Texture Diagnostics
 *
 * Capabilities:
 * - Parses Unity YAML material files (m_Shader, m_SavedProperties: m_TexEnvs, m_Floats, m_Colors, m_Ints, m_ShaderKeywords)
 * - Remaps property names and ST (Scale/Offset) vectors to Cocos conventions
 * - Converts Color representations (0..1 floats -> 0..255 uint8), including
 *   Unity linear material colors for Cocos effect properties marked linear
 * - Emits valid Cocos Creator 3.8.8 cc.Material JSON structure
 * - Generates structured Material Asset Manifest JSON
 * - Provides texture asset diagnostics (sRGB vs linear, normal green inversion, packed maps)
 */

const fs = require('fs');
const path = require('path');
const { toCocosPropertyName } = require('./shaderlab-parser.cjs');

function parseUnityMatYaml(yamlContent) {
  const properties = {
    colors: {},
    floats: {},
    textures: {},
  };
  const keywords = [];
  let shaderGuid = '';

  // Extract shader GUID: m_Shader: {fileID: 4800000, guid: 12345678, type: 3}
  const shaderMatch = /m_Shader:\s*\{[^}]*guid:\s*([a-f0-9]+)/i.exec(yamlContent);
  if (shaderMatch) {
    shaderGuid = shaderMatch[1];
  }

  // Extract keywords: m_ShaderKeywords: "KEY1 KEY2"
  const kwMatch = /m_ShaderKeywords:\s*(.+)$/m.exec(yamlContent);
  if (kwMatch && kwMatch[1].trim()) {
    const rawKws = kwMatch[1].replace(/["']/g, '').trim().split(/\s+/);
    keywords.push(...rawKws.filter(Boolean));
  }

  const lines = yamlContent.split(/\r?\n/);
  let currentSection = '';
  let currentTexName = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^m_Colors\s*:/i.test(trimmed)) {
      currentSection = 'colors';
      continue;
    } else if (/^m_Floats\s*:/i.test(trimmed) || /^m_Ints\s*:/i.test(trimmed)) {
      currentSection = 'floats';
      continue;
    } else if (/^m_TexEnvs\s*:/i.test(trimmed)) {
      currentSection = 'textures';
      continue;
    } else if (/^(?:stringTagMap|m_BuildTextureStacks|m_LightmapFlags)\s*:/i.test(trimmed) || (/^[A-Za-z_]\w*\s*:/i.test(line) && !line.startsWith(' '))) {
      currentSection = '';
    }

    if (currentSection === 'colors') {
      const colorMatch = /-\s*([A-Za-z0-9_]+)\s*:\s*\{r:\s*([-\d.]+),\s*g:\s*([-\d.]+),\s*b:\s*([-\d.]+),\s*a:\s*([-\d.]+)\}/.exec(trimmed);
      if (colorMatch) {
        properties.colors[colorMatch[1]] = [
          parseFloat(colorMatch[2]),
          parseFloat(colorMatch[3]),
          parseFloat(colorMatch[4]),
          parseFloat(colorMatch[5]),
        ];
      }
    } else if (currentSection === 'floats') {
      const floatMatch = /-\s*([A-Za-z0-9_]+)\s*:\s*([-\d.]+)/.exec(trimmed);
      if (floatMatch) {
        properties.floats[floatMatch[1]] = parseFloat(floatMatch[2]);
      }
    } else if (currentSection === 'textures') {
      const texNameMatch = /-\s*([A-Za-z0-9_]+)\s*:/.exec(trimmed);
      if (texNameMatch) {
        currentTexName = texNameMatch[1];
        if (!properties.textures[currentTexName]) {
          properties.textures[currentTexName] = {
            guid: '',
            scale: [1, 1],
            offset: [0, 0],
          };
        }
      }

      if (currentTexName) {
        const guidMatch = /m_Texture:\s*\{[^}]*guid:\s*([a-f0-9]+)/.exec(trimmed);
        if (guidMatch) {
          properties.textures[currentTexName].guid = guidMatch[1];
        }

        const scaleMatch = /m_Scale:\s*\{x:\s*([-\d.]+),\s*y:\s*([-\d.]+)\}/.exec(trimmed);
        if (scaleMatch) {
          properties.textures[currentTexName].scale = [parseFloat(scaleMatch[1]), parseFloat(scaleMatch[2])];
        }

        const offsetMatch = /m_Offset:\s*\{x:\s*([-\d.]+),\s*y:\s*([-\d.]+)\}/.exec(trimmed);
        if (offsetMatch) {
          properties.textures[currentTexName].offset = [parseFloat(offsetMatch[1]), parseFloat(offsetMatch[2])];
        }
      }
    }
  }

  return { properties, keywords, shaderGuid };
}

/**
 * Diagnoses texture color space, normal inversion, and packing
 */
function performTextureAssetDiagnostics(textureName = '') {
  const isAlbedo = /_MainTex|_BaseMap|_Albedo|Color|Diffuse/i.test(textureName);
  const isNormal = /_BumpMap|_Normal|Normals/i.test(textureName);
  const isMetallicGloss = /_MetallicGlossMap|_MetallicMap/i.test(textureName);
  const isMask = /_MaskMap/i.test(textureName);
  const isOcclusion = /_OcclusionMap/i.test(textureName);

  let colorSpace = 'sRGB';
  if (isNormal || isMetallicGloss || isMask || isOcclusion || /Roughness|Metallic/i.test(textureName)) {
    colorSpace = 'linear';
  }

  let packing = 'none';
  if (isMetallicGloss) packing = 'MetallicGloss (R: Metallic, A: Smoothness)';
  else if (isMask) packing = 'MaskMap (R: Metallic, G: Occlusion, B: Detail, A: Smoothness)';
  else if (isOcclusion) packing = 'Occlusion (G: Occlusion)';

  return {
    textureName,
    colorSpace,
    normalMapGreenInvert: isNormal, // DirectX standard normals have inverted Y compared to Cocos/GL
    packing,
  };
}

/**
 * Generates structured Material Asset Manifest JSON
 */
function generateMaterialAssetManifest(yamlContent, options = {}) {
  const { properties, keywords, shaderGuid } = parseUnityMatYaml(yamlContent);
  const materialName = options.materialName || 'Material';
  const shaderName = options.shaderName || 'Custom/Shader';
  const effectPath = options.effectPath || `effects/${materialName}.effect`;

  const unityProperties = {};
  const cocosProperties = {};
  const textureDiagnostics = {};

  for (const [k, v] of Object.entries(properties.colors)) {
    unityProperties[k] = v;
    cocosProperties[toCocosPropertyName(k)] = v;
  }
  for (const [k, v] of Object.entries(properties.floats)) {
    unityProperties[k] = v;
    cocosProperties[toCocosPropertyName(k)] = v;
  }
  for (const [k, v] of Object.entries(properties.textures)) {
    unityProperties[k] = v.guid ? `guid:${v.guid}` : null;
    const cName = toCocosPropertyName(k);
    cocosProperties[cName] = v.guid ? `guid:${v.guid}` : null;

    if (v.scale && (v.scale[0] !== 1 || v.scale[1] !== 1 || v.offset[0] !== 0 || v.offset[1] !== 0)) {
      cocosProperties[`${cName}_ST`] = [v.scale[0], v.scale[1], v.offset[0], v.offset[1]];
    }

    textureDiagnostics[k] = performTextureAssetDiagnostics(k);
  }

  return {
    material: materialName,
    shader: shaderName,
    shaderGuid,
    keywords,
    unityProperties,
    cocos: {
      effect: effectPath,
      properties: cocosProperties,
    },
    textureDiagnostics,
  };
}

function normalizedChannelToByte(value, fallback = 0) {
  const number = Number(value);
  const normalized = Number.isFinite(number) ? number : fallback;
  return Math.max(0, Math.min(255, Math.round(Math.max(0, Math.min(1, normalized)) * 255)));
}

function linearChannelToSrgbByte(value) {
  const number = Number(value);
  const linear = Math.max(0, Math.min(1, Number.isFinite(number) ? number : 0));
  const srgb = linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return normalizedChannelToByte(srgb);
}

/**
 * Reads inline property declarations from every CCEffect pass. Generated
 * effects keep color metadata on one line, while the continuation handling
 * also supports hand-formatted declarations with nested editor metadata.
 */
function extractCocosEffectPropertyMetadata(effectText) {
  const ccEffect = /CCEffect\s*%\{([\s\S]*?)\}%/.exec(String(effectText || ''));
  const metadata = new Map();
  if (!ccEffect) return metadata;

  const lines = ccEffect[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const propertiesMatch = /^(\s*)(?:-\s*)?properties\s*:\s*(?:&[A-Za-z_]\w*)?\s*$/.exec(lines[index]);
    if (!propertiesMatch) continue;
    const blockIndent = propertiesMatch[1].length;

    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const indent = /^\s*/.exec(line)[0].length;
      if (indent <= blockIndent) {
        index -= 1;
        break;
      }

      const entry = /^\s+([A-Za-z_]\w*)\s*:\s*(\{.*)$/.exec(line);
      if (!entry) continue;
      let declaration = entry[2];
      let braceDepth = (declaration.match(/\{/g) || []).length - (declaration.match(/\}/g) || []).length;
      while (braceDepth > 0 && index + 1 < lines.length) {
        declaration += `\n${lines[++index]}`;
        braceDepth += (lines[index].match(/\{/g) || []).length - (lines[index].match(/\}/g) || []).length;
      }
      metadata.set(entry[1], {
        linear: /(?:^|[,\s])linear\s*:\s*true(?:[,\s}]|$)/i.test(declaration),
      });
    }
  }
  return metadata;
}

/**
 * Converts Unity .mat to Cocos .mtl JSON string
 */
function convertUnityMatToCocosMtl(yamlContent, options = {}) {
  const { properties, keywords } = parseUnityMatYaml(yamlContent);
  const materialName = options.materialName || 'ConvertedMaterial';
  const effectUuid = options.effectUuid || options.effectAsset || '';
  const linearColorProperties = options.linearColorProperties instanceof Set
    ? options.linearColorProperties
    : new Set(options.linearColorProperties || []);

  const defines = {};
  for (const kw of keywords) {
    defines[kw] = true;
  }

  const propsObj = {};

  // Convert Colors
  for (const [uName, val] of Object.entries(properties.colors)) {
    const cName = toCocosPropertyName(uName);
    const convertRgb = linearColorProperties.has(cName)
      ? linearChannelToSrgbByte
      : normalizedChannelToByte;
    propsObj[cName] = {
      __type__: 'cc.Color',
      r: convertRgb(val[0]),
      g: convertRgb(val[1]),
      b: convertRgb(val[2]),
      a: normalizedChannelToByte(val[3], 1),
    };
  }

  // Convert Floats
  for (const [uName, val] of Object.entries(properties.floats)) {
    const cName = toCocosPropertyName(uName);
    propsObj[cName] = val;
  }

  // Convert Textures
  for (const [uName, val] of Object.entries(properties.textures)) {
    const cName = toCocosPropertyName(uName);
    if (val.guid) {
      propsObj[cName] = {
        __uuid__: val.guid,
      };
    }
    // Unity keeps tiling/offset on the texture entry; the generated effect
    // exposes it as `<name>_ST` (xy = scale, zw = offset), matching how
    // TRANSFORM_TEX was lowered. Dropping it silently loses every material's
    // tiling, which reads as a UV bug rather than a missing property.
    const scale = val.scale || [1, 1];
    const offset = val.offset || [0, 0];
    const isDefaultST = scale[0] === 1 && scale[1] === 1 && offset[0] === 0 && offset[1] === 0;
    if (!isDefaultST) {
      propsObj[`${cName}_ST`] = {
        __type__: 'cc.Vec4',
        x: scale[0], y: scale[1], z: offset[0], w: offset[1],
      };
    }
  }

  const mtlData = {
    __type__: 'cc.Material',
    _name: materialName,
    _objFlags: 0,
    _native: '',
    _effectAsset: effectUuid ? { __uuid__: effectUuid } : { __expectedType__: 'cc.EffectAsset' },
    _techIdx: 0,
    _defines: [defines],
    _states: [{}],
    _props: [propsObj],
  };

  return JSON.stringify(mtlData, null, 2) + '\n';
}

function convertMaterialDirectory(unityMatDir, cocosMtlDir, options = {}) {
  if (!fs.existsSync(unityMatDir)) return { converted: 0, failed: 0 };
  if (!fs.existsSync(cocosMtlDir)) fs.mkdirSync(cocosMtlDir, { recursive: true });

  const files = fs.readdirSync(unityMatDir);
  let converted = 0;
  let failed = 0;

  for (const file of files) {
    if (file.endsWith('.mat')) {
      try {
        const fullSrc = path.join(unityMatDir, file);
        const yaml = fs.readFileSync(fullSrc, 'utf8');
        const matName = path.basename(file, '.mat');
        const mtlJson = convertUnityMatToCocosMtl(yaml, { materialName: matName, ...options });
        const fullDst = path.join(cocosMtlDir, `${matName}.mtl`);
        fs.writeFileSync(fullDst, mtlJson, 'utf8');
        converted++;
      } catch (err) {
        failed++;
      }
    }
  }

  return { converted, failed };
}

/**
 * Convert one Unity `.mat` file on disk to a Cocos `.mtl`.
 *
 * The CLI's convert-mat command referenced this by name but it was never
 * implemented, so `convert-mat` threw "convertMatFile is not a function" for
 * every input -- the material half of the pipeline had never run.
 *
 * @param {string} srcPath  Unity .mat path
 * @param {string} outPath  Cocos .mtl path to write
 * @param {{effectUuid?: string, effectAsset?: string, effectPath?: string,
 *          techIdx?: number, dryRun?: boolean}} [options]
 * @returns {{outPath: string, materialName: string, propertyCount: number,
 *            effectUuid: string, warnings: string[]}}
 */
function convertMatFile(srcPath, outPath, options = {}) {
  const fs = require('fs');
  const path = require('path');

  if (!fs.existsSync(srcPath)) {
    throw new Error(`Unity material not found: ${srcPath}`);
  }

  const yamlContent = fs.readFileSync(srcPath, 'utf8');
  const materialName = options.materialName || path.basename(srcPath, path.extname(srcPath));
  const effectUuid = options.effectUuid || options.effectAsset || '';
  const effectText = options.effectPath && fs.existsSync(options.effectPath)
    ? fs.readFileSync(options.effectPath, 'utf8')
    : '';
  const effectProperties = extractCocosEffectPropertyMetadata(effectText);
  const linearColorProperties = new Set(
    [...effectProperties.entries()]
      .filter(([, metadata]) => metadata.linear)
      .map(([name]) => name),
  );

  // convertUnityMatToCocosMtl returns serialized JSON, not an object.
  const mtlJson = convertUnityMatToCocosMtl(yamlContent, {
    ...options,
    materialName,
    effectUuid,
    linearColorProperties,
  });
  const mtl = JSON.parse(mtlJson);

  const warnings = [];

  // A Unity .mat carries every property of its shader *and* every property of
  // whatever shader it was previously assigned -- URP Lit alone contributes
  // ~50 (workflowMode, srcBlend, queueControl, ...). Writing them all makes
  // Cocos log an unknown-property warning per entry at material load. When the
  // target effect is known, keep only what it actually declares.
  if (effectText) {
    if (effectProperties.size) {
      const declared = new Set(effectProperties.keys());
      const props = mtl._props[0] || {};
      const dropped = [];
      for (const key of Object.keys(props)) {
        if (!declared.has(key)) { dropped.push(key); delete props[key]; }
      }
      if (dropped.length) {
        warnings.push(`Dropped ${dropped.length} property/properties not declared by the target effect (e.g. ${dropped.slice(0, 4).join(', ')}).`);
      }
    }
  }

  if (!effectUuid) {
    // Cocos resolves the effect by UUID. Without one the material loads but
    // renders with the default effect, which looks like the port silently
    // failed; surface it rather than writing a quietly useless file.
    warnings.push(
      `No --effect-uuid given: '${path.basename(outPath)}' has an empty _effectAsset and will fall back to the builtin effect. ` +
      `Pass the UUID from the generated .effect.meta.`
    );
  }

  if (!options.dryRun) {
    const outDir = path.dirname(outPath);
    if (outDir && !fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(mtl, null, 2), 'utf8');
  }

  const props = (mtl._props && mtl._props[0]) || {};
  return {
    outPath,
    materialName,
    propertyCount: Object.keys(props).length,
    effectUuid,
    warnings,
  };
}

module.exports = {
  parseUnityMatYaml,
  convertUnityMatToCocosMtl,
  convertMatFile,
  convertMaterialDirectory,
  extractCocosEffectPropertyMetadata,
  performTextureAssetDiagnostics,
  generateMaterialAssetManifest,
};
