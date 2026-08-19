'use strict';

/**
 * Unity Material (.mat) YAML -> Cocos Creator Material (.mtl) JSON Converter
 * with Asset Manifest & Texture Diagnostics
 *
 * Capabilities:
 * - Parses Unity YAML material files (m_Shader, m_SavedProperties: m_TexEnvs, m_Floats, m_Colors, m_Ints, m_ShaderKeywords)
 * - Remaps property names and ST (Scale/Offset) vectors to Cocos conventions
 * - Converts Color representations (0..1 floats -> 0..255 uint8)
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

/**
 * Converts Unity .mat to Cocos .mtl JSON string
 */
function convertUnityMatToCocosMtl(yamlContent, options = {}) {
  const { properties, keywords } = parseUnityMatYaml(yamlContent);
  const materialName = options.materialName || 'ConvertedMaterial';
  const effectUuid = options.effectUuid || options.effectAsset || '';

  const defines = {};
  for (const kw of keywords) {
    defines[kw] = true;
  }

  const propsObj = {};

  // Convert Colors
  for (const [uName, val] of Object.entries(properties.colors)) {
    const cName = toCocosPropertyName(uName);
    propsObj[cName] = {
      __type__: 'cc.Color',
      r: Math.round((val[0] || 0) * 255),
      g: Math.round((val[1] || 0) * 255),
      b: Math.round((val[2] || 0) * 255),
      a: Math.round((val[3] || 1) * 255),
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

module.exports = {
  parseUnityMatYaml,
  convertUnityMatToCocosMtl,
  convertMaterialDirectory,
  performTextureAssetDiagnostics,
  generateMaterialAssetManifest,
};
