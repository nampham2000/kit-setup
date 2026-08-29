'use strict';

const fs = require('fs');
const path = require('path');
const { cocosRef } = require('./core-utils');
const { SCRIPT_SHAPE_MATCH_THRESHOLD } = require('./constants');
const { mapUnityImageFill } = require('./ui-image-fill-mapper');

module.exports = function createScriptPorter(deps) {
  const {
    hasField,
    getField,
    getTopLevelSerializedFields,
    unityRefGuid,
    resolveUnitySpriteFrame,
    reportResolvedUnitySprite,
    importedUnityAssetPath,
    copyUnityAssetToCocos,
    resolveCurrentFontUuid,
    resolveUnitySpineSkeletonDataUuid,
  } = deps;

  function cocosUuid(uuid, expectedType) {
    return uuid ? { __uuid__: uuid, __expectedType__: expectedType } : null;
  }

  function unityColorToCocos(value) {
    const source = value || {};
    const scale = (channel) => {
      const numeric = Number(channel == null ? 1 : channel);
      return Math.max(0, Math.min(255, numeric <= 1 ? Math.round(numeric * 255) : Math.round(numeric)));
    };
    return {
      __type__: 'cc.Color',
      r: scale(source.r),
      g: scale(source.g),
      b: scale(source.b),
      a: scale(source.a),
    };
  }

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function resolveUnityLabelSizing(doc) {
    const autoSizing = Number(getField(doc, 'm_enableAutoSizing', 0) || 0) !== 0;
    const requested = finiteNumber(getField(doc, 'm_fontSize', 22), 22);
    const sourceBase = finiteNumber(getField(doc, 'm_fontSizeBase', requested), requested);
    const max = finiteNumber(getField(doc, 'm_fontSizeMax', NaN), NaN);
    const fontSize = autoSizing && Number.isFinite(max) ? max : requested;
    return {
      autoSizing,
      fontSize: Math.max(1, Number.isFinite(fontSize) ? fontSize : sourceBase),
      lineHeight: Math.max(1, Number.isFinite(fontSize) ? fontSize : sourceBase),
      overflow: autoSizing ? 2 : undefined,
    };
  }

  function normalizeFontStem(stem) {
    return String(stem || '')
      .replace(/\s+SDF(?:[_ -].*)?$/i, '')
      .replace(/[_ -]+SDF(?:[_ -].*)?$/i, '')
      .trim();
  }

  function readSourceFontGuid(tmpFontAsset) {
    if (!tmpFontAsset?.path || !fs.existsSync(tmpFontAsset.path)) return '';
    const text = fs.readFileSync(tmpFontAsset.path, 'utf8');
    return /m_SourceFontFileGUID:\s*([a-fA-F0-9]+)/.exec(text)?.[1]
      || /sourceFontFileGUID:\s*([a-fA-F0-9]+)/.exec(text)?.[1]
      || '';
  }

  function fontAssetCandidates(unityDb) {
    return [...(unityDb.byGuid?.values?.() || [])].filter((asset) => ['.ttf', '.otf'].includes(asset.ext));
  }

  function resolveTmpSourceFontAsset(tmpFontAsset, unityDb) {
    if (!tmpFontAsset) return null;
    const sourceGuid = readSourceFontGuid(tmpFontAsset);
    const sourceByGuid = unityDb.get(sourceGuid);
    if (sourceByGuid && ['.ttf', '.otf'].includes(sourceByGuid.ext)) return sourceByGuid;

    const wantedStem = normalizeFontStem(tmpFontAsset?.stem);
    const wantedKey = wantedStem.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const sameDir = tmpFontAsset?.path ? path.dirname(tmpFontAsset.path) : '';
    const candidates = fontAssetCandidates(unityDb);
    const match = candidates.find((asset) => (
      path.dirname(asset.path) === sameDir &&
      asset.stem.toLowerCase().replace(/[^a-z0-9]+/g, '') === wantedKey
    )) || candidates.find((asset) => asset.stem.toLowerCase().replace(/[^a-z0-9]+/g, '') === wantedKey);
    return match || null;
  }

  function resolveUnityTmpFontUuid(tmpFontRef, options, unityDb, cocosDb, reporter) {
    const tmpFontAsset = unityDb.get(unityRefGuid(tmpFontRef));
    if (!tmpFontAsset) return '';
    const sourceFontAsset = resolveTmpSourceFontAsset(tmpFontAsset, unityDb);
    if (!sourceFontAsset) {
      reporter.low('TMP_FONT_SOURCE_UNRESOLVED', tmpFontAsset.relativePath, '', 'TextMeshPro font asset source TTF/OTF could not be resolved');
      return '';
    }

    const importedDest = importedUnityAssetPath(sourceFontAsset, options);
    let fontUuid = importedDest && fs.existsSync(importedDest)
      ? resolveCurrentFontUuid(importedDest, options)
      : '';
    if (!fontUuid) fontUuid = cocosDb.resolveFontByStem(sourceFontAsset.stem);
    if (!fontUuid) {
      const copiedDest = copyUnityAssetToCocos(sourceFontAsset, options, reporter, 'font', 'low', { deferNeedsImportReport: true });
      fontUuid = resolveCurrentFontUuid(copiedDest, options);
      if (fontUuid && copiedDest) {
        reporter.low('FONT_ASSET_PREPARED', sourceFontAsset.relativePath, path.relative(options.cocosRoot, copiedDest).replace(/\\/g, '/'), 'Unity font copied to Cocos and wired to Label');
      }
    }
    return fontUuid || '';
  }

  /**
   * Unity serializes `bool` as 0/1 and `Vector2`/`Vector3` as an untagged {x,y[,z]}.
   * Cocos needs a real boolean and a `__type__`-tagged vector, so the declared type
   * of the target field (collected while indexing the Cocos script) is applied here.
   */
  function coerceToCocosFieldType(script, fieldName, value) {
    if (script?.booleanFields?.has(fieldName) && typeof value === 'number') return value !== 0;
    const vectorType = script?.vectorFields?.get(fieldName);
    if (vectorType && value && typeof value === 'object' && !Array.isArray(value)
      && !value.__type__ && !value.__uuid__ && !value.__id__ && 'x' in value && 'y' in value) {
      return vectorType === 'cc.Vec2'
        ? { __type__: 'cc.Vec2', x: Number(value.x) || 0, y: Number(value.y) || 0 }
        : { __type__: 'cc.Vec3', x: Number(value.x) || 0, y: Number(value.y) || 0, z: Number(value.z) || 0 };
    }
    return value;
  }

  function translateUnitySerializedValue(value, builder, reporter, source, fieldName) {
    if (Array.isArray(value)) return value.map((item) => translateUnitySerializedValue(item, builder, reporter, source, fieldName));
    if (value && typeof value === 'object') {
      // Unity serializes LayerMask as { serializedVersion, m_Bits }. Cocos stores the
      // mask as a plain number, so unwrap it instead of emitting a nested object the
      // Cocos deserializer would drop.
      if (Object.prototype.hasOwnProperty.call(value, 'm_Bits')) {
        const bits = Number(value.m_Bits);
        return Number.isFinite(bits) ? bits : 0;
      }
      if (Object.prototype.hasOwnProperty.call(value, 'fileID')) {
        const fileId = deps.unityRefFileId(value);
        if (!fileId) return null;
        if (builder.nodeMapByGameObject.has(fileId)) return cocosRef(builder.nodeMapByGameObject.get(fileId));
        if (builder.nodeMapByTransform.has(fileId)) return cocosRef(builder.nodeMapByTransform.get(fileId));
        if (builder.componentMap.has(fileId)) return cocosRef(builder.componentMap.get(fileId));
        reporter.low('SCRIPT_FIELD_REF_UNRESOLVED', source, fieldName, `Serialized reference ${fileId} could not be mapped yet`);
        return null;
      }
      const out = {};
      for (const [key, child] of Object.entries(value)) out[key] = translateUnitySerializedValue(child, builder, reporter, source, fieldName);
      return out;
    }
    return value;
  }

  function emitSkeletonGraphic(nodeId, componentId, doc, model, builder, reporter, options, unityDb) {
    const skeletonDataUuid = resolveUnitySpineSkeletonDataUuid(getField(doc, 'skeletonDataAsset'), options, unityDb, reporter);
    builder.addComponent(nodeId, 'sp.Skeleton', {
      _customMaterial: null,
      _srcBlendFactor: 2,
      _dstBlendFactor: 4,
      _color: unityColorToCocos(getField(doc, 'm_SkeletonColor', getField(doc, 'm_Color', { r: 1, g: 1, b: 1, a: 1 }))),
      _skeletonData: skeletonDataUuid ? cocosUuid(skeletonDataUuid, 'sp.SkeletonData') : null,
      defaultSkin: String(getField(doc, 'initialSkinName', 'default') || 'default'),
      defaultAnimation: String(getField(doc, 'startingAnimation', '') || ''),
      _premultipliedAlpha: Number(getField(doc, 'pmaVertexColors', 1) || 0) !== 0,
      _timeScale: finiteNumber(getField(doc, 'timeScale', 1), 1),
      _preCacheMode: 0,
      _cacheMode: 0,
      _sockets: [],
      _useTint: Number(getField(doc, 'tintBlack', 0) || 0) !== 0,
      _debugMesh: false,
      _debugBones: false,
      _debugSlots: false,
      _enableBatch: false,
      loop: Number(getField(doc, 'startingLoop', 0) || 0) !== 0,
    }, componentId, `cmp-spine-${componentId}`);

    if (!skeletonDataUuid) {
      reporter.medium('SPINE_DATA_UNRESOLVED', model.file, '', 'Unity SkeletonGraphic was emitted as sp.Skeleton but its SkeletonData asset could not be wired');
      return;
    }

    reporter.low('SPINE_SKELETON_MAPPED', model.file, '', 'Unity SkeletonGraphic was mapped to Cocos sp.Skeleton');
  }

  function emitMonoBehaviour(nodeId, componentId, doc, model, builder, reporter, options, unityDb, cocosDb) {
    if (hasField(doc, 'm_OnClick') || hasField(doc, 'm_Interactable')) {
      builder.addButton(nodeId, componentId, `cmp-button-${componentId}`);
      return;
    }
    if (hasField(doc, 'm_Text') || hasField(doc, 'm_text')) {
      const text = getField(doc, 'm_Text', getField(doc, 'm_text', ''));
      const labelSizing = resolveUnityLabelSizing(doc);
      const fontRef = getField(doc, 'm_fontAsset');
      const tmpFontAsset = unityDb.get(unityRefGuid(fontRef));
      const sourceFontAsset = resolveTmpSourceFontAsset(tmpFontAsset, unityDb);
      const fontUuid = resolveUnityTmpFontUuid(fontRef, options, unityDb, cocosDb, reporter);
      builder.addLabel(nodeId, componentId, text, `cmp-label-${componentId}`, {
        color: getField(doc, 'm_fontColor', getField(doc, 'm_Color', { r: 1, g: 1, b: 1, a: 1 })),
        fontSize: labelSizing.fontSize,
        lineHeight: labelSizing.lineHeight,
        overflow: labelSizing.overflow,
        fontUuid,
        fontFamily: sourceFontAsset?.stem || 'Arial',
      });
      return;
    }
    if (hasField(doc, 'm_Sprite') && (hasField(doc, 'm_Type') || hasField(doc, 'm_FillCenter'))) {
      const spriteRef = getField(doc, 'm_Sprite');
      const spriteAsset = unityDb.get(unityRefGuid(spriteRef));
      const preserveAspect = Number(getField(doc, 'm_PreserveAspect', 0) || 0) !== 0;
      let spriteUuid = '';
      if (spriteAsset) {
        spriteUuid = reportResolvedUnitySprite(resolveUnitySpriteFrame(spriteAsset, options, unityDb, cocosDb, reporter), spriteAsset, reporter, options);
      }
      const imageFill = mapUnityImageFill({
        type: getField(doc, 'm_Type', 0),
        method: getField(doc, 'm_FillMethod', 0),
        amount: getField(doc, 'm_FillAmount', 1),
        origin: getField(doc, 'm_FillOrigin', 0),
        clockwise: getField(doc, 'm_FillClockwise', 1),
      });
      if (imageFill.approximated) {
        reporter.medium(
          'UI_IMAGE_RADIAL_FILL_APPROXIMATED',
          model.file,
          '',
          'Unity Radial90/Radial180 Image fill was mapped to Cocos radial fill; verify the visible arc origin',
        );
      }
      builder.addSprite(
        nodeId,
        componentId,
        spriteUuid,
        getField(doc, 'm_Color', { r: 1, g: 1, b: 1, a: 1 }),
        `cmp-sprite-${componentId}`,
        { preserveAspect, ...imageFill },
      );
      return;
    }

    const scriptRef = getField(doc, 'm_Script');
    const scriptAsset = unityDb.get(unityRefGuid(scriptRef));
    const className = scriptAsset ? path.basename(scriptAsset.path, path.extname(scriptAsset.path)) : '';

    if (className === 'SkeletonGraphic') {
      emitSkeletonGraphic(nodeId, componentId, doc, model, builder, reporter, options, unityDb);
      return;
    }

    if (options.scriptMode === 'skip') {
      reporter.low('SCRIPT_SKIPPED', model.file, '', `MonoBehaviour ${componentId} skipped by --script-mode skip`);
      return;
    }

    if (!scriptAsset) {
      const severity = options.scriptMode === 'require' ? 'high' : 'medium';
      reporter.add(severity, 'SCRIPT_GUID_UNRESOLVED', model.file, '', `MonoBehaviour ${componentId} script guid was not found`);
      return;
    }

    const script = cocosDb.findScriptClass(className);
    if (!script) {
      const severity = options.scriptMode === 'require' ? 'high' : 'medium';
      reporter.add(severity, 'SCRIPT_CLASS_UNRESOLVED', scriptAsset.relativePath, '', `Cocos script class "${className}" was not found; component skipped`);
      return;
    }

    const fields = getTopLevelSerializedFields(doc, options);

    // A MonoBehaviour is matched to a Cocos class by NAME only. Two unrelated
    // classes can share a name (measured: Unity's own CameraController bound to
    // the framework's shared/core/components/CameraController.ts, and all four
    // Unity fields were silently dropped by the Cocos deserializer while the
    // report said high=0). Compare the field sets so a wrong bind is reported.
    const declaredMembers = script.memberNames;
    if (declaredMembers && declaredMembers.size > 0) {
      const fieldNames = Object.keys(fields);
      const unknown = fieldNames.filter((key) => !declaredMembers.has(key));
      const matched = fieldNames.length - unknown.length;
      const matchRatio = fieldNames.length > 0 ? matched / fieldNames.length : 1;

      if (fieldNames.length > 0 && matchRatio < SCRIPT_SHAPE_MATCH_THRESHOLD) {
        reporter.high(
          'SCRIPT_CLASS_SHAPE_MISMATCH',
          scriptAsset.relativePath,
          className,
          `Cocos class "${className}" (${script.relativePath}) declares none of ${unknown.length}/${fieldNames.length} serialized Unity field(s) — likely a different class with the same name`,
          unknown.slice(0, 12).join(', '),
        );
      } else if (unknown.length > 0) {
        reporter.medium(
          'SCRIPT_FIELD_UNKNOWN',
          scriptAsset.relativePath,
          className,
          `${unknown.length} Unity field(s) have no matching member on Cocos class "${className}" and will be dropped on load`,
          unknown.slice(0, 12).join(', '),
        );
      }
    } else {
      reporter.low(
        'SCRIPT_CLASS_SHAPE_UNKNOWN',
        scriptAsset.relativePath,
        className,
        `Could not read any member names from ${script.relativePath}; field-set validation was skipped`,
      );
    }

    const translated = {};
    for (const [key, value] of Object.entries(fields)) {
      if (className === 'MilosMeoController' && key === 'clips' && Array.isArray(value)) {
        const modelAsset = value
          .map((entry) => unityDb.get(unityRefGuid(entry)))
          .find((entry) => entry && ['.fbx', '.gltf', '.glb'].includes(entry.ext));
        const importedClips = modelAsset
          ? cocosDb.resolveModelAnimationsByStem(modelAsset.stem)
          : [];
        if (importedClips.length >= value.length) {
          translated[key] = value.map((_, index) => cocosUuid(importedClips[index].uuid, 'cc.AnimationClip'));
          reporter.low(
            'SCRIPT_MODEL_ANIMATION_CLIPS_WIRED',
            modelAsset.relativePath,
            className,
            `${value.length} embedded Unity model animation references were wired by imported clip order`,
          );
          continue;
        }
      }
      translated[key] = coerceToCocosFieldType(
        script,
        key,
        translateUnitySerializedValue(value, builder, reporter, model.file, key),
      );
    }

    builder.addComponent(nodeId, script.classId, translated, componentId, `cmp-script-${className}-${componentId}`);
  }

  return {
    translateUnitySerializedValue,
    emitMonoBehaviour,
  };
};
