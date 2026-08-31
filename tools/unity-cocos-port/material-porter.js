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
  copyAssetIfChanged,
  ensureDir,
  readJsonIfExists,
  stableUuid,
  toPosix,
  unityColorToCocos,
  unityLinearColorToCocos,
  cocosUuid,
} = require('./core-utils');

const UNITY_BUILTIN_SHADER_GUID = '0000000000000000f000000000000000';
const COCOS_PARTICLE_TECHNIQUE_ADD = 0;
const COCOS_PARTICLE_TECHNIQUE_ALPHA_BLEND = 1;
const COCOS_PARTICLE_TECHNIQUE_ADD_MULTIPLY = 2;
const COCOS_PARTICLE_TECHNIQUE_ADD_SMOOTH = 3;
const COCOS_PARTICLE_TECHNIQUE_PREMULTIPLY_BLEND = 4;
const INVISIBLE_SHADOW_RECEIVER_EFFECT_TEMPLATE = path.join(__dirname, 'invisible-shadow-receiver.effect');
const INVISIBLE_SHADOW_RECEIVER_EFFECT_PATH = path.join('assets', 'effects', 'InvisibleShadowReceiver.effect');
const TCP2_HYBRID_SHADER_2_EFFECT_TEMPLATE = path.join(__dirname, 'tcp2-hybrid-shader-2.effect');
const TCP2_HYBRID_SHADER_2_EFFECT_PATH = path.join('assets', 'effects', 'TCP2HybridShader2.effect');
const TCP2_HYBRID_PARTICLE_EFFECT_TEMPLATE = path.join(__dirname, 'tcp2-hybrid-particle.effect');
const TCP2_HYBRID_PARTICLE_EFFECT_PATH = path.join('assets', 'effects', 'TCP2HybridParticle.effect');
const URP_LIT_EFFECT_TEMPLATE = path.join(__dirname, 'urp-lit.effect');
const URP_LIT_EFFECT_PATH = path.join('assets', 'effects', 'URPLit.effect');
const URP_UNLIT_EFFECT_TEMPLATE = path.join(__dirname, 'urp-unlit.effect');
const URP_UNLIT_EFFECT_PATH = path.join('assets', 'effects', 'URPUnlit.effect');
const TCP2_HYBRID_SHADER_2_GUIDS = new Set([
  'edd7abf643fa4bc4e8561d4c280c97cf',
  'df5bb027d94a6c44bb32b3c31ec1303f',
]);
const URP_LIT_SHADER_GUIDS = new Set(['933532a4fcc9baf4fa0491de14d08ed7']);
const URP_UNLIT_SHADER_GUIDS = new Set(['650dd9526735d5b46b79224bc6e94025']);
const COCOS_PARTICLE_DEFAULT_TINT = 128 / 255;
// URP particle shaders sample _BaseMap. _MainTex can remain populated with a
// legacy compatibility texture, so only use it when _BaseMap is absent.
const UNITY_PARTICLE_MATERIAL_TEXTURE_KEYS = [
  '_BaseMap',
  '_MainTex',
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
      // An already-imported texture is reused for its stable uuid, but its bytes still
      // have to track the Unity source. Without this the playable silently keeps the art
      // from the first port after Unity re-exports the texture, and nothing reports it.
      if (!options.dryRun && copyAssetIfChanged(textureAsset.path, importedDest) === 'refreshed') {
        reporter.low(
          'ASSET_REFRESHED',
          textureAsset.relativePath,
          toPosix(path.relative(options.cocosRoot, importedDest)),
          'Existing Cocos texture differed from the Unity source and was replaced; refresh/import is required',
        );
      }
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

  function unityMaterialTilingOffset(texEnvs, keys) {
    const env = firstDefinedMaterialValue(texEnvs, keys, null);
    if (!env) return null;
    const scale = env.m_Scale || { x: 1, y: 1 };
    const offset = env.m_Offset || { x: 0, y: 0 };
    if (isDefaultParticleTilingOffset(scale, offset)) return null;
    return {
      __type__: 'cc.Vec4',
      x: Number(scale.x ?? 1),
      y: Number(scale.y ?? 1),
      z: Number(offset.x ?? 0),
      w: Number(offset.y ?? 0),
    };
  }

  function syncImportedMaterialLibraryCache(materialData, meta, options) {
    if (!meta?.uuid || !materialData || options.dryRun) return false;
    const libraryFile = libraryJsonPathForUuid(options, meta.uuid);
    ensureDir(path.dirname(libraryFile));
    fs.writeFileSync(libraryFile, `${JSON.stringify(materialData, null, 2)}\n`, 'utf8');
    return true;
  }

  function ensureInvisibleShadowReceiverEffect(options, reporter) {
    const effectFile = path.join(options.cocosRoot, INVISIBLE_SHADOW_RECEIVER_EFFECT_PATH);
    const relativePath = toPosix(path.relative(options.cocosRoot, effectFile));
    if (options.dryRun) return stableUuid(`effect:${relativePath}`);
    if (options._invisibleShadowReceiverEffectUuid) return options._invisibleShadowReceiverEffectUuid;

    ensureDir(path.dirname(effectFile));
    ensureDirectoryMetas(path.dirname(effectFile), path.join(options.cocosRoot, 'assets'));
    const effectText = fs.readFileSync(INVISIBLE_SHADOW_RECEIVER_EFFECT_TEMPLATE, 'utf8');
    if (!fs.existsSync(effectFile) || fs.readFileSync(effectFile, 'utf8') !== effectText) {
      fs.writeFileSync(effectFile, effectText, 'utf8');
    }

    const metaFile = `${effectFile}.meta`;
    const existing = readJsonIfExists(metaFile) || {};
    const meta = {
      ver: existing.ver || '1.7.1',
      importer: 'effect',
      imported: existing.imported ?? true,
      uuid: existing.uuid || stableUuid(`effect:${relativePath}`),
      files: Array.isArray(existing.files) && existing.files.length ? existing.files : ['.json'],
      subMetas: {},
      userData: { ...(existing.userData || {}) },
    };
    if (JSON.stringify(existing) !== JSON.stringify(meta)) {
      fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    }

    options._invisibleShadowReceiverEffectUuid = meta.uuid;
    reporter.low(
      'INVISIBLE_SHADOW_RECEIVER_EFFECT_PREPARED',
      relativePath,
      '',
      'Prepared opaque depth-only effect with color writes disabled for Cocos planar-shadow receivers',
      meta.uuid,
    );
    return meta.uuid;
  }

  function ensureTemplateEffect(options, reporter, config) {
    const effectFile = path.join(options.cocosRoot, config.effectPath);
    const relativePath = toPosix(path.relative(options.cocosRoot, effectFile));
    if (options.dryRun) return stableUuid(`effect:${relativePath}`);
    if (options[config.cacheKey]) return options[config.cacheKey];

    ensureDir(path.dirname(effectFile));
    ensureDirectoryMetas(path.dirname(effectFile), path.join(options.cocosRoot, 'assets'));
    const effectText = fs.readFileSync(config.template, 'utf8');
    if (!fs.existsSync(effectFile) || fs.readFileSync(effectFile, 'utf8') !== effectText) {
      fs.writeFileSync(effectFile, effectText, 'utf8');
    }

    const metaFile = `${effectFile}.meta`;
    const existing = readJsonIfExists(metaFile) || {};
    const meta = {
      ver: existing.ver || '1.7.1',
      importer: 'effect',
      imported: existing.imported ?? true,
      uuid: existing.uuid || stableUuid(`effect:${relativePath}`),
      files: Array.isArray(existing.files) && existing.files.length ? existing.files : ['.json'],
      subMetas: {},
      userData: { ...(existing.userData || {}) },
    };
    if (JSON.stringify(existing) !== JSON.stringify(meta)) {
      fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    }

    options[config.cacheKey] = meta.uuid;
    reporter.low(
      config.reportCode,
      relativePath,
      '',
      config.message,
      meta.uuid,
    );
    return meta.uuid;
  }

  function ensureTcp2HybridParticleEffect(options, reporter) {
    return ensureTemplateEffect(options, reporter, {
      effectPath: TCP2_HYBRID_PARTICLE_EFFECT_PATH,
      template: TCP2_HYBRID_PARTICLE_EFFECT_TEMPLATE,
      cacheKey: '_tcp2HybridParticleEffectUuid',
      reportCode: 'TCP2_HYBRID_PARTICLE_EFFECT_PREPARED',
      message: 'Prepared the Cocos TCP2 Hybrid Shader 2 mesh-particle effect',
    });
  }

  function ensureTcp2HybridShader2Effect(options, reporter) {
    return ensureTemplateEffect(options, reporter, {
      effectPath: TCP2_HYBRID_SHADER_2_EFFECT_PATH,
      template: TCP2_HYBRID_SHADER_2_EFFECT_TEMPLATE,
      cacheKey: '_tcp2HybridShader2EffectUuid',
      reportCode: 'TCP2_HYBRID_SHADER_2_EFFECT_PREPARED',
      message: 'Prepared the Cocos mesh port of TCP2 Hybrid Shader 2',
    });
  }

  function ensureUrpLitEffect(options, reporter) {
    return ensureTemplateEffect(options, reporter, {
      effectPath: URP_LIT_EFFECT_PATH,
      template: URP_LIT_EFFECT_TEMPLATE,
      cacheKey: '_urpLitEffectUuid',
      reportCode: 'URP_LIT_EFFECT_PREPARED',
      message: 'Prepared the Cocos port of Unity URP Lit',
    });
  }

  function ensureUrpUnlitEffect(options, reporter) {
    return ensureTemplateEffect(options, reporter, {
      effectPath: URP_UNLIT_EFFECT_PATH,
      template: URP_UNLIT_EFFECT_TEMPLATE,
      cacheKey: '_urpUnlitEffectUuid',
      reportCode: 'URP_UNLIT_EFFECT_PREPARED',
      message: 'Prepared the Cocos port of Unity URP Unlit',
    });
  }

  function ensureCustomPortedShaderEffect(shaderAsset, options, reporter) {
    if (!shaderAsset?.path || !fs.existsSync(shaderAsset.path)) return '';
    const ext = path.extname(shaderAsset.path).toLowerCase();
    if (ext !== '.shader' && ext !== '.hlsl' && ext !== '.shadergraph') return '';

    const effectStem = shaderAsset.stem || path.basename(shaderAsset.path, ext);
    const effectRelPath = path.join('assets', 'effects', `${effectStem}.effect`);
    const effectFile = path.join(options.cocosRoot, effectRelPath);
    const relativePosix = toPosix(path.relative(options.cocosRoot, effectFile));

    if (options.dryRun) return stableUuid(`effect:${relativePosix}`);
    if (options[`_customEffectUuid_${effectStem}`]) return options[`_customEffectUuid_${effectStem}`];

    ensureDir(path.dirname(effectFile));
    ensureDirectoryMetas(path.dirname(effectFile), path.join(options.cocosRoot, 'assets'));

    try {
      const { convertUnityHlslToCocosEffect } = require('../unity-hlsl-to-cocos-effect.cjs');
      convertUnityHlslToCocosEffect({
        src: shaderAsset.path,
        out: effectFile,
        cocosRoot: options.cocosRoot,
        shaderName: effectStem,
        overwrite: true,
      }, reporter);

      const meta = readJsonIfExists(`${effectFile}.meta`);
      const effectUuid = meta?.uuid || stableUuid(`effect:${relativePosix}`);
      options[`_customEffectUuid_${effectStem}`] = effectUuid;

      reporter.low(
        'CUSTOM_SHADER_AUTO_PORTED',
        shaderAsset.relativePath,
        relativePosix,
        `Auto-transpiled custom Unity shader "${shaderAsset.stem}" to Cocos Creator effect`,
        effectUuid,
      );
      return effectUuid;
    } catch (err) {
      reporter.high(
        'CUSTOM_SHADER_PORT_FAILED',
        shaderAsset.relativePath,
        relativePosix,
        `Failed to transpile custom shader "${shaderAsset.stem}": ${err.message}`,
      );
      return '';
    }
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
    let shaderName = '';
    let shaderAsset = null;
    if (shaderGuid && shaderGuid !== UNITY_BUILTIN_SHADER_GUID) {
      shaderAsset = unityDb?.get(shaderGuid);
      shaderName = readUnityShaderName(shaderAsset) || shaderAsset?.relativePath || shaderGuid;
    }
    const invisibleShadowReceiver = /Invisible Shadow Receiver/i.test(shaderName);
    const tcp2HybridShader2 = TCP2_HYBRID_SHADER_2_GUIDS.has(shaderGuid)
      || /(?:Toony Colors Pro 2|TCP2).*Hybrid Shader 2/i.test(shaderName);
    const tcp2EffectUuid = tcp2HybridShader2
      ? ensureTcp2HybridShader2Effect(options, reporter)
      : '';
    const urpLit = URP_LIT_SHADER_GUIDS.has(shaderGuid)
      || /Universal Render Pipeline\/Lit/i.test(shaderName);
    const urpUnlit = URP_UNLIT_SHADER_GUIDS.has(shaderGuid)
      || /Universal Render Pipeline\/Unlit/i.test(shaderName);
    const urpLitEffectUuid = urpLit ? ensureUrpLitEffect(options, reporter) : '';
    const urpUnlitEffectUuid = urpUnlit ? ensureUrpUnlitEffect(options, reporter) : '';
    const customShaderEffectUuid = (!invisibleShadowReceiver && !tcp2EffectUuid && !urpLitEffectUuid && !urpUnlitEffectUuid && shaderAsset)
      ? ensureCustomPortedShaderEffect(shaderAsset, options, reporter)
      : '';
    if (shaderName) {
      const supportedCustomShader = invisibleShadowReceiver
        || Boolean(tcp2EffectUuid || urpLitEffectUuid || urpUnlitEffectUuid || customShaderEffectUuid);
      reporter[supportedCustomShader ? 'low' : 'high'](
        invisibleShadowReceiver
          ? 'INVISIBLE_SHADOW_RECEIVER_APPROXIMATED'
          : tcp2EffectUuid
            ? 'TCP2_HYBRID_SHADER_2_PORTED'
            : urpLitEffectUuid
              ? 'URP_LIT_SHADER_PORTED'
              : urpUnlitEffectUuid
                ? 'URP_UNLIT_SHADER_PORTED'
                : customShaderEffectUuid
                  ? 'CUSTOM_SHADER_PORTED'
                  : 'CUSTOM_SHADER_NOT_PORTED',
        materialAsset.relativePath,
        String(getField(materialDoc, 'm_Name', materialAsset.stem) || materialAsset.stem),
        invisibleShadowReceiver
          ? `Custom shader "${shaderName}" was mapped to a depth-only effect for Cocos planar shadows`
          : tcp2EffectUuid
            ? `Custom shader "${shaderName}" was mapped to the Cocos TCP2 Hybrid Shader 2 effect`
            : urpLitEffectUuid
              ? `Unity shader "${shaderName}" was mapped to the Cocos URP Lit effect`
              : urpUnlitEffectUuid
                ? `Unity shader "${shaderName}" was mapped to the Cocos URP Unlit effect`
                : customShaderEffectUuid
                  ? `Custom shader "${shaderName}" was auto-transpiled and mapped to its Cocos effect`
                  : `Custom shader "${shaderName}" has not been ported; material approximated with builtin-standard`,
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
    const mainTilingOffset = unityMaterialTilingOffset(texEnvs, UNITY_MATERIAL_BASE_TEXTURE_KEYS);
    const normalTextureUuid = resolveUnityMaterialTextureUuid(texEnvs, UNITY_MATERIAL_NORMAL_TEXTURE_KEYS, unityDb, options, reporter);
    const occlusionTextureUuid = resolveUnityMaterialTextureUuid(texEnvs, UNITY_MATERIAL_OCCLUSION_TEXTURE_KEYS, unityDb, options, reporter);
    const emissiveTextureUuid = resolveUnityMaterialTextureUuid(texEnvs, UNITY_MATERIAL_EMISSIVE_TEXTURE_KEYS, unityDb, options, reporter);

    const defines = {};
    if (alphaClip) defines.USE_ALPHA_TEST = true;
    if (mainTextureUuid) defines.USE_ALBEDO_MAP = true;
    if (normalTextureUuid) defines.USE_NORMAL_MAP = true;
    if (occlusionTextureUuid) defines.USE_OCCLUSION_MAP = true;
    if (emissiveTextureUuid) defines.USE_EMISSIVE_MAP = true;

    const linearMaterialColor = customShaderEffectUuid ? unityColorToCocos : unityLinearColorToCocos;
    const props = {
      mainColor: linearMaterialColor(mainColor),
      roughness,
      metallic,
    };
    if (mainTextureUuid) props.mainTexture = { __uuid__: mainTextureUuid };
    if (mainTilingOffset) props.tilingOffset = mainTilingOffset;
    if (normalTextureUuid) props.normalMap = { __uuid__: normalTextureUuid };
    if (occlusionTextureUuid) {
      props.occlusionMap = { __uuid__: occlusionTextureUuid };
      props.occlusion = clamp01(firstDefinedMaterialValue(floats, ['_OcclusionStrength'], 1), 1);
    }
    if (emissionEnabled || emissiveTextureUuid || hasVisibleUnityColor(emissionColor)) {
      props.emissive = linearMaterialColor(emissionColor);
    }
    if (emissiveTextureUuid) props.emissiveMap = { __uuid__: emissiveTextureUuid };
    if (alphaClip) props.alphaThreshold = cutoff;

    const urpUnlitProps = { mainColor: unityLinearColorToCocos(mainColor) };
    if (mainTextureUuid) urpUnlitProps.mainTexture = { __uuid__: mainTextureUuid };
    if (mainTilingOffset) urpUnlitProps.tilingOffset = mainTilingOffset;
    if (alphaClip) urpUnlitProps.alphaThreshold = cutoff;

    const tcp2Props = {
      // TCP2 Base/HColor/SColor are regular ShaderLab Color properties. Unity
      // serializes them as sRGB and linearizes them when supplying the shader;
      // Cocos `linear: true` does the same, so preserve the serialized bytes.
      mainColor: unityColorToCocos(mainColor),
      highlightColor: unityColorToCocos(firstDefinedMaterialValue(colors, ['_HColor'], { r: 1, g: 1, b: 1, a: 1 })),
      shadowColor: unityColorToCocos(firstDefinedMaterialValue(colors, ['_SColor'], { r: 0.2, g: 0.2, b: 0.2, a: 1 })),
      rampThreshold: clamp01(firstDefinedMaterialValue(floats, ['_RampThreshold'], 0.75), 0.75),
      rampSmoothing: clamp01(firstDefinedMaterialValue(floats, ['_RampSmoothing'], 0.1), 0.1),
      indirectStrength: clamp01(firstDefinedMaterialValue(floats, ['_IndirectIntensity'], 1), 1),
      shadowLightAtten: clamp01(firstDefinedMaterialValue(floats, ['_ShadowColorLightAtten'], 1), 1),
      rimColor: unityLinearColorToCocos(firstDefinedMaterialValue(colors, ['_RimColor'], { r: 0.8, g: 0.8, b: 0.8, a: 1 })),
      rimMin: Number(firstDefinedMaterialValue(floats, ['_RimMin'], 0.5)),
      rimMax: Number(firstDefinedMaterialValue(floats, ['_RimMax'], 1)),
      rimLightMask: Number(firstDefinedMaterialValue(floats, ['_UseRimLightMask'], 1)),
      rimStrength: Number(firstDefinedMaterialValue(floats, ['_UseRim'], 0)) > 0 ? 1 : 0,
      specularColor: unityLinearColorToCocos(firstDefinedMaterialValue(colors, ['_SpecularColor'], { r: 0.75, g: 0.75, b: 0.75, a: 1 })),
      specularRoughness: clamp01(firstDefinedMaterialValue(floats, ['_SpecularRoughness'], 0.5), 0.5),
      specularStrength: Number(firstDefinedMaterialValue(floats, ['_UseSpecular'], 0)) > 0 ? 1 : 0,
      // Saved TCP2 emission data remains in .mat when the feature is disabled.
      // Respect _UseEmission instead of turning that dormant value into an
      // undocumented brightness compensation in every ported project.
      emissive: unityLinearColorToCocos(emissionEnabled
        ? emissionColor
        : { r: 0, g: 0, b: 0, a: 1 }),
    };
    if (mainTextureUuid) tcp2Props.mainTexture = { __uuid__: mainTextureUuid };
    if (emissiveTextureUuid) tcp2Props.emissiveMap = { __uuid__: emissiveTextureUuid };
    if (mainTilingOffset) tcp2Props.tilingOffset = mainTilingOffset;

    if (mainTilingOffset) {
      reporter.low(
        'MATERIAL_TILING_OFFSET_PORTED',
        materialAsset.relativePath,
        String(getField(materialDoc, 'm_Name', materialAsset.stem) || materialAsset.stem),
        'Unity base texture scale and offset were mapped to the Cocos material tilingOffset property',
        `${mainTilingOffset.x},${mainTilingOffset.y},${mainTilingOffset.z},${mainTilingOffset.w}`,
      );
    }

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

    const resolvedEffectUuid = invisibleShadowReceiver
      ? ensureInvisibleShadowReceiverEffect(options, reporter)
      : tcp2EffectUuid || urpLitEffectUuid || urpUnlitEffectUuid || customShaderEffectUuid || BUILTIN_STANDARD_EFFECT_UUID;

    const materialData = {
      __type__: 'cc.Material',
      _name: String(getField(materialDoc, 'm_Name', materialAsset.stem) || materialAsset.stem),
      _objFlags: 0,
      __editorExtras__: {},
      _native: '',
      _effectAsset: cocosUuid(
        resolvedEffectUuid,
        'cc.EffectAsset',
      ),
      _techIdx: (invisibleShadowReceiver || tcp2EffectUuid || customShaderEffectUuid)
        ? 0
        : transparent
          ? BUILTIN_STANDARD_TRANSPARENT_TECHNIQUE_INDEX
          : 0,
      _defines: [invisibleShadowReceiver || tcp2EffectUuid
        ? {}
        : urpUnlitEffectUuid || customShaderEffectUuid
          ? alphaClip ? { USE_ALPHA_TEST: true } : {}
          : defines],
      _states: invisibleShadowReceiver ? [] : states,
      _props: [invisibleShadowReceiver
        ? {}
        : tcp2EffectUuid
          ? tcp2Props
          : urpUnlitEffectUuid
            ? urpUnlitProps
            : props],
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
    const particleShaderAsset = particleShaderGuid
      ? unityDb?.get(particleShaderGuid)
      : null;
    const particleShaderName = readUnityShaderName(particleShaderAsset)
      || particleShaderAsset?.relativePath
      || particleShaderGuid;
    const tcp2ParticleMaterial = TCP2_HYBRID_SHADER_2_GUIDS.has(particleShaderGuid)
      || /(?:Toony Colors Pro 2|TCP2).*Hybrid Shader 2/i.test(particleShaderName);
    const tcp2ParticleEffectUuid = tcp2ParticleMaterial
      ? ensureTcp2HybridParticleEffect(options, reporter)
      : '';
    if (particleShaderGuid && particleShaderGuid !== UNITY_BUILTIN_SHADER_GUID) {
      reporter[tcp2ParticleMaterial ? 'low' : 'high'](
        tcp2ParticleMaterial
          ? 'TCP2_PARTICLE_SHADER_PORTED'
          : 'CUSTOM_SHADER_NOT_PORTED',
        materialAsset.relativePath,
        String(getField(materialDoc, 'm_Name', materialAsset.stem) || materialAsset.stem),
        tcp2ParticleMaterial
          ? `TCP2 mesh-particle material "${particleShaderName}" was mapped to the Cocos TCP2 Hybrid Shader 2 particle effect`
          : `Custom shader "${particleShaderName}" has not been ported; material approximated with builtin particle effect`,
      );
    }

    const floats = parseUnitySerializedScalarMap(materialDoc, 'm_Floats');
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
    const customRenderQueue = Number(getField(materialDoc, 'm_CustomRenderQueue', -1) || -1);
    const transparent = Number(firstDefinedMaterialValue(floats, ['_Surface', '_Mode', '_RenderingMode'], 0) || 0) > 0
      || customRenderQueue >= 3000
      || clamp01(mainColor.a, 1) < 1;
    const techniqueIndex = tcp2ParticleMaterial
      ? transparent ? 1 : 0
      : resolveUnityParticleMaterialTechnique(materialDoc, unityDb);

    const tcp2ParticleEmissionEnabled = Number(firstDefinedMaterialValue(floats, ['_UseEmission'], 0) || 0) > 0;
    const props = tcp2ParticleMaterial ? {
      mainColor: unityColorToCocos(mainColor),
      highlightColor: unityColorToCocos(firstDefinedMaterialValue(colors, ['_HColor'], { r: 1, g: 1, b: 1, a: 1 })),
      shadowColor: unityColorToCocos(firstDefinedMaterialValue(colors, ['_SColor'], { r: 0.2, g: 0.2, b: 0.2, a: 1 })),
      rampThreshold: clamp01(firstDefinedMaterialValue(floats, ['_RampThreshold'], 0.75), 0.75),
      rampSmoothing: clamp01(firstDefinedMaterialValue(floats, ['_RampSmoothing'], 0.1), 0.1),
      indirectStrength: clamp01(firstDefinedMaterialValue(floats, ['_IndirectIntensity'], 1), 1),
      shadowLightAtten: clamp01(firstDefinedMaterialValue(floats, ['_ShadowColorLightAtten'], 1), 1),
      rimColor: unityLinearColorToCocos(firstDefinedMaterialValue(colors, ['_RimColor'], { r: 0.8, g: 0.8, b: 0.8, a: 1 })),
      rimMin: Number(firstDefinedMaterialValue(floats, ['_RimMin'], 0.5)),
      rimMax: Number(firstDefinedMaterialValue(floats, ['_RimMax'], 1)),
      rimLightMask: Number(firstDefinedMaterialValue(floats, ['_UseRimLightMask'], 1)),
      rimStrength: Number(firstDefinedMaterialValue(floats, ['_UseRim'], 0)) > 0 ? 1 : 0,
      specularColor: unityLinearColorToCocos(firstDefinedMaterialValue(colors, ['_SpecularColor'], { r: 0.75, g: 0.75, b: 0.75, a: 1 })),
      specularRoughness: clamp01(firstDefinedMaterialValue(floats, ['_SpecularRoughness'], 0.5), 0.5),
      specularStrength: Number(firstDefinedMaterialValue(floats, ['_UseSpecular'], 0)) > 0 ? 1 : 0,
      emissive: unityLinearColorToCocos(tcp2ParticleEmissionEnabled
        ? firstDefinedMaterialValue(colors, ['_EmissionColor', '_EmissiveColor'], { r: 0, g: 0, b: 0, a: 1 })
        : { r: 0, g: 0, b: 0, a: 1 }),
    } : {};
    if (!isDefaultParticleTilingOffset(scale, offset)) {
      props.mainTiling_Offset = [
        Number(scale.x ?? 1),
        Number(scale.y ?? 1),
        Number(offset.x ?? 0),
        Number(offset.y ?? 0),
      ];
    }
    if (mainTextureUuid) props.mainTexture = cocosUuid(mainTextureUuid, 'cc.Texture2D');
    if (!tcp2ParticleMaterial && particleTechniqueUsesTintColor(techniqueIndex)) {
      // Unity's Particles/Additive and Cocos' tinted-fs:add are the same formula
      // (`2.0 * vertexColor * tintColor * tex`) with the same 0.5 default, so an
      // authored _TintColor carries over verbatim. Forcing the default here used
      // to flatten every additive material to 0.5 - a material authored at 1.0
      // came out half as bright as Unity.
      if (hasUnityMaterialColor(colors, ['_TintColor', '_Color', '_BaseColor'])) {
        props.tintColor = materialColor(mainColor);
      }
      // No authored tint: Unity's own shader default is 0.5, which is already the
      // Cocos default, so leaving the property off keeps the two in agreement.
    }

    const materialData = {
      __type__: 'cc.Material',
      _name: String(getField(materialDoc, 'm_Name', materialAsset.stem) || materialAsset.stem),
      _objFlags: 0,
      __editorExtras__: {},
      _native: '',
      _effectAsset: cocosUuid(tcp2ParticleEffectUuid || BUILTIN_PARTICLE_EFFECT_UUID, 'cc.EffectAsset'),
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
      mainColor: unityLinearColorToCocos(mainColor),
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
