'use strict';

const fs = require('fs');
const path = require('path');
const {
  BUILTIN_STANDARD_EFFECT_UUID,
  BUILTIN_UNLIT_EFFECT_UUID,
  BUILTIN_PARTICLE_EFFECT_UUID,
  BUILTIN_STANDARD_TRANSPARENT_TECHNIQUE_INDEX,
  BUILTIN_DEFAULT_MESH_MATERIAL_UUID,
  UNITY_MATERIAL_BASE_TEXTURE_KEYS,
  UNITY_MATERIAL_NORMAL_TEXTURE_KEYS,
  UNITY_MATERIAL_OCCLUSION_TEXTURE_KEYS,
  UNITY_MATERIAL_EMISSIVE_TEXTURE_KEYS,
} = require('./constants');
const {
  ensureDir,
  readJsonIfExists,
  toPosix,
  unityColorToCocos,
  cocosUuid,
} = require('./core-utils');

const UNITY_BUILTIN_SHADER_GUID = '0000000000000000f000000000000000';
const COCOS_PARTICLE_TECHNIQUE_ADD = 0;
const COCOS_PARTICLE_TECHNIQUE_ALPHA_BLEND = 1;
const COCOS_PARTICLE_TECHNIQUE_ADD_MULTIPLY = 2;
const COCOS_PARTICLE_TECHNIQUE_ADD_SMOOTH = 3;
const COCOS_PARTICLE_TECHNIQUE_PREMULTIPLY_BLEND = 4;
const COCOS_PARTICLE_DEFAULT_TINT = 128 / 255;
const COCOS_PARTICLE_DEFAULT_TINT_COLOR = [
  COCOS_PARTICLE_DEFAULT_TINT,
  COCOS_PARTICLE_DEFAULT_TINT,
  COCOS_PARTICLE_DEFAULT_TINT,
  COCOS_PARTICLE_DEFAULT_TINT,
];
const UNITY_PARTICLE_MATERIAL_TEXTURE_KEYS = [
  '_MainTex',
  '_BaseMap',
  '_NormalMap',
  '_BumpMap',
  '_DistortionTex',
  '_DistortionMap',
  '_NoiseTex',
  '_MaskTex',
];
const UNITY_BUILTIN_PARTICLE_SHADER_BY_FILE_ID = {
  // Unity builtin Mobile/Particles shaders are stored as builtin shader file IDs in .mat YAML.
  200: { name: 'Legacy Shaders/Particles/Additive', technique: COCOS_PARTICLE_TECHNIQUE_ADD },
  201: { name: 'Legacy Shaders/Particles/Additive Multiply', technique: COCOS_PARTICLE_TECHNIQUE_ADD_MULTIPLY },
  202: { name: 'Legacy Shaders/Particles/Additive Smooth', technique: COCOS_PARTICLE_TECHNIQUE_ADD_SMOOTH },
  203: { name: 'Legacy Shaders/Particles/Alpha Blended', technique: COCOS_PARTICLE_TECHNIQUE_ALPHA_BLEND },
  205: { name: 'Legacy Shaders/Particles/Multiply', technique: COCOS_PARTICLE_TECHNIQUE_ADD_MULTIPLY },
  206: { name: 'Legacy Shaders/Particles/Multiply Double', technique: COCOS_PARTICLE_TECHNIQUE_ADD_MULTIPLY },
  207: { name: 'Legacy Shaders/Particles/Alpha Premultiply', technique: COCOS_PARTICLE_TECHNIQUE_PREMULTIPLY_BLEND },
  209: { name: 'Legacy Shaders/Particles/Anim Alpha Blended', technique: COCOS_PARTICLE_TECHNIQUE_ALPHA_BLEND },
  10720: { name: 'Mobile/Particles/Additive', technique: COCOS_PARTICLE_TECHNIQUE_ADD },
  10721: { name: 'Mobile/Particles/Alpha Blended', technique: COCOS_PARTICLE_TECHNIQUE_ALPHA_BLEND },
  10722: { name: 'Mobile/Particles/VertexLit Blended', technique: COCOS_PARTICLE_TECHNIQUE_ALPHA_BLEND },
  10723: { name: 'Mobile/Particles/Multiply', technique: COCOS_PARTICLE_TECHNIQUE_ADD_MULTIPLY },
};

module.exports = function createMaterialPorter(deps) {
  const {
    parseUnityScalar,
    parseUnityYaml,
    getField,
    unityRefGuid,
    importedUnityAssetPath,
    resolveCurrentStandaloneMaterialUuid,
    firstSubMetaRecord,
    copyUnityAssetToCocos,
    ensureDirectoryMetas,
    ensureMaterialAssetMeta,
    libraryJsonPathForUuid,
  } = deps;

  function blockEntryIndent(lines) {
    let minIndent = Infinity;
    for (const line of lines) {
      if (!String(line || '').trim()) continue;
      const indent = String(line).match(/^\s*/) ? String(line).match(/^\s*/)[0].length : 0;
      if (indent < minIndent) minIndent = indent;
    }
    return Number.isFinite(minIndent) ? minIndent : -1;
  }

  function parseUnitySerializedScalarMap(doc, key) {
    const block = deps.getIndentedBlock(doc, key);
    const entryIndent = blockEntryIndent(block);
    const result = {};
    if (entryIndent < 0) return result;

    for (const rawLine of block) {
      const line = String(rawLine || '');
      const indent = line.match(/^\s*/)?.[0]?.length || 0;
      if (indent !== entryIndent) continue;
      const trimmed = line.trim();
      const match = /^-\s*([^:]+)\s*:\s*(.*)$/.exec(trimmed) || /^([^:]+)\s*:\s*(.*)$/.exec(trimmed);
      if (!match) continue;
      result[match[1].trim()] = parseUnityScalar(match[2]);
    }

    return result;
  }

  function parseUnityTextureEnvMap(doc) {
    const block = deps.getIndentedBlock(doc, 'm_TexEnvs');
    const entryIndent = blockEntryIndent(block);
    const result = {};
    if (entryIndent < 0) return result;

    for (let i = 0; i < block.length; i += 1) {
      const line = String(block[i] || '');
      const indent = line.match(/^\s*/)?.[0]?.length || 0;
      if (indent !== entryIndent) continue;

      const trimmed = line.trim();
      const match = /^-\s*([^:]+)\s*:\s*(.*)$/.exec(trimmed) || /^([^:]+)\s*:\s*(.*)$/.exec(trimmed);
      if (!match) continue;

      const entryLines = [];
      for (let j = i + 1; j < block.length; j += 1) {
        const nextLine = String(block[j] || '');
        const nextIndent = nextLine.match(/^\s*/)?.[0]?.length || 0;
        const nextTrimmed = nextLine.trim();
        if (nextIndent === entryIndent && /^(-\s+)?[^:]+\s*:/.test(nextTrimmed)) break;
        entryLines.push(nextLine);
        i = j;
      }

      const entryDoc = { lines: entryLines };
      result[match[1].trim()] = {
        m_Texture: getField(entryDoc, 'm_Texture', null),
        m_Scale: getField(entryDoc, 'm_Scale', { x: 1, y: 1 }),
        m_Offset: getField(entryDoc, 'm_Offset', { x: 0, y: 0 }),
      };
    }

    return result;
  }

  function readUnityMaterialDoc(assetFile) {
    if (!assetFile || !fs.existsSync(assetFile)) return null;
    return parseUnityYaml(assetFile).find((doc) => doc.classId === 21 || doc.typeName === 'Material') || null;
  }

  function readUnityShaderName(shaderAsset) {
    if (!shaderAsset?.path || !fs.existsSync(shaderAsset.path)) return '';
    const source = fs.readFileSync(shaderAsset.path, 'utf8');
    return (/Shader\s+"([^"]+)"/.exec(source) || [])[1] || shaderAsset.stem || '';
  }

  function firstDefinedMaterialValue(source, keys, fallback = undefined) {
    for (const key of keys || []) {
      if (source && source[key] != null) return source[key];
    }
    return fallback;
  }

  function getUnityMaterialKeywords(materialDoc) {
    const block = deps.getIndentedBlock(materialDoc, 'm_ValidKeywords');
    const keywords = new Set();
    for (const line of block) {
      const match = /^\s*-\s+(.+?)\s*$/.exec(String(line || ''));
      if (match) keywords.add(match[1]);
    }
    return keywords;
  }

  function clamp01(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(1, number));
  }

  function hasVisibleUnityColor(value) {
    const colorValue = value || {};
    return Number(colorValue.r || 0) > 0 || Number(colorValue.g || 0) > 0 || Number(colorValue.b || 0) > 0;
  }

  function isNeutralUnityParticleTintColor(value) {
    const colorValue = value || {};
    const epsilon = 1e-6;
    return Math.abs(Number(colorValue.r ?? 1) - 1) <= epsilon
      && Math.abs(Number(colorValue.g ?? 1) - 1) <= epsilon
      && Math.abs(Number(colorValue.b ?? 1) - 1) <= epsilon
      && Math.abs(Number(colorValue.a ?? 1) - 1) <= epsilon;
  }

  function particleTechniqueFromShaderName(shaderName) {
    const name = String(shaderName || '').toLowerCase();
    if (!name) return COCOS_PARTICLE_TECHNIQUE_ADD;
    if (/(pre[- ]?multiply|premultiplied|\bpma\b)/.test(name)) return COCOS_PARTICLE_TECHNIQUE_PREMULTIPLY_BLEND;
    if (/add(?:itive)?[ /_-]*smooth|soft[ /_-]*add|add[ /_-]*soft/.test(name)) return COCOS_PARTICLE_TECHNIQUE_ADD_SMOOTH;
    if (/multiply|multiplied/.test(name)) return COCOS_PARTICLE_TECHNIQUE_ADD_MULTIPLY;
    if (/alpha[ /_-]*blend|alpha[ /_-]*blended|transparent/.test(name)) return COCOS_PARTICLE_TECHNIQUE_ALPHA_BLEND;
    return COCOS_PARTICLE_TECHNIQUE_ADD;
  }

  function resolveUnityParticleMaterialTechnique(materialDoc, unityDb) {
    const keywords = getUnityMaterialKeywords(materialDoc);
    if (keywords.has('_ALPHAPREMULTIPLY_ON')) return COCOS_PARTICLE_TECHNIQUE_PREMULTIPLY_BLEND;
    if (keywords.has('_ALPHAMODULATE_ON')) return COCOS_PARTICLE_TECHNIQUE_ADD_MULTIPLY;
    if (keywords.has('_ALPHABLEND_ON') || keywords.has('_ALPHATEST_ON')) return COCOS_PARTICLE_TECHNIQUE_ALPHA_BLEND;

    const shaderRef = getField(materialDoc, 'm_Shader', null);
    const shaderGuid = unityRefGuid(shaderRef);
    const shaderFileId = String(shaderRef?.fileID || '');
    if (shaderGuid === UNITY_BUILTIN_SHADER_GUID && UNITY_BUILTIN_PARTICLE_SHADER_BY_FILE_ID[shaderFileId]) {
      return UNITY_BUILTIN_PARTICLE_SHADER_BY_FILE_ID[shaderFileId].technique;
    }

    const shaderName = shaderGuid === UNITY_BUILTIN_SHADER_GUID
      ? UNITY_BUILTIN_PARTICLE_SHADER_BY_FILE_ID[shaderFileId]?.name || ''
      : readUnityShaderName(unityDb?.get(shaderGuid));
    return particleTechniqueFromShaderName(shaderName);
  }

  function convertedUnityMaterialAssetPath(materialAsset, options) {
    const importedPath = importedUnityAssetPath(materialAsset, options);
    return importedPath ? importedPath.replace(/\.mat$/i, '.mtl') : '';
  }

  function convertedUnityParticleMaterialAssetPath(materialAsset, options) {
    const importedPath = importedUnityAssetPath(materialAsset, options);
    return importedPath ? importedPath.replace(/\.mat$/i, '.mtl') : '';
  }

  function convertedUnitySpriteRendererMaterialAssetPath(materialAsset, options) {
    const importedPath = importedUnityAssetPath(materialAsset, options);
    return importedPath ? importedPath.replace(/\.mat$/i, '.sprite.mtl') : '';
  }

  function legacyUnityParticleMaterialAssetPath(materialAsset, options) {
    const importedPath = importedUnityAssetPath(materialAsset, options);
    return importedPath ? importedPath.replace(/\.mat$/i, '.particle.mtl') : '';
  }

  function resolveStandaloneMaterialAssetUuid(assetFile, options) {
    if (!assetFile) return '';
    const resolved = resolveCurrentStandaloneMaterialUuid(assetFile, options);
    if (resolved) return resolved;
    const meta = readJsonIfExists(`${assetFile}.meta`);
    return meta?.importer === 'material' && meta?.uuid ? meta.uuid : '';
  }

  function resolveCurrentTextureUuid(assetFile) {
    if (!assetFile) return '';
    const meta = readJsonIfExists(`${assetFile}.meta`);
    if (!meta?.uuid) return '';
    return firstSubMetaRecord(meta.uuid, meta.subMetas, 'texture')?.uuid || '';
  }

  function resolveUnityTextureUuid(textureAsset, options, reporter, importConfig = {}) {
    if (!textureAsset) return '';

    const importedDest = importedUnityAssetPath(textureAsset, options);
    const copyConfig = { deferNeedsImportReport: true, imageType: 'texture', ...importConfig };
    const requestedImageType = String(copyConfig.imageType || '').toLowerCase();
    const existingMeta = importedDest && fs.existsSync(importedDest)
      ? readJsonIfExists(`${importedDest}.meta`)
      : null;
    const needsMetaRefresh = Boolean(importConfig.particleTexture)
      || Boolean(requestedImageType && existingMeta?.userData?.type !== requestedImageType);

    if (importedDest && fs.existsSync(importedDest) && !needsMetaRefresh) {
      const textureUuid = resolveCurrentTextureUuid(importedDest);
      if (textureUuid) return textureUuid;
    }

    const copiedDest = copyUnityAssetToCocos(textureAsset, options, reporter, 'image', 'low', copyConfig);
    return resolveCurrentTextureUuid(copiedDest || importedDest);
  }

  function resolveUnityMaterialTextureUuid(texEnvs, keys, unityDb, options, reporter, importConfig = {}) {
    const env = firstDefinedMaterialValue(texEnvs, keys, null);
    const textureGuid = unityRefGuid(env?.m_Texture);
    return textureGuid ? resolveUnityTextureUuid(unityDb.get(textureGuid), options, reporter, importConfig) : '';
  }

  function syncImportedMaterialLibraryCache(materialData, meta, options) {
    if (!meta?.uuid || !materialData || options.dryRun) return false;
    const libraryFile = libraryJsonPathForUuid(options, meta.uuid);
    ensureDir(path.dirname(libraryFile));
    fs.writeFileSync(libraryFile, `${JSON.stringify(materialData, null, 2)}\n`, 'utf8');
    return true;
  }

  function convertUnityMaterialToCocos(materialAsset, options, unityDb, reporter) {
    if (!materialAsset?.path || !fs.existsSync(materialAsset.path)) return '';

    const materialDoc = readUnityMaterialDoc(materialAsset.path);
    if (!materialDoc) {
      reporter.medium('MATERIAL_CONVERSION_FAILED', materialAsset.relativePath, '', 'Unity material could not be parsed');
      return '';
    }

    const convertedDest = convertedUnityMaterialAssetPath(materialAsset, options);
    if (!convertedDest) return '';

    const shaderRef = getField(materialDoc, 'm_Shader', null);
    const shaderGuid = unityRefGuid(shaderRef);
    if (shaderGuid && shaderGuid !== UNITY_BUILTIN_SHADER_GUID) {
      const shaderAsset = unityDb?.get(shaderGuid);
      const shaderName = readUnityShaderName(shaderAsset) || shaderAsset?.relativePath || shaderGuid;
      reporter.high(
        'CUSTOM_SHADER_NOT_PORTED',
        materialAsset.relativePath,
        String(getField(materialDoc, 'm_Name', materialAsset.stem) || materialAsset.stem),
        `Custom shader "${shaderName}" has not been ported; material approximated with builtin-standard`,
      );
    }

    const floats = parseUnitySerializedScalarMap(materialDoc, 'm_Floats');
    const colors = parseUnitySerializedScalarMap(materialDoc, 'm_Colors');
    const texEnvs = parseUnityTextureEnvMap(materialDoc);

    const mainColor = firstDefinedMaterialValue(colors, ['_BaseColor', '_Color'], { r: 1, g: 1, b: 1, a: 1 });
    const emissionColor = firstDefinedMaterialValue(colors, ['_EmissionColor', '_EmissiveColor'], { r: 0, g: 0, b: 0, a: 1 });
    const customRenderQueue = Number(getField(materialDoc, 'm_CustomRenderQueue', -1) || -1);
    const transparent = Number(firstDefinedMaterialValue(floats, ['_Surface', '_Mode', '_RenderingMode'], 0) || 0) > 0
      || customRenderQueue >= 3000
      || clamp01(mainColor.a, 1) < 1;
    const alphaClip = Number(firstDefinedMaterialValue(floats, ['_AlphaClip', '_UseAlphaTest'], 0) || 0) > 0;
    const cutoff = clamp01(firstDefinedMaterialValue(floats, ['_Cutoff'], 0.5), 0.5);
    const smoothness = clamp01(firstDefinedMaterialValue(floats, ['_Smoothness', '_Glossiness'], 0.5), 0.5);
    const roughness = clamp01(firstDefinedMaterialValue(floats, ['_SpecularRoughness'], 1 - smoothness), 1 - smoothness);
    const metallic = clamp01(firstDefinedMaterialValue(floats, ['_Metallic'], 0), 0);
    const doubleSided = Number(firstDefinedMaterialValue(floats, ['_Cull'], 2) || 2) === 0;
    const emissionEnabled = Number(firstDefinedMaterialValue(floats, ['_UseEmission'], 0) || 0) > 0;

    const mainTextureUuid = resolveUnityMaterialTextureUuid(texEnvs, UNITY_MATERIAL_BASE_TEXTURE_KEYS, unityDb, options, reporter);
    const normalTextureUuid = resolveUnityMaterialTextureUuid(texEnvs, UNITY_MATERIAL_NORMAL_TEXTURE_KEYS, unityDb, options, reporter);
    const occlusionTextureUuid = resolveUnityMaterialTextureUuid(texEnvs, UNITY_MATERIAL_OCCLUSION_TEXTURE_KEYS, unityDb, options, reporter);
    const emissiveTextureUuid = resolveUnityMaterialTextureUuid(texEnvs, UNITY_MATERIAL_EMISSIVE_TEXTURE_KEYS, unityDb, options, reporter);

    const defines = {};
    if (alphaClip) defines.USE_ALPHA_TEST = true;
    if (mainTextureUuid) defines.USE_ALBEDO_MAP = true;
    if (normalTextureUuid) defines.USE_NORMAL_MAP = true;
    if (occlusionTextureUuid) defines.USE_OCCLUSION_MAP = true;
    if (emissiveTextureUuid) defines.USE_EMISSIVE_MAP = true;

    const props = {
      mainColor: unityColorToCocos(mainColor),
      roughness,
      metallic,
    };
    if (mainTextureUuid) props.mainTexture = { __uuid__: mainTextureUuid };
    if (normalTextureUuid) props.normalMap = { __uuid__: normalTextureUuid };
    if (occlusionTextureUuid) {
      props.occlusionMap = { __uuid__: occlusionTextureUuid };
      props.occlusion = clamp01(firstDefinedMaterialValue(floats, ['_OcclusionStrength'], 1), 1);
    }
    if (emissionEnabled || emissiveTextureUuid || hasVisibleUnityColor(emissionColor)) {
      props.emissive = unityColorToCocos(emissionColor);
    }
    if (emissiveTextureUuid) props.emissiveMap = { __uuid__: emissiveTextureUuid };
    if (alphaClip) props.alphaThreshold = cutoff;

    const states = [];
    if (transparent || doubleSided) {
      const state = {
        rasterizerState: {},
        blendState: { targets: [{}] },
        depthStencilState: {},
      };
      if (doubleSided) state.rasterizerState.cullMode = 0;
      if (transparent) {
        state.blendState.targets = [{ blend: true, blendSrc: 2, blendDst: 4, blendDstAlpha: 4 }];
        state.depthStencilState.depthWrite = false;
      }
      states.push(state);
    }

    const materialData = {
      __type__: 'cc.Material',
      _name: String(getField(materialDoc, 'm_Name', materialAsset.stem) || materialAsset.stem),
      _objFlags: 0,
      __editorExtras__: {},
      _native: '',
      _effectAsset: cocosUuid(BUILTIN_STANDARD_EFFECT_UUID, 'cc.EffectAsset'),
      _techIdx: transparent ? BUILTIN_STANDARD_TRANSPARENT_TECHNIQUE_INDEX : 0,
      _defines: [defines],
      _states: states,
      _props: [props],
    };

    if (options.dryRun) return fs.existsSync(convertedDest) ? convertedDest : '';

    ensureDir(path.dirname(convertedDest));
    ensureDirectoryMetas(path.dirname(convertedDest), path.join(options.cocosRoot, 'assets'));
    fs.writeFileSync(convertedDest, `${JSON.stringify(materialData, null, 2)}\n`, 'utf8');
    const meta = ensureMaterialAssetMeta(convertedDest, options);
    syncImportedMaterialLibraryCache(materialData, meta, options);
    return convertedDest;
  }

  function materialColor(value, fallback = [COCOS_PARTICLE_DEFAULT_TINT, COCOS_PARTICLE_DEFAULT_TINT, COCOS_PARTICLE_DEFAULT_TINT, COCOS_PARTICLE_DEFAULT_TINT]) {
    return {
      __type__: 'cc.Color',
      r: Math.round(clamp01(value?.r, fallback[0]) * 255),
      g: Math.round(clamp01(value?.g, fallback[1]) * 255),
      b: Math.round(clamp01(value?.b, fallback[2]) * 255),
      a: Math.round(clamp01(value?.a, fallback[3]) * 255),
    };
  }

  function isDefaultParticleTilingOffset(scale, offset) {
    return Number(scale?.x ?? 1) === 1 &&
      Number(scale?.y ?? 1) === 1 &&
      Number(offset?.x ?? 0) === 0 &&
      Number(offset?.y ?? 0) === 0;
  }

  function hasUnityMaterialColor(colors, keys) {
    return keys.some((key) => Object.prototype.hasOwnProperty.call(colors || {}, key));
  }

  function emptyParticlePassState() {
    return {
      rasterizerState: {},
      depthStencilState: {},
      blendState: {
        targets: [{}],
      },
    };
  }

  function particleTechniqueUsesTintColor(techniqueIndex) {
    return techniqueIndex === COCOS_PARTICLE_TECHNIQUE_ADD
      || techniqueIndex === COCOS_PARTICLE_TECHNIQUE_ALPHA_BLEND
      || techniqueIndex === COCOS_PARTICLE_TECHNIQUE_ADD_MULTIPLY;
  }

  function convertUnityParticleMaterialToCocos(materialAsset, options, unityDb, reporter) {
    if (!materialAsset?.path || !fs.existsSync(materialAsset.path)) return null;

    const materialDoc = readUnityMaterialDoc(materialAsset.path);
    if (!materialDoc) {
      reporter.medium('PARTICLE_MATERIAL_CONVERSION_FAILED', materialAsset.relativePath, '', 'Unity particle material could not be parsed');
      return null;
    }

    const convertedDest = convertedUnityParticleMaterialAssetPath(materialAsset, options);
    if (!convertedDest) return null;

    const particleShaderRef = getField(materialDoc, 'm_Shader', null);
    const particleShaderGuid = unityRefGuid(particleShaderRef);
    if (particleShaderGuid && particleShaderGuid !== UNITY_BUILTIN_SHADER_GUID) {
      const particleShaderAsset = unityDb?.get(particleShaderGuid);
      const particleShaderName = readUnityShaderName(particleShaderAsset) || particleShaderAsset?.relativePath || particleShaderGuid;
      reporter.high(
        'CUSTOM_SHADER_NOT_PORTED',
        materialAsset.relativePath,
        String(getField(materialDoc, 'm_Name', materialAsset.stem) || materialAsset.stem),
        `Custom shader "${particleShaderName}" has not been ported; material approximated with builtin particle effect`,
      );
    }

    const colors = parseUnitySerializedScalarMap(materialDoc, 'm_Colors');
    const texEnvs = parseUnityTextureEnvMap(materialDoc);
    const env = firstDefinedMaterialValue(texEnvs, UNITY_PARTICLE_MATERIAL_TEXTURE_KEYS, null);
    const mainTextureUuid = resolveUnityMaterialTextureUuid(
      texEnvs,
      UNITY_PARTICLE_MATERIAL_TEXTURE_KEYS,
      unityDb,
      options,
      reporter,
      { particleTexture: true },
    );
    const mainColor = firstDefinedMaterialValue(colors, ['_TintColor', '_Color', '_BaseColor'], {
      r: COCOS_PARTICLE_DEFAULT_TINT,
      g: COCOS_PARTICLE_DEFAULT_TINT,
      b: COCOS_PARTICLE_DEFAULT_TINT,
      a: COCOS_PARTICLE_DEFAULT_TINT,
    });
    const scale = env?.m_Scale || { x: 1, y: 1 };
    const offset = env?.m_Offset || { x: 0, y: 0 };
    const techniqueIndex = resolveUnityParticleMaterialTechnique(materialDoc, unityDb);

    const props = {};
    if (!isDefaultParticleTilingOffset(scale, offset)) {
      props.mainTiling_Offset = [
        Number(scale.x ?? 1),
        Number(scale.y ?? 1),
        Number(offset.x ?? 0),
        Number(offset.y ?? 0),
      ];
    }
    if (mainTextureUuid) props.mainTexture = cocosUuid(mainTextureUuid, 'cc.Texture2D');
    const hasExplicitTintColor = hasUnityMaterialColor(colors, ['_TintColor', '_Color', '_BaseColor']);
    const hasMeaningfulExplicitTintColor = hasExplicitTintColor && !isNeutralUnityParticleTintColor(mainColor);
    if (techniqueIndex === COCOS_PARTICLE_TECHNIQUE_ADD) {
      props.tintColor = materialColor(null, COCOS_PARTICLE_DEFAULT_TINT_COLOR);
    } else if (particleTechniqueUsesTintColor(techniqueIndex) && hasMeaningfulExplicitTintColor) {
      props.tintColor = materialColor(mainColor);
    }

    const materialData = {
      __type__: 'cc.Material',
      _name: String(getField(materialDoc, 'm_Name', materialAsset.stem) || materialAsset.stem),
      _objFlags: 0,
      __editorExtras__: {},
      _native: '',
      _effectAsset: cocosUuid(BUILTIN_PARTICLE_EFFECT_UUID, 'cc.EffectAsset'),
      _techIdx: techniqueIndex,
      _defines: [{}, {}],
      _states: [emptyParticlePassState(), emptyParticlePassState()],
      _props: [props, {}],
    };

    if (options.dryRun) {
      return {
        file: fs.existsSync(convertedDest) ? convertedDest : '',
        textureUuid: mainTextureUuid,
      };
    }

    ensureDir(path.dirname(convertedDest));
    ensureDirectoryMetas(path.dirname(convertedDest), path.join(options.cocosRoot, 'assets'));
    fs.writeFileSync(convertedDest, `${JSON.stringify(materialData, null, 2)}\n`, 'utf8');
    const meta = ensureMaterialAssetMeta(convertedDest, options);
    syncImportedMaterialLibraryCache(materialData, meta, options);

    const legacyDest = legacyUnityParticleMaterialAssetPath(materialAsset, options);
    if (legacyDest && legacyDest !== convertedDest && fs.existsSync(legacyDest)) {
      const legacyData = readJsonIfExists(legacyDest);
      if (legacyData?.__type__ === 'cc.Material' && legacyData?._effectAsset?.__uuid__ === BUILTIN_PARTICLE_EFFECT_UUID) {
        fs.unlinkSync(legacyDest);
        if (fs.existsSync(`${legacyDest}.meta`)) fs.unlinkSync(`${legacyDest}.meta`);
      }
    }

    return {
      file: convertedDest,
      textureUuid: mainTextureUuid,
    };
  }

  function resolveUnityParticleMaterial(materialAsset, options, unityDb, reporter, gameObjectName) {
    if (!materialAsset) return null;

    const converted = convertUnityParticleMaterialToCocos(materialAsset, options, unityDb, reporter);
    const convertedDest = converted?.file || convertedUnityParticleMaterialAssetPath(materialAsset, options);
    let materialUuid = resolveStandaloneMaterialAssetUuid(convertedDest, options);

    if (!materialUuid && convertedDest && fs.existsSync(convertedDest)) {
      const meta = readJsonIfExists(`${convertedDest}.meta`);
      materialUuid = meta?.importer === 'material' ? meta.uuid || '' : '';
    }

    if (!materialUuid) {
      reporter.low(
        'PARTICLE_MATERIAL_DEFAULT_FALLBACK_USED',
        materialAsset.relativePath,
        gameObjectName,
        'Unity particle material could not be converted; keeping the template particle material',
      );
      return null;
    }

    return {
      materialUuid,
      textureUuid: converted?.textureUuid || '',
      file: convertedDest,
    };
  }

  function convertUnitySpriteRendererMaterialToCocos(materialAsset, options, unityDb, reporter) {
    if (!materialAsset?.path || !fs.existsSync(materialAsset.path)) return '';

    const materialDoc = readUnityMaterialDoc(materialAsset.path);
    if (!materialDoc) {
      reporter.medium('SPRITE_RENDERER_MATERIAL_CONVERSION_FAILED', materialAsset.relativePath, '', 'Unity SpriteRenderer material could not be parsed');
      return '';
    }

    const convertedDest = convertedUnitySpriteRendererMaterialAssetPath(materialAsset, options);
    if (!convertedDest) return '';

    const colors = parseUnitySerializedScalarMap(materialDoc, 'm_Colors');
    const texEnvs = parseUnityTextureEnvMap(materialDoc);
    const mainColor = firstDefinedMaterialValue(colors, ['_BaseColor', '_Color', '_TintColor'], { r: 1, g: 1, b: 1, a: 1 });
    const mainTextureUuid = resolveUnityMaterialTextureUuid(texEnvs, UNITY_MATERIAL_BASE_TEXTURE_KEYS, unityDb, options, reporter);
    const props = {
      mainColor: unityColorToCocos(mainColor),
      colorScale: [1, 1, 1],
      alphaThreshold: 0.5,
    };
    if (mainTextureUuid) props.mainTexture = cocosUuid(mainTextureUuid, 'cc.Texture2D');

    const materialData = {
      __type__: 'cc.Material',
      _name: `${String(getField(materialDoc, 'm_Name', materialAsset.stem) || materialAsset.stem)}_sprite`,
      _objFlags: 0,
      __editorExtras__: {},
      _native: '',
      _effectAsset: cocosUuid(BUILTIN_UNLIT_EFFECT_UUID, 'cc.EffectAsset'),
      _techIdx: 3,
      _defines: [{ USE_TEXTURE: Boolean(mainTextureUuid) }, {}],
      _states: [{}, {}],
      _props: [props, {}],
    };

    if (options.dryRun) return fs.existsSync(convertedDest) ? convertedDest : '';

    ensureDir(path.dirname(convertedDest));
    ensureDirectoryMetas(path.dirname(convertedDest), path.join(options.cocosRoot, 'assets'));
    fs.writeFileSync(convertedDest, `${JSON.stringify(materialData, null, 2)}\n`, 'utf8');
    const meta = ensureMaterialAssetMeta(convertedDest, options);
    syncImportedMaterialLibraryCache(materialData, meta, options);
    return convertedDest;
  }

  function resolveUnitySpriteRendererMaterialUuid(materialAsset, options, unityDb, cocosDb, reporter, gameObjectName) {
    if (!materialAsset) return '';

    const convertedDest = convertUnitySpriteRendererMaterialToCocos(materialAsset, options, unityDb, reporter);
    let resolvedMaterial = resolveStandaloneMaterialAssetUuid(convertedDest, options);
    if (resolvedMaterial) return resolvedMaterial;

    resolvedMaterial = cocosDb.resolveMaterialByStem(`${materialAsset.stem}_sprite`) || '';
    if (resolvedMaterial) return resolvedMaterial;

    reporter.low(
      'SPRITE_RENDERER_MATERIAL_DEFAULT_FALLBACK_USED',
      materialAsset.relativePath,
      gameObjectName,
      'Unity SpriteRenderer material was approximated using Cocos default SpriteRenderer material',
      convertedDest && fs.existsSync(convertedDest)
        ? toPosix(path.relative(options.cocosRoot, convertedDest))
        : '',
    );
    return '';
  }

  function resolveUnityMaterialUuid(materialAsset, options, unityDb, cocosDb, reporter, gameObjectName) {
    if (!materialAsset) return '';

    const convertedDest = convertUnityMaterialToCocos(materialAsset, options, unityDb, reporter);
    let resolvedMaterial = resolveStandaloneMaterialAssetUuid(convertedDest, options);
    if (!resolvedMaterial) resolvedMaterial = cocosDb.resolveMaterialByStem(materialAsset.stem);

    const importedDest = importedUnityAssetPath(materialAsset, options);
    if (!resolvedMaterial) {
      resolvedMaterial = importedDest && fs.existsSync(importedDest)
        ? resolveCurrentStandaloneMaterialUuid(importedDest, options)
        : '';
    }

    if (!resolvedMaterial) {
      const preparedDest = convertUnityMaterialToCocos(materialAsset, options, unityDb, reporter);
      resolvedMaterial = resolveStandaloneMaterialAssetUuid(preparedDest, options);
    }

    if (resolvedMaterial) return resolvedMaterial;

    reporter.low(
      'MATERIAL_DEFAULT_FALLBACK_USED',
      materialAsset.relativePath,
      gameObjectName,
      'Unity material was approximated using Cocos default material',
      convertedDest && fs.existsSync(convertedDest)
        ? toPosix(path.relative(options.cocosRoot, convertedDest))
        : BUILTIN_DEFAULT_MESH_MATERIAL_UUID,
    );
    return BUILTIN_DEFAULT_MESH_MATERIAL_UUID;
  }

  return {
    parseUnitySerializedScalarMap,
    parseUnityTextureEnvMap,
    readUnityMaterialDoc,
    firstDefinedMaterialValue,
    clamp01,
    hasVisibleUnityColor,
    convertedUnityMaterialAssetPath,
    convertedUnityParticleMaterialAssetPath,
    convertedUnitySpriteRendererMaterialAssetPath,
    resolveStandaloneMaterialAssetUuid,
    resolveCurrentTextureUuid,
    resolveUnityTextureUuid,
    resolveUnityMaterialTextureUuid,
    syncImportedMaterialLibraryCache,
    convertUnityMaterialToCocos,
    resolveUnityMaterialUuid,
    convertUnitySpriteRendererMaterialToCocos,
    resolveUnitySpriteRendererMaterialUuid,
    convertUnityParticleMaterialToCocos,
    resolveUnityParticleMaterial,
  };
};
