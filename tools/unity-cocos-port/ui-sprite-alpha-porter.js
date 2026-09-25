'use strict';

const fs = require('fs');
const path = require('path');
const { COCOS_MATERIAL_IMPORTER_VERSION } = require('./constants');
const { ensureDir, readJsonIfExists, stableUuid, toPosix } = require('./core-utils');

const TEMPLATE_DIR = path.join(__dirname, 'ui-sprite-alpha-sep');
const TARGET_DIR = path.join('assets', 'unity_imported', 'ui_sprite_alpha_sep');

function cocosUuid(uuid, expectedType) {
  return { __uuid__: uuid, __expectedType__: expectedType };
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function unitySpriteAlpha(value, fallback = 1) {
  const alpha = Number(value?.a);
  if (!Number.isFinite(alpha)) return fallback;
  return clamp01(alpha > 1 ? alpha / 255 : alpha, fallback);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function spriteAlphaTargetDir(options) {
  return path.join(options.cocosRoot, TARGET_DIR);
}

function spriteAlphaEffectPath(options) {
  return path.join(spriteAlphaTargetDir(options), 'ui-sprite-alpha-sep.effect');
}

function spriteAlphaMaterialPath(options) {
  return path.join(spriteAlphaTargetDir(options), 'ui-sprite-alpha-sep.mtl');
}

function ensureEffectAssetMeta(assetFile, options) {
  const metaFile = `${assetFile}.meta`;
  const existing = readJsonIfExists(metaFile) || {};
  const relativePath = toPosix(path.relative(options.cocosRoot, assetFile));
  const meta = {
    ver: existing.ver || '1.0.0',
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
  return meta;
}

function ensureMaterialAssetMeta(assetFile, options) {
  const metaFile = `${assetFile}.meta`;
  const existing = readJsonIfExists(metaFile) || {};
  const relativePath = toPosix(path.relative(options.cocosRoot, assetFile));
  const meta = {
    ver: COCOS_MATERIAL_IMPORTER_VERSION,
    importer: 'material',
    imported: existing.imported ?? true,
    uuid: existing.uuid || stableUuid(`material:${relativePath}`),
    files: Array.isArray(existing.files) && existing.files.length ? existing.files : ['.json'],
    subMetas: {},
    userData: { ...(existing.userData || {}) },
  };
  if (JSON.stringify(existing) !== JSON.stringify(meta)) {
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }
  return meta;
}

function copyTemplate(sourceName, targetFile) {
  const sourceFile = path.join(TEMPLATE_DIR, sourceName);
  const text = fs.readFileSync(sourceFile, 'utf8');
  if (fs.existsSync(targetFile) && fs.readFileSync(targetFile, 'utf8') === text) return false;
  ensureDir(path.dirname(targetFile));
  fs.writeFileSync(targetFile, text, 'utf8');
  return true;
}

function writeMaterialLibraryCache(options, deps, uuid, materialData) {
  const libraryFile = deps.libraryJsonPathForUuid(options, uuid);
  if (!fs.existsSync(libraryFile)) return false;
  fs.writeFileSync(libraryFile, `${JSON.stringify(materialData, null, 2)}\n`, 'utf8');
  return true;
}

function ensureUiSpriteAlphaSepEffect(options, reporter, deps) {
  const effectFile = spriteAlphaEffectPath(options);
  if (options.dryRun) return stableUuid(`effect:${toPosix(path.relative(options.cocosRoot, effectFile))}`);
  if (options._uiSpriteAlphaSepEffectUuid) return options._uiSpriteAlphaSepEffectUuid;

  deps.ensureDirectoryMetas(spriteAlphaTargetDir(options), path.join(options.cocosRoot, 'assets'));
  copyTemplate('ui-sprite-alpha-sep.effect', effectFile);
  const meta = ensureEffectAssetMeta(effectFile, options);
  options._uiSpriteAlphaSepEffectUuid = meta.uuid;
  reporter.low(
    'UI_SPRITE_ALPHA_SEP_EFFECT_PREPARED',
    toPosix(path.relative(options.cocosRoot, effectFile)),
    '',
    'Prepared custom builtin-sprite effect template with u_spriteAlpha',
    meta.uuid,
  );
  return meta.uuid;
}

function ensureUiSpriteAlphaSepMaterial(options, reporter, spriteAlpha, deps) {
  const alpha = clamp01(spriteAlpha, 1);
  if (!options._uiSpriteAlphaSepMaterials) options._uiSpriteAlphaSepMaterials = new Map();
  const key = 'ui-sprite-alpha-sep';
  if (options._uiSpriteAlphaSepMaterials.has(key)) return options._uiSpriteAlphaSepMaterials.get(key);

  const materialFile = spriteAlphaMaterialPath(options);
  if (options.dryRun) {
    const uuid = stableUuid(`material:${toPosix(path.relative(options.cocosRoot, materialFile))}`);
    options._uiSpriteAlphaSepMaterials.set(key, uuid);
    return uuid;
  }

  const effectUuid = ensureUiSpriteAlphaSepEffect(options, reporter, deps);
  const materialData = cloneJson(readJsonIfExists(path.join(TEMPLATE_DIR, 'ui-sprite-alpha-sep.mtl')) || {});
  materialData._name = 'ui-sprite-alpha-sep';
  materialData._effectAsset = cocosUuid(effectUuid, 'cc.EffectAsset');
  materialData._defines = [{
    USE_ALPHA_TEST: false,
    USE_TEXTURE: true,
    CC_USE_EMBEDDED_ALPHA: true,
    IS_GRAY: false,
  }];
  materialData._props = [{
    alphaThreshold: 0.5,
    u_spriteAlpha: alpha,
  }];

  deps.ensureDirectoryMetas(spriteAlphaTargetDir(options), path.join(options.cocosRoot, 'assets'));
  ensureDir(path.dirname(materialFile));
  fs.writeFileSync(materialFile, `${JSON.stringify(materialData, null, 2)}\n`, 'utf8');
  const meta = ensureMaterialAssetMeta(materialFile, options);
  writeMaterialLibraryCache(options, deps, meta.uuid, materialData);
  options._uiSpriteAlphaSepMaterials.set(key, meta.uuid);
  reporter.low(
    'UI_SPRITE_ALPHA_SEP_MATERIAL_CLONED',
    toPosix(path.relative(options.cocosRoot, materialFile)),
    '',
    'Cloned ui-sprite-alpha-sep material for Unity UI Image alpha',
    `default u_spriteAlpha=${alpha}`,
  );
  return meta.uuid;
}

const WORLD_UI_EFFECT_TEMPLATE = path.join(__dirname, 'unity-world-ui-sprite.effect');
const WORLD_UI_EFFECT_PATH = path.join('assets', 'effects', 'UnityWorldUISprite.effect');
const WORLD_UI_MATERIAL_PATH = path.join('assets', 'unity_imported', '_builtin', 'UnityWorldUISprite.mtl');

// Material for UI Images under a Unity WorldSpace Canvas (depth tested, float-output aware). The effect is written
// from the kit template and bound only after Cocos AssetDB imported it; until then sprites keep the default material.
function ensureWorldUiSpriteMaterial(options, reporter, deps) {
  if (options._worldUiSpriteMaterialUuid !== undefined) return options._worldUiSpriteMaterialUuid;
  const effectFile = path.join(options.cocosRoot, WORLD_UI_EFFECT_PATH);
  if (!options.dryRun) {
    const text = fs.readFileSync(WORLD_UI_EFFECT_TEMPLATE, 'utf8');
    ensureDir(path.dirname(effectFile));
    deps.ensureDirectoryMetas(path.dirname(effectFile), path.join(options.cocosRoot, 'assets'));
    if (!fs.existsSync(effectFile) || fs.readFileSync(effectFile, 'utf8') !== text) fs.writeFileSync(effectFile, text, 'utf8');
  }
  const effectMeta = readJsonIfExists(`${effectFile}.meta`);
  if (!(effectMeta?.importer === 'effect' && effectMeta.uuid)) {
    reporter.high('UNITY_WORLD_UI_EFFECT_IMPORT_REQUIRED', toPosix(WORLD_UI_EFFECT_PATH), '',
      'Import assets/effects/UnityWorldUISprite.effect through Cocos AssetDB, then rerun the port so world-space Canvas images depth-test like Unity');
    options._worldUiSpriteMaterialUuid = '';
    return '';
  }
  const materialFile = path.join(options.cocosRoot, WORLD_UI_MATERIAL_PATH);
  const materialData = {
    __type__: 'cc.Material',
    _name: 'UnityWorldUISprite',
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    _effectAsset: cocosUuid(effectMeta.uuid, 'cc.EffectAsset'),
    _techIdx: 0,
    _defines: [{ USE_TEXTURE: true, IS_GRAY: false, CC_USE_EMBEDDED_ALPHA: false }],
    _states: [{ rasterizerState: {}, depthStencilState: {}, blendState: { targets: [{}] } }],
    _props: [{}],
  };
  if (options.dryRun) {
    options._worldUiSpriteMaterialUuid = stableUuid(`material:${toPosix(path.relative(options.cocosRoot, materialFile))}`);
    return options._worldUiSpriteMaterialUuid;
  }
  deps.ensureDirectoryMetas(path.dirname(materialFile), path.join(options.cocosRoot, 'assets'));
  ensureDir(path.dirname(materialFile));
  const serialized = `${JSON.stringify(materialData, null, 2)}\n`;
  if (!fs.existsSync(materialFile) || fs.readFileSync(materialFile, 'utf8') !== serialized) fs.writeFileSync(materialFile, serialized, 'utf8');
  const meta = ensureMaterialAssetMeta(materialFile, options);
  writeMaterialLibraryCache(options, deps, meta.uuid, materialData);
  options._worldUiSpriteMaterialUuid = meta.uuid;
  reporter.low('UNITY_WORLD_UI_SPRITE_MATERIAL', toPosix(path.relative(options.cocosRoot, materialFile)), '',
    'World-space Canvas images use the depth-tested, float-output-aware UnityWorldUISprite material', meta.uuid);
  return meta.uuid;
}

module.exports = function createUiSpriteAlphaPorter(deps) {
  return {
    unitySpriteAlpha,
    ensureUiSpriteAlphaSepMaterial: (options, reporter, spriteAlpha) => (
      ensureUiSpriteAlphaSepMaterial(options, reporter, spriteAlpha, deps)
    ),
    ensureWorldUiSpriteMaterial: (options, reporter) => ensureWorldUiSpriteMaterial(options, reporter, deps),
  };
};
