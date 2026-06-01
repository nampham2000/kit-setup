'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonIfExists, toPosix, stableSubAssetId } = require('./core-utils');

module.exports = function createSpritePorter(deps) {
  const {
    firstSubMetaRecord,
    firstImportedSubMetaRecord,
    importedUnityAssetPath,
    waitForCurrentSpriteFrameUuid,
    copyUnityAssetToCocos,
    resolveUnitySpriteRendererMaterialUuid,
    unityRefGuid,
    getField,
    getNestedList,
  } = deps;

  function resolveImportedSpriteAsset(assetFile) {
    if (!assetFile || !fs.existsSync(assetFile)) return '';
    const meta = readJsonIfExists(`${assetFile}.meta`);
    if (!meta?.uuid) return '';
    if (meta.importer === 'image') {
      return firstSubMetaRecord(meta.uuid, meta.subMetas, 'sprite-frame', path.basename(assetFile, path.extname(assetFile)))?.uuid || '';
    }
    return firstImportedSubMetaRecord(meta.uuid, meta.subMetas, 'sprite-frame')?.uuid || '';
  }

  function isPendingGeneratedSubMeta(subMeta) {
    return Boolean(subMeta?.userData?.unityCocosPortPendingImport);
  }

  function hasImportedSubMeta(subMetas, importer) {
    return Object.values(subMetas || {}).some((subMeta) => (
      subMeta?.importer === importer &&
      !isPendingGeneratedSubMeta(subMeta)
    ));
  }

  function subMetaFilesForImportedState(imported, files) {
    return imported ? files : [];
  }

  function uniqueSubMetaId(subMetas, seed) {
    return stableSubAssetId(seed, new Set(Object.keys(subMetas || {})));
  }

  function readPrintableStrings(file) {
    try {
      const text = fs.readFileSync(file).toString('latin1');
      return [...text.matchAll(/[A-Za-z0-9_. -]{3,}/g)]
        .map((match) => match[0].trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function readUnitySpriteTextureGuid(assetFile) {
    try {
      const text = fs.readFileSync(assetFile, 'utf8');
      return /texture:\s*\{fileID:\s*\d+,\s*guid:\s*([a-f0-9]+),/i.exec(text)?.[1] || '';
    } catch {
      return '';
    }
  }

  function resolveUnitySpriteTextureAsset(spriteAsset, unityDb) {
    if (!spriteAsset?.path || path.extname(spriteAsset.path).toLowerCase() !== '.asset') return null;
    const textureGuid = readUnitySpriteTextureGuid(spriteAsset.path);
    if (!textureGuid) return null;
    return unityDb.get(textureGuid) || null;
  }

  function resolveUnitySpriteFrame(spriteAsset, options, unityDb, cocosDb, reporter) {
    if (!spriteAsset) return { spriteUuid: '', copiedDest: '', sourceAsset: null, usedTextureFallback: false };

    const attempts = [{ asset: spriteAsset, allowCopy: path.extname(spriteAsset.path).toLowerCase() !== '.asset', usedTextureFallback: false }];
    const textureAsset = resolveUnitySpriteTextureAsset(spriteAsset, unityDb);
    if (textureAsset && textureAsset.path !== spriteAsset.path) {
      attempts.push({ asset: textureAsset, allowCopy: true, usedTextureFallback: true });
    }

    for (const attempt of attempts) {
      const importedDest = importedUnityAssetPath(attempt.asset, options);
      let copiedDest = '';
      let spriteUuid = importedDest && fs.existsSync(importedDest)
        ? waitForCurrentSpriteFrameUuid(importedDest, options)
        : '';
      if (!spriteUuid) spriteUuid = cocosDb.resolveSpriteByStem(attempt.asset.stem);
      if (!spriteUuid && attempt.allowCopy) {
        copiedDest = copyUnityAssetToCocos(attempt.asset, options, reporter, 'image', 'medium', {
          deferNeedsImportReport: true,
          imageType: 'sprite-frame',
        });
        spriteUuid = waitForCurrentSpriteFrameUuid(copiedDest, options);
      }
      if (spriteUuid) {
        if (!options._spriteFrameAssetFileByUuid) options._spriteFrameAssetFileByUuid = new Map();
        const assetFile = copiedDest || importedDest;
        if (assetFile) options._spriteFrameAssetFileByUuid.set(spriteUuid, assetFile);
        return {
          spriteUuid,
          copiedDest,
          sourceAsset: attempt.asset,
          usedTextureFallback: Boolean(attempt.usedTextureFallback),
        };
      }
    }

    return { spriteUuid: '', copiedDest: '', sourceAsset: spriteAsset, usedTextureFallback: false };
  }

  function reportResolvedUnitySprite(result, spriteAsset, reporter, options) {
    if (!spriteAsset) return '';
    if (!result?.spriteUuid) {
      reporter.medium('SPRITE_UNRESOLVED', spriteAsset.relativePath, '', 'Sprite frame was not found in Cocos assets');
      return '';
    }

    if (result.usedTextureFallback && result.sourceAsset?.relativePath && result.sourceAsset.relativePath !== spriteAsset.relativePath) {
      reporter.low('SPRITE_TEXTURE_FALLBACK_USED', spriteAsset.relativePath, result.sourceAsset.relativePath, 'Unity Sprite asset was resolved through its source texture');
    }
    if (result.copiedDest && result.sourceAsset?.relativePath) {
      reporter.low(
        'SPRITE_SUBASSET_PREPARED',
        result.sourceAsset.relativePath,
        toPosix(path.relative(options.cocosRoot, result.copiedDest)),
        'Sprite asset was copied with a stable Cocos sprite-frame id; refresh/import is still required',
      );
    }
    return result.spriteUuid;
  }

  function emitSpriteRenderer(nodeId, componentId, doc, builder, reporter, options, unityDb, cocosDb) {
    const spriteRef = getField(doc, 'm_Sprite');
    const spriteAsset = unityDb.get(unityRefGuid(spriteRef));
    let spriteUuid = '';
    if (spriteAsset) {
      spriteUuid = reportResolvedUnitySprite(resolveUnitySpriteFrame(spriteAsset, options, unityDb, cocosDb, reporter), spriteAsset, reporter, options);
    }
    const materialRef = getNestedList(doc, 'm_Materials')[0] || null;
    const materialAsset = unityDb.get(unityRefGuid(materialRef));
    const materialUuid = materialAsset && resolveUnitySpriteRendererMaterialUuid
      ? resolveUnitySpriteRendererMaterialUuid(materialAsset, options, unityDb, cocosDb, reporter, '')
      : materialAsset
        ? cocosDb.resolveMaterialByStem(materialAsset.stem)
        : '';
    builder.addSpriteRenderer(
      nodeId,
      componentId,
      spriteUuid,
      materialUuid,
      getField(doc, 'm_Color', { r: 1, g: 1, b: 1, a: 1 }),
      `cmp-sprite-renderer-${componentId}`,
      { enabled: Number(getField(doc, 'm_Enabled', 1) || 0) !== 0 },
    );
  }

  return {
    resolveImportedSpriteAsset,
    isPendingGeneratedSubMeta,
    hasImportedSubMeta,
    subMetaFilesForImportedState,
    uniqueSubMetaId,
    readPrintableStrings,
    readUnitySpriteTextureGuid,
    resolveUnitySpriteTextureAsset,
    resolveUnitySpriteFrame,
    reportResolvedUnitySprite,
    emitSpriteRenderer,
  };
};
