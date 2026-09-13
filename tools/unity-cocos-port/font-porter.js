'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { convertFontFile, isSfnt } = require('../font-converter.cjs');

// Cocos Creator 3.8.8 registers these suffixes in cocos/2d/utils/font-loader.ts.
const COCOS_DIRECT_FONT_EXTENSIONS = new Set(['.font', '.eot', '.ttf', '.woff', '.svg', '.ttc']);
const CONVERTIBLE_FONT_EXTENSIONS = new Set(['.otf', '.woff2', '.dfont', '.fon', '.fnt', '.pfb', '.pfa', '.bdf', '.pcf']);
const NON_FONT_CONTAINER_EXTENSIONS = new Set([
  '.anim', '.asset', '.controller', '.cs', '.fbx', '.mat', '.meta', '.prefab', '.shader', '.unity',
]);

function normalizeFontStem(stem) {
  return String(stem || '')
    .replace(/\s+SDF(?:[_ -].*)?$/i, '')
    .replace(/[_ -]+SDF(?:[_ -].*)?$/i, '')
    .trim();
}

function fontKey(value) {
  return normalizeFontStem(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function guidRefs(text) {
  const refs = [];
  const seen = new Set();
  const explicit = [
    /m_SourceFontFileGUID:\s*([a-fA-F0-9]{32})/g,
    /sourceFontFileGUID:\s*([a-fA-F0-9]{32})/g,
    /m_SourceFontFile:\s*\{[^}]*guid:\s*([a-fA-F0-9]{32})/g,
  ];
  for (const pattern of explicit) {
    let match;
    while ((match = pattern.exec(text)) != null) {
      const guid = match[1].toLowerCase();
      if (!seen.has(guid)) { seen.add(guid); refs.push(guid); }
    }
  }
  const general = /guid:\s*([a-fA-F0-9]{32})/g;
  let match;
  while ((match = general.exec(text)) != null) {
    const guid = match[1].toLowerCase();
    if (!seen.has(guid)) { seen.add(guid); refs.push(guid); }
  }
  return refs;
}

function readableAssetText(asset) {
  if (!asset?.path || !fs.existsSync(asset.path)) return '';
  try {
    const buffer = fs.readFileSync(asset.path);
    if (buffer.includes(0)) return '';
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

function looksLikeFontAsset(asset, allowUnknown = false) {
  if (!asset?.path) return false;
  const ext = String(asset.ext || path.extname(asset.path)).toLowerCase();
  if (COCOS_DIRECT_FONT_EXTENSIONS.has(ext) || CONVERTIBLE_FONT_EXTENSIONS.has(ext)) return true;
  if (!allowUnknown || !fs.existsSync(asset.path)) return false;
  try {
    const bytes = fs.readFileSync(asset.path);
    return isSfnt(bytes) || bytes.toString('ascii', 0, 4) === 'wOFF' || bytes.toString('ascii', 0, 4) === 'wOF2';
  } catch {
    return false;
  }
}

/** Resolve TMP/custom font assets through explicit serialized dependencies first. */
function resolveFontDependency(referenceAsset, unityDb) {
  if (!referenceAsset) return null;
  if (looksLikeFontAsset(referenceAsset, true)) return referenceAsset;
  const queue = [{ asset: referenceAsset, depth: 0 }];
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    const key = current.asset.guid || current.asset.path;
    if (visited.has(key)) continue;
    visited.add(key);
    const text = readableAssetText(current.asset);
    if (!text) continue;
    for (const guid of guidRefs(text)) {
      const dependency = unityDb.get(guid);
      if (!dependency) continue;
      if (looksLikeFontAsset(dependency, true)) return dependency;
      if (current.depth < 2 && visited.size < 64) queue.push({ asset: dependency, depth: current.depth + 1 });
    }
  }

  const wanted = fontKey(referenceAsset.stem);
  if (!wanted) return null;
  const candidates = [...(unityDb.byGuid?.values?.() || [])].filter((asset) => looksLikeFontAsset(asset));
  const sameDir = path.dirname(referenceAsset.path || '');
  return candidates.find((asset) => path.dirname(asset.path) === sameDir && fontKey(asset.stem) === wanted)
    || candidates.find((asset) => fontKey(asset.stem) === wanted)
    || null;
}

function directCustomFontCandidate(referenceAsset) {
  if (!referenceAsset?.path || !fs.existsSync(referenceAsset.path)) return null;
  const ext = String(referenceAsset.ext || path.extname(referenceAsset.path)).toLowerCase();
  return NON_FONT_CONTAINER_EXTENSIONS.has(ext) ? null : referenceAsset;
}

function resolveTmpMaterialAsset(doc, unityDb, getField, unityRefGuid) {
  const direct = unityDb.get(unityRefGuid(getField(doc, 'm_sharedMaterial')));
  if (direct) return direct;

  const fontAsset = unityDb.get(unityRefGuid(getField(doc, 'm_fontAsset')));
  const text = readableAssetText(fontAsset);
  if (!text) return null;
  const explicit = /^\s*m_Material:\s*\{[^}]*guid:\s*([a-fA-F0-9]{32})/m.exec(text);
  if (explicit) {
    const asset = unityDb.get(explicit[1].toLowerCase());
    if (asset) return asset;
  }
  for (const guid of guidRefs(text)) {
    const asset = unityDb.get(guid);
    if (String(asset?.ext || path.extname(asset?.path || '')).toLowerCase() === '.mat') return asset;
  }
  return null;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return Number.isFinite(Number(value)) ? Number(value) !== 0 : Boolean(value);
}

function color(value, fallback = { r: 0, g: 0, b: 0, a: 1 }) {
  if (!value || typeof value !== 'object') return fallback;
  return {
    r: number(value.r, fallback.r),
    g: number(value.g, fallback.g),
    b: number(value.b, fallback.b),
    a: number(value.a, fallback.a),
  };
}

function inlineObject(text) {
  const out = {};
  const body = String(text || '').replace(/^\s*\{/, '').replace(/\}\s*$/, '');
  for (const part of body.split(',')) {
    const split = part.indexOf(':');
    if (split < 0) continue;
    out[part.slice(0, split).trim()] = number(part.slice(split + 1).trim(), 0);
  }
  return out;
}

function materialScalar(text, key, fallback = 0) {
  const match = new RegExp(`^\\s*-?\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^\\r\\n]+)`, 'm').exec(text);
  return match ? number(match[1], fallback) : fallback;
}

function materialColor(text, key, fallback) {
  const match = new RegExp(`^\\s*-?\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(\\{[^}]+\\})`, 'm').exec(text);
  return match ? color(inlineObject(match[1]), fallback) : fallback;
}

function activeMaterialKeywords(text) {
  const keywords = new Set();
  const lines = String(text || '').split(/\r?\n/);
  const addTokens = (value) => {
    for (const token of String(value || '').replace(/[\[\],'\"]/g, ' ').split(/\s+/)) {
      if (/^[A-Z][A-Z0-9_]*$/.test(token)) keywords.add(token);
    }
  };
  for (let index = 0; index < lines.length; index++) {
    const shaderKeywords = /^\s*m_ShaderKeywords:\s*(.*)$/.exec(lines[index]);
    if (shaderKeywords) {
      addTokens(shaderKeywords[1]);
      continue;
    }
    const validKeywords = /^\s*m_ValidKeywords:\s*(.*)$/.exec(lines[index]);
    if (!validKeywords) continue;
    addTokens(validKeywords[1]);
    for (let child = index + 1; child < lines.length; child++) {
      const item = /^\s*-\s*([^\s#]+)\s*$/.exec(lines[child]);
      if (!item) break;
      addTokens(item[1]);
      index = child;
    }
  }
  return keywords;
}

function tmpMaterialStyle(asset) {
  const text = readableAssetText(asset);
  if (!text) return {};
  const keywords = activeMaterialKeywords(text);
  const outlineWidth = Math.max(0, materialScalar(text, '_OutlineWidth', 0));
  const outlineEnabled = keywords.has('OUTLINE_ON') && outlineWidth > 0;
  const underlayEnabled = keywords.has('UNDERLAY_ON') || keywords.has('UNDERLAY_INNER');
  return {
    enableOutline: outlineEnabled,
    outlineColor: materialColor(text, '_OutlineColor', { r: 0, g: 0, b: 0, a: 1 }),
    outlineWidth: Math.max(1, Math.round(outlineWidth * 10)),
    enableShadow: underlayEnabled,
    shadowColor: materialColor(text, '_UnderlayColor', { r: 0, g: 0, b: 0, a: 0.5 }),
    shadowOffset: {
      x: materialScalar(text, '_UnderlayOffsetX', 2),
      y: materialScalar(text, '_UnderlayOffsetY', -2),
    },
    shadowBlur: Math.max(0, materialScalar(text, '_UnderlaySoftness', 0)),
  };
}

function tmpFamilyName(asset) {
  const text = readableAssetText(asset);
  const match = /^\s*m_FamilyName:\s*(.+?)\s*$/m.exec(text);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : normalizeFontStem(asset?.stem);
}

module.exports = function createFontPorter(deps) {
  const {
    getField,
    hasField,
    unityRefGuid,
    importedUnityAssetPath,
    copyUnityAssetToCocos,
    resolveCurrentFontUuid,
    ensureDirectoryMetas,
    ensureAssetMeta,
  } = deps;

  function fontReference(doc) {
    const tmp = getField(doc, 'm_fontAsset');
    if (tmp && (tmp.guid || tmp.fileID)) return tmp;
    const fontData = getField(doc, 'm_FontData', {}) || {};
    return fontData.m_Font || getField(doc, 'm_Font') || null;
  }

  function builtInFontFamily(ref) {
    const guid = unityRefGuid(ref).toLowerCase();
    const fileId = String(ref?.fileID || '');
    const builtInGuid = !guid || /^0+$/.test(guid) || guid === '0000000000000000e000000000000000';
    if (builtInGuid && ['10102', '12800000'].includes(fileId)) return 'Arial';
    return '';
  }

  function prepareConvertedFont(sourceAsset, options, reporter) {
    const relative = String(sourceAsset.relativePath || path.basename(sourceAsset.path));
    const sourceExt = path.extname(relative);
    const targetRelative = `${sourceExt ? relative.slice(0, -sourceExt.length) : relative}.ttf`;
    const target = path.join(options.cocosRoot, 'assets', 'unity_imported', targetRelative);
    if (options.dryRun) {
      reporter.low('FONT_CONVERSION_REQUIRED_DRY_RUN', relative, targetRelative, 'Font requires conversion to a Cocos-loadable TTF');
      return { target: '', backend: 'dry-run' };
    }
    ensureDirectoryMetas(path.dirname(target), path.join(options.cocosRoot, 'assets'));
    const result = convertFontFile(sourceAsset.path, target);
    if (!result.ok) {
      reporter.high('FONT_CONVERSION_FAILED_SYSTEM_FALLBACK', relative, '', result.message);
      return { target: '', backend: '' };
    }
    ensureAssetMeta(target, 'font');
    reporter.low('FONT_CONVERTED_TO_TTF', relative, path.relative(options.cocosRoot, target).replace(/\\/g, '/'),
      `Converted with ${result.backend} and wired to Cocos Label`);
    return { target, backend: result.backend };
  }

  function resolveFont(doc, options, unityDb, cocosDb, reporter) {
    const ref = fontReference(doc);
    const builtIn = builtInFontFamily(ref);
    if (builtIn) {
      reporter.low('UNITY_BUILTIN_FONT_SYSTEM_MAPPED', '', '', `Unity built-in ${builtIn} mapped to the same system font`);
      return { fontUuid: '', fontFamily: builtIn, sourceAsset: null, systemFallback: true, exactSystemFont: true };
    }

    const referencedAsset = unityDb.get(unityRefGuid(ref));
    // A custom Font importer can point directly at an extension the static
    // scanner does not know. Give that byte stream to the converter before
    // declaring a system-font fallback, but never feed Unity YAML containers
    // such as TMP .asset or .mat files into external conversion backends.
    const sourceAsset = resolveFontDependency(referencedAsset, unityDb)
      || directCustomFontCandidate(referencedAsset);
    const family = tmpFamilyName(referencedAsset) || normalizeFontStem(sourceAsset?.stem) || 'Arial';
    if (!sourceAsset) {
      reporter.high('FONT_SOURCE_UNRESOLVED_SYSTEM_FALLBACK', referencedAsset?.relativePath || '', '',
        `Could not resolve a TTF/webfont dependency; using system family "${family}" with Unity label style`);
      return { fontUuid: '', fontFamily: family, sourceAsset: referencedAsset, systemFallback: true, exactSystemFont: false };
    }

    const ext = String(sourceAsset.ext || path.extname(sourceAsset.path)).toLowerCase();
    let target = importedUnityAssetPath(sourceAsset, options);
    if (COCOS_DIRECT_FONT_EXTENSIONS.has(ext)) {
      let fontUuid = target && fs.existsSync(target) ? resolveCurrentFontUuid(target, options) : '';
      if (!fontUuid) {
        target = copyUnityAssetToCocos(sourceAsset, options, reporter, 'font', 'high', { deferNeedsImportReport: true });
        fontUuid = resolveCurrentFontUuid(target, options);
      }
      if (!fontUuid) fontUuid = cocosDb.resolveFontByStem(sourceAsset.stem);
      if (fontUuid) {
        reporter.low('FONT_ASSET_COPIED_AND_WIRED', sourceAsset.relativePath,
          target ? path.relative(options.cocosRoot, target).replace(/\\/g, '/') : '',
          'Unity TTF/webfont copied and wired to cc.Label');
        return { fontUuid, fontFamily: normalizeFontStem(sourceAsset.stem), sourceAsset, systemFallback: false };
      }
      reporter.high('FONT_WIRING_FAILED_SYSTEM_FALLBACK', sourceAsset.relativePath, '',
        `Font asset was found but no Cocos TTFFont UUID could be wired; using system family "${family}"`);
      return { fontUuid: '', fontFamily: family, sourceAsset, systemFallback: true, exactSystemFont: false };
    }

    const converted = prepareConvertedFont(sourceAsset, options, reporter);
    const fontUuid = converted.target ? resolveCurrentFontUuid(converted.target, options) : '';
    if (fontUuid) return { fontUuid, fontFamily: normalizeFontStem(sourceAsset.stem), sourceAsset, systemFallback: false };
    return { fontUuid: '', fontFamily: family, sourceAsset, systemFallback: true, exactSystemFont: false };
  }

  function isTextEffect(doc, unityDb) {
    if (!hasField(doc, 'm_EffectColor') || !hasField(doc, 'm_EffectDistance')) return false;
    const script = unityDb.get(unityRefGuid(getField(doc, 'm_Script')));
    return !script || /^(Shadow|Outline)$/i.test(String(script.stem || ''));
  }

  function siblingEffects(gameObject, model, unityDb) {
    const result = {};
    for (const componentId of gameObject?.components || []) {
      const doc = model.componentDocs.get(componentId);
      if (!doc || !isTextEffect(doc, unityDb)) continue;
      const script = unityDb.get(unityRefGuid(getField(doc, 'm_Script')));
      const kind = /outline/i.test(String(script?.stem || '')) ? 'outline' : 'shadow';
      const effectColor = color(getField(doc, 'm_EffectColor'), { r: 0, g: 0, b: 0, a: 0.5 });
      const distance = getField(doc, 'm_EffectDistance', { x: 1, y: -1 }) || { x: 1, y: -1 };
      if (kind === 'outline') {
        result.enableOutline = true;
        result.outlineColor = effectColor;
        result.outlineWidth = Math.max(1, Math.round(Math.max(Math.abs(number(distance.x, 1)), Math.abs(number(distance.y, -1)))));
      } else {
        result.enableShadow = true;
        result.shadowColor = effectColor;
        result.shadowOffset = { x: number(distance.x, 1), y: number(distance.y, -1) };
        result.shadowBlur = 0;
      }
    }
    return result;
  }

  function resolveStyle(doc, gameObject, model, unityDb) {
    const fontData = getField(doc, 'm_FontData', {}) || {};
    const isTmp = hasField(doc, 'm_fontAsset') || hasField(doc, 'm_fontStyle');
    let isBold = false;
    let isItalic = false;
    let isUnderline = false;
    if (isTmp) {
      const style = number(getField(doc, 'm_fontStyle', 0), 0);
      const weight = number(getField(doc, 'm_fontWeight', 400), 400);
      isBold = (style & 1) !== 0 || weight >= 700;
      isItalic = (style & 2) !== 0;
      isUnderline = (style & 4) !== 0;
    } else {
      const style = number(fontData.m_FontStyle, number(getField(doc, 'm_FontStyle', 0), 0));
      isBold = style === 1 || style === 3;
      isItalic = style === 2 || style === 3;
    }

    let horizontalAlign = 1;
    let verticalAlign = 1;
    if (isTmp) {
      const horizontal = number(getField(doc, 'm_HorizontalAlignment', 2), 2);
      const vertical = number(getField(doc, 'm_VerticalAlignment', 512), 512);
      horizontalAlign = (horizontal & 1) ? 0 : ((horizontal & 4) ? 2 : 1);
      verticalAlign = (vertical & 256) ? 0 : ((vertical & 1024) ? 2 : 1);
    } else {
      const alignment = number(fontData.m_Alignment, number(getField(doc, 'm_Alignment', 4), 4));
      horizontalAlign = alignment % 3;
      verticalAlign = Math.max(0, Math.min(2, Math.floor(alignment / 3)));
    }

    let materialStyle = {};
    if (isTmp) {
      const materialAsset = resolveTmpMaterialAsset(doc, unityDb, getField, unityRefGuid);
      materialStyle = tmpMaterialStyle(materialAsset);
    }
    const legacyEffects = siblingEffects(gameObject, model, unityDb);
    return {
      isBold,
      isItalic,
      isUnderline,
      underlineHeight: Math.max(1, number(getField(doc, 'm_UnderlineHeight', 2), 2)),
      horizontalAlign,
      verticalAlign,
      enableWrapText: isTmp
        ? boolean(getField(doc, 'm_enableWordWrapping', 0))
        : number(fontData.m_HorizontalOverflow, 0) === 0,
      spacingX: number(getField(doc, 'm_characterSpacing', 0), 0),
      enableOutline: false,
      outlineColor: { r: 0, g: 0, b: 0, a: 1 },
      outlineWidth: 2,
      enableShadow: false,
      shadowColor: { r: 0, g: 0, b: 0, a: 1 },
      shadowOffset: { x: 2, y: -2 },
      shadowBlur: 2,
      ...materialStyle,
      ...legacyEffects,
    };
  }

  function resolveLabelConfig(doc, gameObject, model, options, unityDb, cocosDb, reporter) {
    return { ...resolveFont(doc, options, unityDb, cocosDb, reporter), ...resolveStyle(doc, gameObject, model, unityDb) };
  }

  return {
    isTextEffect,
    resolveFont,
    resolveLabelConfig,
    resolveStyle,
  };
};

module.exports.COCOS_DIRECT_FONT_EXTENSIONS = COCOS_DIRECT_FONT_EXTENSIONS;
module.exports.CONVERTIBLE_FONT_EXTENSIONS = CONVERTIBLE_FONT_EXTENSIONS;
module.exports.guidRefs = guidRefs;
module.exports.normalizeFontStem = normalizeFontStem;
module.exports.resolveFontDependency = resolveFontDependency;
module.exports.activeMaterialKeywords = activeMaterialKeywords;
module.exports.tmpMaterialStyle = tmpMaterialStyle;
