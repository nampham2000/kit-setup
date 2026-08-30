#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const binarySerializedFile = require('./lib/unity-serialized-file.cjs');
const { createPathBoundary, inspectContainedPath } = require('./lib/path-boundary.cjs');
const { assertUnityPortPreflight } = require('./unity-intel/preflight.cjs');
const {
  ensureCocosEngineFeatures,
  createMcpClient,
  unwrapToolResult,
} = require('./cocos-engine-feature-audit.cjs');
const { collectImportFailures } = require('./verify-assets.cjs');
const {
  ROOT_DIR,
  BUILTIN_DEFAULT_SPRITE_RENDERER_MATERIAL_UUID,
  BUILTIN_DEFAULT_MESH_MATERIAL_UUID,
  BUILTIN_STANDARD_EFFECT_UUID,
  BUILTIN_STANDARD_TRANSPARENT_TECHNIQUE_INDEX,
  COCOS_MATERIAL_IMPORTER_VERSION,
  COCOS_IMAGE_TEXTURE_SUBMETA_ID,
  COCOS_IMAGE_SPRITE_FRAME_SUBMETA_ID,
  UNITY_BUILTIN_EXTRA_GUID,
  BUILTIN_PRIMITIVE_MESH_UUIDS,
  UNITY_BUILTIN_MESH_FILE_ID_TO_PRIMITIVE,
  UNITY_MATERIAL_BASE_TEXTURE_KEYS,
  UNITY_MATERIAL_NORMAL_TEXTURE_KEYS,
  UNITY_MATERIAL_OCCLUSION_TEXTURE_KEYS,
  UNITY_MATERIAL_EMISSIVE_TEXTURE_KEYS,
  COCOS_DEFAULT_LAYER_VALUE,
  COCOS_CUSTOM_LAYER_MAX_BIT,
  COCOS_BUILTIN_LAYER_ALIASES,
  UNITY_3D_PREFAB_COMPONENT_HINTS,
  UNITY_3D_COLLIDER_DEPTH,
  UNITY_CLASS,
  DEFAULT_MODEL_IMPORT_WAIT_MS,
} = require('./unity-cocos-port/constants');
const {
  fail,
  log,
  toPosix,
  normalizeKey,
  randomUuid,
  stableUuid,
  randomLocalId,
  stableSubAssetId,
  ensureDir,
  copyAssetIfChanged,
  readJsonIfExists,
  csvEscape,
} = require('./unity-cocos-port/core-utils');
const { Reporter } = require('./unity-cocos-port/reporter');
const createAssetImportPorter = require('./unity-cocos-port/asset-import-porter');
const createMaterialPorter = require('./unity-cocos-port/material-porter');
const createSpritePorter = require('./unity-cocos-port/sprite-porter');
const createColliderPorter = require('./unity-cocos-port/collider-porter');
const createRendererPorter = require('./unity-cocos-port/renderer-porter');
const createParticlePorter = require('./unity-cocos-port/particle-porter');
const createLightPorter = require('./unity-cocos-port/light-porter');
const createAnimationPorter = require('./unity-cocos-port/animation-porter');
const createFontPorter = require('./unity-cocos-port/font-porter');
const createScriptPorter = require('./unity-cocos-port/script-porter');
const { PortCache } = require('./unity-cocos-port/port-cache');
const createUiSpriteAlphaPorter = require('./unity-cocos-port/ui-sprite-alpha-porter');
const createComponentDispatcher = require('./unity-cocos-port/component-dispatcher');
const createRuntimeComponentPorter = require('./unity-cocos-port/runtime-component-porter');
const {
  scaffoldCSharpToTypeScript,
  scaffoldFile
} = require('./unity-cocos-port/script-scaffolder');
const {
  applyParticleRendererMaterial,
  applyUnityParticleDataToCocos,
  applyUnitySerializedOverrides,
  parseUnityParticleDoc,
  parseUnityRendererDoc,
} = require('./unity-cocos-port/particle-system-converter');

const {
  importedUnityAssetPath: importedUnityAssetPathImpl,
  ensureAssetMeta: ensureAssetMetaImpl,
  copyUnityAssetToCocos: copyUnityAssetToCocosImpl,
  findCommand: findCommandImpl,
  convertFbxToGlb: convertFbxToGlbImpl,
  handleMissingModel: handleMissingModelImpl,
} = createAssetImportPorter({
  ensureDirectoryMetas,
  ensurePreparedAssetMeta,
  recoverModelMetaFromLibrary,
  waitForImportedModelAsset,
});

const {
  syncImportedMaterialLibraryCache: syncImportedMaterialLibraryCacheImpl,
  convertUnityMaterialToCocos: convertUnityMaterialToCocosImpl,
  resolveUnityMaterialUuid: resolveUnityMaterialUuidImpl,
  resolveUnitySpriteRendererMaterialUuid: resolveUnitySpriteRendererMaterialUuidImpl,
  resolveUnityParticleMaterial: resolveUnityParticleMaterialImpl,
} = createMaterialPorter({
  parseUnityScalar,
  parseUnityYaml,
  getField,
  unityRefGuid,
  importedUnityAssetPath: importedUnityAssetPathImpl,
  resolveCurrentStandaloneMaterialUuid,
  firstSubMetaRecord,
  copyUnityAssetToCocos: copyUnityAssetToCocosImpl,
  ensureDirectoryMetas,
  ensureMaterialAssetMeta,
  libraryJsonPathForUuid,
  getIndentedBlock,
});

const {
  resolveImportedSpriteAsset: resolveImportedSpriteAssetImpl,
  isPendingGeneratedSubMeta: isPendingGeneratedSubMetaImpl,
  hasImportedSubMeta: hasImportedSubMetaImpl,
  subMetaFilesForImportedState: subMetaFilesForImportedStateImpl,
  uniqueSubMetaId: uniqueSubMetaIdImpl,
  readPrintableStrings: readPrintableStringsImpl,
  readUnitySpriteTextureGuid: readUnitySpriteTextureGuidImpl,
  resolveUnitySpriteTextureAsset: resolveUnitySpriteTextureAssetImpl,
  resolveUnitySpriteFrame: resolveUnitySpriteFrameImpl,
  reportResolvedUnitySprite: reportResolvedUnitySpriteImpl,
  emitSpriteRenderer: emitSpriteRendererImpl,
} = createSpritePorter({
  firstSubMetaRecord,
  firstImportedSubMetaRecord,
  importedUnityAssetPath: importedUnityAssetPathImpl,
  waitForCurrentSpriteFrameUuid,
  copyUnityAssetToCocos: copyUnityAssetToCocosImpl,
  resolveUnitySpriteRendererMaterialUuid: resolveUnitySpriteRendererMaterialUuidImpl,
  unityRefGuid,
  getField,
  getNestedList,
});

const {
  emitRigidbody2D: emitRigidbody2DImpl,
  emitCircleCollider2D: emitCircleCollider2DImpl,
  emitCapsuleCollider2D: emitCapsuleCollider2DImpl,
  emitEdgeCollider2D: emitEdgeCollider2DImpl,
  emitBoxCollider2D: emitBoxCollider2DImpl,
  emitBoxCollider: emitBoxColliderImpl,
  emitRigidbody: emitRigidbodyImpl,
  emitCharacterController: emitCharacterControllerImpl,
  emitSphereCollider: emitSphereColliderImpl,
  emitCapsuleCollider: emitCapsuleColliderImpl,
  emitPolygonCollider2D: emitPolygonCollider2DImpl,
  emitMeshCollider: emitMeshColliderImpl,
  emitHingeJoint: emitHingeJointImpl,
  emitFixedJoint: emitFixedJointImpl,
  emitSpringJoint: emitSpringJointImpl,
} = createColliderPorter({
  getField,
  getIndentedBlock,
  parseUnityPolygonColliderPaths,
  boundsForUnityPolygonPaths,
  unityRefGuid,
  resolveUnityPhysicsMaterialUuid,
  resolveUnityBuiltinMeshUuid,
  resolveBuiltinPrimitiveMeshUuid,
  importedUnityAssetPath: importedUnityAssetPathImpl,
  copyUnityAssetToCocos: copyUnityAssetToCocosImpl,
  handleMissingModel: handleMissingModelImpl,
  resolveLibraryAssetUuid,
});

const {
  emitSyntheticModelRenderer: emitSyntheticModelRendererImpl,
  emitMeshRenderer: emitMeshRendererImpl,
} = createRendererPorter({
  resolveUnityMaterialUuids,
  resolveUnityMaterialUuid,
  resolveUnityBuiltinMeshUuid,
  resolveBuiltinPrimitiveMeshUuid,
  importedUnityAssetPath: importedUnityAssetPathImpl,
  copyUnityAssetToCocos: copyUnityAssetToCocosImpl,
  handleMissingModel: handleMissingModelImpl,
  resolveLibraryAssetUuid,
  recordPendingMeshRepair,
  getField,
  getNestedList,
  unityRefGuid,
  unityRefFileId,
});

const { emitParticleSystem: emitParticleSystemImpl } = createParticlePorter({
  handleMissingModel: handleMissingModelImpl,
  recordPendingMeshRepair,
  resolveUnityBuiltinMeshUuid,
  resolveUnityParticleMaterial,
  unityRefGuid,
  unityRefFileId,
});
const { emitLight: emitLightImpl } = createLightPorter({ getField });
const { emitAnimator: emitAnimatorImpl } = createAnimationPorter({
  parseUnityYaml,
  getField,
  parseUnityScalar,
  unityRefGuid,
  unityRefFileId,
  ensureDirectoryMetas,
  getNestedList,
});
const fontPorter = createFontPorter({
  getField,
  hasField,
  unityRefGuid,
  importedUnityAssetPath: importedUnityAssetPathImpl,
  copyUnityAssetToCocos: copyUnityAssetToCocosImpl,
  resolveCurrentFontUuid,
  ensureDirectoryMetas,
  ensureAssetMeta: ensureAssetMetaImpl,
});
const {
  translateUnitySerializedValue: translateUnitySerializedValueImpl,
  emitMonoBehaviour: emitMonoBehaviourImpl,
} = createScriptPorter({
  hasField,
  getField,
  getTopLevelSerializedFields,
  unityRefGuid,
  unityRefFileId,
  resolveUnitySpriteFrame: resolveUnitySpriteFrameImpl,
  reportResolvedUnitySprite: reportResolvedUnitySpriteImpl,
  importedUnityAssetPath: importedUnityAssetPathImpl,
  copyUnityAssetToCocos: copyUnityAssetToCocosImpl,
  resolveCurrentFontUuid,
  resolveUnitySpineSkeletonDataUuid,
  resolveUnityLabelConfig: fontPorter.resolveLabelConfig,
  isUnityTextEffect: fontPorter.isTextEffect,
});

const {
  unitySpriteAlpha,
  ensureUiSpriteAlphaSepMaterial,
} = createUiSpriteAlphaPorter({
  ensureDirectoryMetas,
  libraryJsonPathForUuid,
});

const runtimeComponentPorter = createRuntimeComponentPorter({
  ensureDirectoryMetas,
  syncImportedMaterialLibraryCache,
});

const componentDispatcher = createComponentDispatcher({
  emitSyntheticModelRenderer,
  emitParticleSystem,
  emitMeshRenderer,
  emitMeshCollider,
  emitSpriteRenderer,
  emitLight,
  emitAnimator,
  emitMonoBehaviour,
  emitRigidbody2D,
  emitCircleCollider2D,
  emitCapsuleCollider2D,
  emitEdgeCollider2D,
  emitPolygonCollider2D,
  emitBoxCollider2D,
  emitBoxCollider,
  emitRigidbody,
  emitCharacterController,
  emitSphereCollider,
  emitCapsuleCollider,
  emitHingeJoint,
  emitFixedJoint,
  emitSpringJoint,
  emitCanvas,
});

function printHelp() {
  console.log(`
Unity -> Cocos Porting Suite

Usage:
  node playable-shared-kit/tools/unity-cocos-port.cjs port --src <UnityPrefab> --out <CocosPrefab> [options]
  node playable-shared-kit/tools/unity-cocos-port.cjs scaffold-script --src <CSharpFileOrFolder> --out <TsFolder>
  node playable-shared-kit/tools/unity-cocos-port.cjs smart-port --src <UnityFolder> --out assets/ [options]
  node playable-shared-kit/tools/unity-cocos-port.cjs doctor [options]

Options:
  --unity-root <path>       Unity Assets folder. Default: inferred from --src.
  --cocos-root <path>       Cocos project root. Default: current repo root.
  --report <path>           CSV report path. Default: .unity/port-report.csv.
  --overwrite               Allow replacing an existing output prefab.
  --dry-run                 Build and validate in memory, but do not write prefab/meta.
  --recursive               Recursively inspect nested prefab/model/controller dependencies.
  --copy-assets             Copy unresolved Unity assets into the Cocos assets folder when possible.
  --convert-fbx-fallback    If FBX has no Cocos import, try FBX2glTF/assimp/Blender to create a GLB fallback.
  --model-import-wait-ms    Wait for Cocos to populate copied model sub-assets. Default: 10000.
  --script-mode <mode>      skip | wire-if-present | require. Default: wire-if-present.
  --no-cache                Bỏ qua cache tăng dần (.unity/port-cache.json).
  --no-import-wait          Không chờ Cocos Creator import asset (= --model-import-wait-ms 0).
  --no-engine-feature-repair Chỉ port asset/code; không tự audit/repair Feature Cropping sau port.
  --no-engine-feature-restart Cho phép sửa Profile/engine.json nhưng để trạng thái pending, không restart Editor.
  --physics-backend <name>  Override có kiểm tra: physics-builtin | physics-cannon | physics-ammo | physics-physx.
  --force-physics-backend   Chấp nhận override dù tool phát hiện mất hành vi (được ghi rõ trong report).
  --jobs <n>                Chạy song song n tiến trình con cho batch prefab.
  --quiet                   Chỉ in tổng kết (ít token hơn cho AI agent).
  --strip-private-prefix    Map Unity serialized _field to Cocos field when wiring custom scripts. Default.
  --no-strip-private-prefix Preserve leading underscore in custom script fields.
  --layer-map <json>        JSON object overriding Unity layer index to Cocos layer name/value.

Examples:
  node playable-shared-kit/tools/unity-cocos-port.cjs port --src "D:/_Projects/Unity/TapeTap/Assets/_Game/Prefabs/Gameplay/Box/Box.prefab" --out assets/prefabs/Gameplay/Box/Box.prefab --overwrite --recursive
  node playable-shared-kit/tools/unity-cocos-port.cjs port --src "D:/Unity/Game/Assets/_Game/Prefabs" --out assets/prefabs --overwrite --recursive
  node playable-shared-kit/tools/unity-cocos-port.cjs port --src "D:/Unity/Game/Assets/Foo.prefab" --out assets/prefabs/Foo.prefab --dry-run --report temp/foo-report.csv
`);
}

const CLI_PATH_VALUE_OPTIONS = new Set(['--src', '--out', '--unity-root', '--cocos-root', '--report']);
/** Words the member-name scan can match that are not class members. */
const TS_NON_MEMBER_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'class', 'const', 'let', 'var',
  'function', 'import', 'export', 'new', 'typeof', 'else', 'do', 'try', 'throw',
  'case', 'default', 'break', 'continue', 'constructor', 'super', 'this', 'await',
]);
const COCOS_CAMERA_PROJECTION_ORTHO = 0;
const COCOS_CAMERA_PROJECTION_PERSPECTIVE = 1;

function splitEmbeddedOption(text) {
  const match = String(text).match(/^(--[A-Za-z0-9][A-Za-z0-9-]*)(?:=(.*)|\s+(.*))?$/);
  if (!match) return null;
  return {
    option: match[1],
    value: match[2] !== undefined ? match[2] : match[3],
  };
}

function collectEscapedPathOptionValue(option, valueStart, argv, nextIndex) {
  if (!CLI_PATH_VALUE_OPTIONS.has(option) || valueStart === undefined) {
    return { tokens: valueStart === undefined ? [] : [valueStart], nextIndex };
  }

  const parts = [String(valueStart)];
  let joined = parts.join(' ');
  let quoteIndex = joined.indexOf('"');
  let index = nextIndex;
  while (quoteIndex === -1 && index < argv.length && !String(argv[index]).startsWith('--')) {
    parts.push(String(argv[index]));
    index += 1;
    joined = parts.join(' ');
    quoteIndex = joined.indexOf('"');
  }

  if (quoteIndex === -1) return { tokens: [String(valueStart)], nextIndex };

  const tokens = [`${joined.slice(0, quoteIndex)}\\`];
  const tail = joined.slice(quoteIndex + 1).trim();
  if (tail) {
    const split = splitEmbeddedOption(tail);
    if (split) {
      tokens.push(split.option);
      const collected = collectEscapedPathOptionValue(split.option, split.value, argv, index);
      tokens.push(...collected.tokens);
      index = collected.nextIndex;
    } else {
      tokens.push(tail);
    }
  }

  return { tokens, nextIndex: index };
}

function repairEscapedPathValueToken(token, argv, nextIndex) {
  const raw = String(token);
  const quoteIndex = raw.indexOf('"');
  if (quoteIndex === -1) return { tokens: [raw], nextIndex };

  const tokens = [`${raw.slice(0, quoteIndex)}\\`];
  const tail = raw.slice(quoteIndex + 1).trim();
  if (!tail) return { tokens, nextIndex };

  const split = splitEmbeddedOption(tail);
  if (!split) {
    tokens.push(tail);
    return { tokens, nextIndex };
  }

  tokens.push(split.option);
  const collected = collectEscapedPathOptionValue(split.option, split.value, argv, nextIndex);
  tokens.push(...collected.tokens);
  return { tokens, nextIndex: collected.nextIndex };
}

// Windows native argv parsing treats a quoted path ending in "\" as an escaped
// quote. Recover that shape for path-valued options before normal CLI parsing.
function repairWindowsEscapedTrailingBackslashArgs(argv) {
  if (process.platform !== 'win32') return argv;

  const repaired = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    const inlinePathOption = [...CLI_PATH_VALUE_OPTIONS].find((option) => arg.startsWith(`${option}=`) && arg.includes('"'));
    if (inlinePathOption) {
      repaired.push(inlinePathOption);
      const result = repairEscapedPathValueToken(arg.slice(inlinePathOption.length + 1), argv, i + 1);
      repaired.push(...result.tokens);
      i = result.nextIndex - 1;
      continue;
    }

    if (CLI_PATH_VALUE_OPTIONS.has(repaired[repaired.length - 1]) && arg.includes('"')) {
      const result = repairEscapedPathValueToken(arg, argv, i + 1);
      repaired.push(...result.tokens);
      i = result.nextIndex - 1;
      continue;
    }

    repaired.push(arg);
  }

  return repaired;
}

function parseArgs(argv) {
  argv = repairWindowsEscapedTrailingBackslashArgs(argv);
  const command = argv[0] && !String(argv[0]).startsWith('-') ? argv[0] : 'help';
  const options = {
    command,
    cocosRoot: ROOT_DIR,
    unityRoot: '',
    src: '',
    out: '',
    report: path.join(ROOT_DIR, '.unity', 'port-report.csv'),
    reportExplicit: false,
    overwrite: false,
    dryRun: false,
    recursive: false,
    copyAssets: false,
    convertFbxFallback: false,
    modelImportWaitMs: DEFAULT_MODEL_IMPORT_WAIT_MS,
    scriptMode: 'wire-if-present',
    stripPrivatePrefix: true,
    layerMap: {},
    engineFeatureRepair: true,
    engineFeatureRestart: true,
    physicsBackend: '',
    forcePhysicsBackend: false,
  };

  const optionStartIndex = command === 'help' && argv[0] && String(argv[0]).startsWith('-') ? 0 : 1;
  for (let i = optionStartIndex; i < argv.length; i++) {
    const arg = argv[i];
    const readValue = (name) => {
      const value = argv[i + 1];
      if (!value) fail(`Missing value for ${name}`);
      i += 1;
      return value;
    };

    if (arg === '--help' || arg === '-h') {
      options.command = 'help';
      continue;
    }
    if (arg === '--src') {
      options.src = readValue(arg);
      continue;
    }
    if (arg.startsWith('--src=')) {
      options.src = arg.slice('--src='.length);
      continue;
    }
    if (arg === '--out') {
      options.out = readValue(arg);
      continue;
    }
    if (arg.startsWith('--out=')) {
      options.out = arg.slice('--out='.length);
      continue;
    }
    if (arg === '--unity-root') {
      options.unityRoot = readValue(arg);
      continue;
    }
    if (arg.startsWith('--unity-root=')) {
      options.unityRoot = arg.slice('--unity-root='.length);
      continue;
    }
    if (arg === '--cocos-root') {
      options.cocosRoot = path.resolve(readValue(arg));
      continue;
    }
    if (arg.startsWith('--cocos-root=')) {
      options.cocosRoot = path.resolve(arg.slice('--cocos-root='.length));
      continue;
    }
    if (arg === '--report') {
      options.report = path.resolve(readValue(arg));
      options.reportExplicit = true;
      continue;
    }
    if (arg.startsWith('--report=')) {
      options.report = path.resolve(arg.slice('--report='.length));
      options.reportExplicit = true;
      continue;
    }
    if (arg === '--overwrite') {
      options.overwrite = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--no-cache') {
      options.noCache = true;
      continue;
    }
    if (arg === '--no-import-wait') {
      // Tương đương --model-import-wait-ms 0: dùng khi Cocos Creator không mở.
      options.modelImportWaitMs = 0;
      continue;
    }
    if (arg === '--no-engine-feature-repair') {
      options.engineFeatureRepair = false;
      continue;
    }
    if (arg === '--no-engine-feature-restart') {
      options.engineFeatureRestart = false;
      continue;
    }
    if (arg === '--physics-backend') {
      options.physicsBackend = readValue(arg);
      continue;
    }
    if (arg.startsWith('--physics-backend=')) {
      options.physicsBackend = arg.slice('--physics-backend='.length);
      continue;
    }
    if (arg === '--force-physics-backend') {
      options.forcePhysicsBackend = true;
      continue;
    }
    if (arg === '--jobs' || arg.startsWith('--jobs=')) {
      const raw = arg.startsWith('--jobs=') ? arg.slice('--jobs='.length) : readValue(arg);
      const jobs = Number(raw);
      if (!Number.isFinite(jobs) || jobs < 1) fail('--jobs phải là số nguyên >= 1');
      options.jobs = Math.floor(jobs);
      continue;
    }
    if (arg === '--shard' || arg.startsWith('--shard=')) {
      // Nội bộ: <index>/<total>. Tiến trình cha dùng để chia việc cho con.
      const raw = arg.startsWith('--shard=') ? arg.slice('--shard='.length) : readValue(arg);
      const m = /^(\d+)\/(\d+)$/.exec(String(raw).trim());
      if (!m) fail('--shard phải có dạng <index>/<total>, ví dụ 0/4');
      options.shard = { index: Number(m[1]), total: Number(m[2]) };
      if (options.shard.index >= options.shard.total) fail('--shard index phải nhỏ hơn total');
      continue;
    }
    if (arg === '--quiet') {
      options.quiet = true;
      continue;
    }
    if (arg === '--recursive') {
      options.recursive = true;
      continue;
    }
    if (arg === '--copy-assets') {
      options.copyAssets = true;
      continue;
    }
    if (arg === '--convert-fbx-fallback') {
      options.convertFbxFallback = true;
      continue;
    }
    if (arg === '--model-import-wait-ms') {
      options.modelImportWaitMs = Math.max(0, Number(readValue(arg)) || 0);
      continue;
    }
    if (arg.startsWith('--model-import-wait-ms=')) {
      options.modelImportWaitMs = Math.max(0, Number(arg.slice('--model-import-wait-ms='.length)) || 0);
      continue;
    }
    if (arg === '--script-mode') {
      options.scriptMode = readValue(arg);
      continue;
    }
    if (arg.startsWith('--script-mode=')) {
      options.scriptMode = arg.slice('--script-mode='.length);
      continue;
    }
    if (arg === '--strip-private-prefix') {
      options.stripPrivatePrefix = true;
      continue;
    }
    if (arg === '--no-strip-private-prefix') {
      options.stripPrivatePrefix = false;
      continue;
    }
    if (arg === '--layer-map') {
      options.layerMap = JSON.parse(readValue(arg));
      continue;
    }
    if (arg.startsWith('--layer-map=')) {
      options.layerMap = JSON.parse(arg.slice('--layer-map='.length));
      continue;
    }
    if (!arg.startsWith('-')) {
      if (!options.src) {
        options.src = arg;
        continue;
      }
      if (!options.out) {
        options.out = arg;
        continue;
      }
    }
    fail(`Unknown option: ${arg}`);
  }

  const validCommands = ['help', 'port', 'doctor', 'scaffold-script', 'port-script', 'smart-port', 'auto'];
  if (!validCommands.includes(options.command)) fail(`Unknown command: ${options.command}`);
  if (!['skip', 'wire-if-present', 'require'].includes(options.scriptMode)) {
    fail('--script-mode must be skip, wire-if-present, or require');
  }
  if (options.physicsBackend && !['physics-builtin', 'physics-cannon', 'physics-ammo', 'physics-physx'].includes(options.physicsBackend)) {
    fail('--physics-backend must be physics-builtin, physics-cannon, physics-ammo, or physics-physx');
  }

  if (options.src) options.src = path.resolve(options.src);
  if (options.out) options.out = path.resolve(options.cocosRoot, options.out);
  if (!options.unityRoot && options.src) options.unityRoot = inferUnityRoot(options.src);
  if (options.unityRoot) options.unityRoot = path.resolve(options.unityRoot);

  return options;
}

function inferUnityRoot(src) {
  const normalized = toPosix(path.resolve(src));
  const marker = '/Assets/';
  const idx = normalized.toLowerCase().indexOf(marker.toLowerCase());
  if (idx >= 0) return normalized.slice(0, idx + marker.length - 1);
  if (path.basename(normalized).toLowerCase() === 'assets') return path.resolve(src);
  return path.dirname(src);
}

function inferUnityProjectRoot(unityRoot) {
  const resolved = path.resolve(unityRoot || '');
  if (!resolved) return '';
  if (path.basename(resolved).toLowerCase() === 'assets') return path.dirname(resolved);
  if (fs.existsSync(path.join(resolved, 'Assets')) && fs.existsSync(path.join(resolved, 'ProjectSettings'))) return resolved;
  return path.dirname(resolved);
}

function getConfiguredLayerMapping(layerMap, unityLayer) {
  if (!layerMap || typeof layerMap !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(layerMap, unityLayer)) return layerMap[unityLayer];
  const key = String(unityLayer);
  if (Object.prototype.hasOwnProperty.call(layerMap, key)) return layerMap[key];
  return undefined;
}

function loadUnityLayerNames(unityRoot) {
  const layers = new Map();
  if (!unityRoot) return layers;

  const projectRoot = inferUnityProjectRoot(unityRoot);
  if (!projectRoot) return layers;

  const tagManagerFile = path.join(projectRoot, 'ProjectSettings', 'TagManager.asset');
  if (!fs.existsSync(tagManagerFile)) return layers;

  let source = '';
  try {
    source = fs.readFileSync(tagManagerFile, 'utf8');
  } catch {
    return layers;
  }

  let inLayers = false;
  let layerIndex = 0;
  for (const rawLine of source.replace(/\r\n/g, '\n').split('\n')) {
    if (!inLayers) {
      if (/^\s*layers:\s*$/.test(rawLine)) {
        inLayers = true;
        layerIndex = 0;
      }
      continue;
    }

    const match = /^\s*-\s*(.*)$/.exec(rawLine);
    if (!match) {
      if (/^\s*\S/.test(rawLine)) break;
      continue;
    }

    const layerName = String(parseUnityScalar(match[1]) || '').trim();
    layers.set(layerIndex, layerName);
    layerIndex += 1;
  }

  return layers;
}

function getUnityLayerNames(options) {
  if (!options._unityLayerNames) options._unityLayerNames = loadUnityLayerNames(options.unityRoot);
  return options._unityLayerNames;
}

function cocosProjectSettingsFile(root) {
  return path.join(root, 'settings', 'v2', 'packages', 'project.json');
}

function getCocosDesignResolution(options) {
  if (options._cocosDesignResolution !== undefined) return options._cocosDesignResolution;
  const project = readJsonIfExists(cocosProjectSettingsFile(options.cocosRoot));
  const resolution = project?.general?.designResolution;
  const width = finiteNumber(resolution?.width, 0);
  const height = finiteNumber(resolution?.height, 0);
  options._cocosDesignResolution = width > 0 && height > 0 ? { x: width, y: height } : null;
  return options._cocosDesignResolution;
}

function bitFromLayerValue(value) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) return null;
  const bit = Math.log2(numericValue);
  if (!Number.isInteger(bit) || bit < 0 || bit > COCOS_CUSTOM_LAYER_MAX_BIT) return null;
  if ((1 << bit) !== numericValue) return null;
  return bit;
}

function chooseCocosCustomLayerBit(usedBits, preferredBit) {
  const preferred = Number(preferredBit);
  if (Number.isInteger(preferred) && preferred >= 0 && preferred <= COCOS_CUSTOM_LAYER_MAX_BIT && !usedBits.has(preferred)) {
    return preferred;
  }
  for (let bit = 0; bit <= COCOS_CUSTOM_LAYER_MAX_BIT; bit += 1) {
    if (!usedBits.has(bit)) return bit;
  }
  return null;
}

function trackAddedCocosCustomLayer(options, layerName, value, source) {
  if (options.dryRun) return;
  if (!options._addedCocosCustomLayers) options._addedCocosCustomLayers = new Map();

  const name = String(layerName || '').trim();
  if (!name || options._addedCocosCustomLayers.has(name)) return;

  options._addedCocosCustomLayers.set(name, {
    name,
    value: Number(value),
    source: source || '',
  });
}

function ensureCocosCustomLayer(options, cocosDb, reporter, layerName, preferredBit, source) {
  const name = String(layerName || '').trim();
  if (!name) return null;

  for (const builtin of COCOS_BUILTIN_LAYER_ALIASES) {
    if (builtin.names.includes(name)) return builtin.value;
  }

  const projectFile = cocosProjectSettingsFile(options.cocosRoot);
  const projectSettings = readJsonIfExists(projectFile) || {};
  const projectLayers = Array.isArray(projectSettings.layer) ? [...projectSettings.layer] : [];
  const hadNamedLayer = projectLayers.some((layer) => String(layer?.name || '') === name);

  let bit = null;
  for (const layer of projectLayers) {
    if (layer?.name !== name) continue;
    const projectBit = bitFromLayerValue(layer?.value);
    if (projectBit != null) {
      bit = projectBit;
      break;
    }
  }

  const usedBits = new Set();
  for (const layer of projectLayers) {
    const projectBit = bitFromLayerValue(layer?.value);
    if (projectBit != null) usedBits.add(projectBit);
  }

  if (bit != null) usedBits.delete(bit);

  bit = bit ?? chooseCocosCustomLayerBit(usedBits, preferredBit);
  if (bit == null) return null;

  let changed = false;
  const value = 1 << bit;
  const nextProjectLayers = projectLayers.filter((layer) => String(layer?.name || '') !== name);
  nextProjectLayers.push({ name, value });
  nextProjectLayers.sort((left, right) => Number(left.value) - Number(right.value) || String(left.name).localeCompare(String(right.name)));
  if (JSON.stringify(nextProjectLayers) !== JSON.stringify(projectLayers)) changed = true;

  projectSettings.__version__ = projectSettings.__version__ || '1.0.6';
  projectSettings.layer = nextProjectLayers;

  if (!options.dryRun && changed) {
    ensureDir(path.dirname(projectFile));
    fs.writeFileSync(projectFile, `${JSON.stringify(projectSettings, null, 2)}\n`, 'utf8');
    if (!hadNamedLayer) trackAddedCocosCustomLayer(options, name, value, source);
  }

  cocosDb.registerLayer(name, value);
  return value;
}

function splitTopLevel(text, delimiter) {
  const result = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    if (ch === '}' || ch === ']') depth -= 1;
    if (ch === delimiter && depth === 0) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') result.push(current.trim());
  return result;
}

function parseUnityScalar(raw, keyHint = '') {
  let value = String(raw ?? '').trim();
  if (value === '') return '';
  if (!value.startsWith('"') && !value.startsWith("'")) {
    const commentIdx = value.indexOf('#');
    if (commentIdx >= 0) {
      value = value.slice(0, commentIdx).trim();
    }
  }
  if (value === '') return '';
  if (keyHint === 'fileID') return value === '0' ? '' : value;
  if (keyHint === 'guid') return value;
  if (value === '[]') return [];
  if (value === '{}') return {};
  if (value === 'null') return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    value = value.slice(1, -1).trim();
    if (!value) return {};
    const obj = {};
    for (const part of splitTopLevel(value, ',')) {
      const idx = part.indexOf(':');
      if (idx < 0) continue;
      const key = part.slice(0, idx).trim();
      obj[key] = parseUnityScalar(part.slice(idx + 1), key);
    }
    return obj;
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return Number(value);
  return value;
}

/**
 * Cache text YAML dựng lại từ asset nhị phân — mỗi file chỉ giải một lần dù
 * porter đọc lại nhiều lượt (material được tra theo từng renderer).
 */
const BINARY_YAML_CACHE = new Map();

/**
 * Đọc asset Unity dạng text HOẶC nhị phân.
 *
 * Package Asset Store thường ship với Asset Serialization = Force Binary. Trước
 * đây `readFileSync(file, 'utf8')` trả mojibake, không khớp `--- !u!`, nên hàm
 * trả mảng rỗng và porter lặng lẽ rơi về material mặc định. Giờ file nhị phân
 * được giải theo type tree rồi dựng lại thành text YAML, để mọi helper regex
 * bên dưới dùng chung một đường đọc đã được kiểm chứng.
 */
function readUnityAssetText(file) {
  if (!binarySerializedFile.isBinarySerializedFile(file)) {
    return fs.readFileSync(file, 'utf8');
  }
  let stamp = '0';
  try {
    const st = fs.statSync(file);
    stamp = `${st.size}:${st.mtimeMs}`;
  } catch (e) { /* file biến mất giữa chừng — cứ giải lại */ }
  const key = `${file}::${stamp}`;
  if (BINARY_YAML_CACHE.has(key)) return BINARY_YAML_CACHE.get(key);
  const parsed = binarySerializedFile.parseBinaryUnityFile(file);
  const text = parsed.ok ? binarySerializedFile.binaryDocsToUnityYaml(parsed.docs) : '';
  BINARY_YAML_CACHE.set(key, text);
  return text;
}

function parseUnityYaml(file) {
  const text = readUnityAssetText(file).replace(/\r\n/g, '\n');
  const docs = [];
  let current = null;
  for (const line of text.split('\n')) {
    const header = /^--- !u!(\d+) &(-?\d+)(?:\s+stripped)?/.exec(line);
    if (header) {
      if (current) docs.push(current);
      current = {
        classId: Number(header[1]),
        fileId: header[2],
        stripped: /\sstripped\s*$/.test(line),
        className: UNITY_CLASS[Number(header[1])] || `UnityClass${header[1]}`,
        typeName: '',
        lines: [],
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) docs.push(current);

  for (const doc of docs) {
    const typeLine = doc.lines.find((line) => /^[A-Za-z0-9_]+:\s*$/.test(line));
    if (typeLine) doc.typeName = typeLine.replace(':', '').trim();
  }

  return docs;
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasField(doc, key) {
  const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*:`);
  return doc.lines.some((line) => pattern.test(line));
}

function getField(doc, key, fallback = undefined) {
  const pattern = new RegExp(`^(\\s*)${escapeRegex(key)}\\s*:\\s*(.*)$`);
  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i];
    const match = pattern.exec(line);
    if (!match) continue;
    const value = match[2].trim();
    if (value && value !== '{}' && value !== '[]') {
      return parseUnityScalar(value, key);
    }
    // If value is empty or {}, check for indented key-value sub-block
    const baseIndent = match[1].length;
    const nestedObj = {};
    let hasNested = false;
    for (let j = i + 1; j < doc.lines.length; j++) {
      const subLine = doc.lines[j];
      if (!subLine.trim()) continue;
      const subIndent = subLine.match(/^\s*/)[0].length;
      if (subIndent <= baseIndent) break;
      const subMatch = /^\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(subLine);
      if (subMatch) {
        hasNested = true;
        nestedObj[subMatch[1]] = parseUnityScalar(subMatch[2], subMatch[1]);
      }
    }
    if (hasNested) return nestedObj;
    if (value) return parseUnityScalar(value, key);
    return fallback;
  }
  return fallback;
}

function getNestedList(doc, key) {
  const pattern = new RegExp(`^(\\s*)${escapeRegex(key)}\\s*:\\s*$`);
  for (let i = 0; i < doc.lines.length; i++) {
    const match = pattern.exec(doc.lines[i]);
    if (!match) continue;
    const baseIndent = match[1].length;
    const list = [];
    for (let j = i + 1; j < doc.lines.length; j++) {
      const line = doc.lines[j];
      if (!line.trim()) continue;
      const indent = line.match(/^\s*/)[0].length;
      const trimmed = line.trim();
      if (indent < baseIndent) break;
      if (indent === baseIndent && !trimmed.startsWith('- ')) break;
      if (!trimmed.startsWith('- ')) continue;
      const item = trimmed.slice(2).trim();
      if (item.includes(':') && !item.startsWith('{')) {
        const idx = item.indexOf(':');
        list.push({ [item.slice(0, idx).trim()]: parseUnityScalar(item.slice(idx + 1)) });
      } else {
        list.push(parseUnityScalar(item));
      }
    }
    return list;
  }
  return [];
}

function parseUnityPolygonColliderPaths(doc, key = 'm_Points') {
  const block = getIndentedBlock(doc, key);
  const paths = [];
  let currentPath = null;
  let currentPathIndent = -1;

  for (const rawLine of block) {
    const line = String(rawLine || '');
    const trimmed = line.trim();
    const indent = line.match(/^\s*/)?.[0]?.length || 0;
    if (!trimmed) continue;

    if (/^-\s*-\s+\{/.test(trimmed)) {
      if (currentPath?.length) paths.push(currentPath);
      currentPath = [parseUnityScalar(trimmed.replace(/^-\s*-\s+/, ''))];
      currentPathIndent = indent;
      continue;
    }
    if (/^-\s+\{/.test(trimmed)) {
      if (!currentPath || indent <= currentPathIndent) {
        if (currentPath?.length) paths.push(currentPath);
        currentPath = [];
        currentPathIndent = indent;
      }
      currentPath.push(parseUnityScalar(trimmed.replace(/^-\s+/, '')));
      continue;
    }
    if (/^\{/.test(trimmed)) {
      if (!currentPath) currentPath = [];
      currentPath.push(parseUnityScalar(trimmed));
    }
  }

  if (currentPath?.length) paths.push(currentPath);
  return paths;
}

function boundsForUnityPolygonPaths(paths, offset = { x: 0, y: 0 }) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const path of Array.isArray(paths) ? paths : []) {
    for (const point of Array.isArray(path) ? path : []) {
      const x = finiteNumber(point?.x, NaN);
      const y = finiteNumber(point?.y, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null;
  }

  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  return {
    center: {
      x: finiteNumber(offset?.x, 0) + minX + width / 2,
      y: finiteNumber(offset?.y, 0) + minY + height / 2,
      z: 0,
    },
    size: {
      x: width || UNITY_3D_COLLIDER_DEPTH,
      y: height || UNITY_3D_COLLIDER_DEPTH,
      z: UNITY_3D_COLLIDER_DEPTH,
    },
  };
}

function getTopLevelSerializedFields(doc, options) {
  const fields = {};
  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i];
    const match = /^  ([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    let key = match[1];
    if (key.startsWith('m_')) continue;
    if (key.startsWith('Event')) continue;
    if (options.stripPrivatePrefix && key.startsWith('_')) key = key.slice(1);

    const raw = match[2].trim();
    if (raw !== '') {
      fields[key] = parseUnityScalar(raw);
      continue;
    }

    const items = [];
    const nested = {};
    for (let j = i + 1; j < doc.lines.length; j++) {
      const next = doc.lines[j];
      if (!next.trim()) continue;
      const indent = next.match(/^\s*/)[0].length;
      const trimmed = next.trim();
      if (indent < 2) break;
      if (indent === 2 && !trimmed.startsWith('- ')) break;
      if (trimmed.startsWith('- ')) {
        items.push(parseUnityScalar(trimmed.slice(2)));
        continue;
      }
      // Unity writes structs on their own indented lines: LayerMask as
      // `serializedVersion` + `m_Bits`, Vector2/Vector3 as `x`/`y`/`z`. Collecting them
      // keeps the field instead of dropping it for having no inline value.
      const child = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(trimmed);
      if (child && indent >= 4) nested[child[1]] = parseUnityScalar(child[2]);
    }
    if (items.length) fields[key] = items;
    else if (Object.keys(nested).length) fields[key] = nested;
  }
  return fields;
}

function unityRefFileId(value) {
  if (!value || typeof value !== 'object') return '';
  const fileId = String(value.fileID || '');
  return fileId === '0' ? '' : fileId;
}

function unityRefGuid(value) {
  if (!value || typeof value !== 'object') return '';
  return String(value.guid || '');
}

function vec2(x = 0, y = 0) {
  return { __type__: 'cc.Vec2', x, y };
}

function vec3(x = 0, y = 0, z = 0) {
  return { __type__: 'cc.Vec3', x, y, z };
}

function quat(x = 0, y = 0, z = 0, w = 1) {
  return { __type__: 'cc.Quat', x, y, z, w };
}

function color(r = 255, g = 255, b = 255, a = 255) {
  return { __type__: 'cc.Color', r, g, b, a };
}

function rect(x = 0, y = 0, width = 1, height = 1) {
  return { __type__: 'cc.Rect', x, y, width, height };
}

function size(width = 0, height = 0) {
  return { __type__: 'cc.Size', width, height };
}

function cocosRef(id) {
  return { __id__: id };
}

function cocosUuid(uuid, expectedType) {
  return { __uuid__: uuid, __expectedType__: expectedType };
}

function convertPosition(value) {
  const v = value || {};
  return vec3(Number(v.x || 0), Number(v.y || 0), -Number(v.z || 0));
}

function convertNodePosition(transform) {
  const converted = convertPosition(transform?.localPosition);
  // cc.RenderRoot2D supplies the world-space UI plane basis itself. Applying
  // the generic Unity->Cocos Z reflection once more to the RectTransform's
  // local plane depth moves world-space controls to the opposite side of a
  // pitched parent (TapeJam's Unlock badge is a concrete regression case).
  if (transform?.preserveWorldSpaceCanvasLocalZ) {
    converted.z = Number(transform?.localPosition?.z || 0);
  }
  return converted;
}

function convertScale(value) {
  const v = value || {};
  return vec3(Number(v.x == null ? 1 : v.x), Number(v.y == null ? 1 : v.y), Number(v.z == null ? 1 : v.z));
}

function convertRotation(value) {
  const q = value || {};
  return quat(-Number(q.x || 0), -Number(q.y || 0), Number(q.z || 0), Number(q.w == null ? 1 : q.w));
}

function convertEuler(value) {
  const v = value || {};
  return vec3(-Number(v.x || 0), Number(v.y || 0), Number(v.z || 0));
}

function isUnityIdentityRotation(value) {
  const q = value || {};
  const epsilon = 0.000001;
  return (
    Math.abs(Number(q.x || 0)) <= epsilon &&
    Math.abs(Number(q.y || 0)) <= epsilon &&
    Math.abs(Number(q.z || 0)) <= epsilon &&
    Math.abs(Number(q.w == null ? 1 : q.w) - 1) <= epsilon
  );
}

function convertTransformEuler(transform) {
  if (transform?.cocosEuler) {
    return vec3(
      Number(transform.cocosEuler.x || 0),
      Number(transform.cocosEuler.y || 0),
      Number(transform.cocosEuler.z || 0),
    );
  }
  if (isUnityIdentityRotation(transform?.localRotation)) return vec3();
  return convertEuler(transform?.euler);
}

function multiplyQuaternion(left, right) {
  return {
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
  };
}

function rotateVectorByQuaternion(value, rotation) {
  const v = value || {};
  const q = rotation || {};
  const x = Number(v.x || 0);
  const y = Number(v.y || 0);
  const z = Number(v.z || 0);
  const qx = Number(q.x || 0);
  const qy = Number(q.y || 0);
  const qz = Number(q.z || 0);
  const qw = Number(q.w == null ? 1 : q.w);
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return {
    x: x + qw * tx + (qy * tz - qz * ty),
    y: y + qw * ty + (qz * tx - qx * tz),
    z: z + qw * tz + (qx * ty - qy * tx),
  };
}

// Matches cc.Quat.toEuler (YZX order). Keeping _euler consistent with _lrot is
// important because Cocos uses it as the editor-facing transform cache.
function cocosQuaternionToEuler(value) {
  const q = value || {};
  const x = Number(q.x || 0);
  const y = Number(q.y || 0);
  const z = Number(q.z || 0);
  const w = Number(q.w == null ? 1 : q.w);
  const test = x * y + z * w;
  const toDegrees = 180 / Math.PI;
  let bank;
  let heading;
  let attitude;
  if (test > 0.499999) {
    bank = 0;
    heading = 2 * Math.atan2(x, w) * toDegrees;
    attitude = 90;
  } else if (test < -0.499999) {
    bank = 0;
    heading = -2 * Math.atan2(x, w) * toDegrees;
    attitude = -90;
  } else {
    const sqx = x * x;
    const sqy = y * y;
    const sqz = z * z;
    bank = Math.atan2(2 * x * w - 2 * y * z, 1 - 2 * sqx - 2 * sqz) * toDegrees;
    heading = Math.atan2(2 * y * w - 2 * x * z, 1 - 2 * sqy - 2 * sqz) * toDegrees;
    attitude = Math.asin(Math.max(-1, Math.min(1, 2 * test))) * toDegrees;
  }
  const clean = (number) => Math.abs(number) < 1e-10 ? 0 : number;
  return { x: clean(bank), y: clean(heading), z: clean(attitude) };
}

const NESTED_MODEL_FORWARD_BASIS = Object.freeze({ x: 0, y: 1, z: 0, w: 0 });

function withConsistentCocosEuler(transform) {
  const result = transform || {};
  return {
    ...result,
    cocosEuler: cocosQuaternionToEuler(convertRotation(result.localRotation)),
  };
}

// Unity and Cocos import the FBX file's forward axis differently. The linked
// Cocos model therefore needs a local 180-degree Y basis after the regular
// Unity -> Cocos handedness conversion. This is a MODEL basis, not an authored
// gameplay rotation: TapeJam's authored Y180 becomes identity here because the
// Cocos-imported mesh already contains the corresponding file-axis conversion.
function correctNestedModelForwardAxis(transform) {
  const source = transform || {};
  const rotation = source.localRotation || { x: 0, y: 0, z: 0, w: 1 };
  return withConsistentCocosEuler({
    ...source,
    localRotation: multiplyQuaternion(rotation, NESTED_MODEL_FORWARD_BASIS),
  });
}

function hasExplicitNestedModelForwardBasisRotation(transform) {
  const rotation = transform?.localRotation || {};
  const epsilon = 1e-5;
  return Math.abs(Number(rotation.x) || 0) <= epsilon
    && Math.abs(Math.abs(Number(rotation.y) || 0) - 1) <= epsilon
    && Math.abs(Number(rotation.z) || 0) <= epsilon
    && Math.abs(Number(rotation.w) || 0) <= epsilon;
}

// Children added by the Unity prefab are not part of the FBX. If only the model
// root receives the basis above, those mounted nodes inherit an extra 180-degree
// turn (holder pegs/labels appear on the wrong side). Rebase each immediate
// mounted child by the inverse basis so its world transform remains authored:
//   (root * B) * (B^-1 * child) == root * child.
// For a 180-degree Y quaternion B^-1 equals B.
function rebaseNestedModelMountedChildTransform(transform) {
  const source = transform || {};
  const rotation = source.localRotation || { x: 0, y: 0, z: 0, w: 1 };
  return withConsistentCocosEuler({
    ...source,
    localPosition: rotateVectorByQuaternion(source.localPosition, NESTED_MODEL_FORWARD_BASIS),
    localRotation: multiplyQuaternion(NESTED_MODEL_FORWARD_BASIS, rotation),
  });
}

function unityColorToCocos(value, alphaOverride = null) {
  const c = value || {};
  const scale = (n) => {
    const v = Number(n == null ? 1 : n);
    return Math.max(0, Math.min(255, v <= 1 ? Math.round(v * 255) : Math.round(v)));
  };
  return color(scale(c.r), scale(c.g), scale(c.b), alphaOverride == null ? scale(c.a) : alphaOverride);
}

function compressUuid(uuid) {
  const compact = String(uuid || '').replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) return uuid;
  const head = compact.slice(0, 5);
  const rest = compact.slice(5);
  const evenRest = rest.length % 2 === 0 ? rest : `${rest}0`;
  let b64 = Buffer.from(evenRest, 'hex').toString('base64').replace(/=+$/g, '');
  if (rest.length % 2 !== 0) b64 = b64.slice(0, -1);
  return head + b64;
}

const PORT_SCAN_SKIPPED_DIRECTORIES = new Set(['node_modules', 'library', 'temp', '.git']);

function walkContainedFiles(root, predicate, options = {}) {
  const result = [];
  let boundary;
  try {
    boundary = createPathBoundary(root);
  } catch {
    return result;
  }

  const recursive = options.recursive !== false;
  const skipDirectories = options.skipDirectories || new Set();
  const stack = [boundary.resolvedRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const inspected = inspectContainedPath(boundary, full);
      if (!inspected) continue;

      if (inspected.stat.isDirectory()) {
        if (!recursive || skipDirectories.has(entry.name)) continue;
        stack.push(full);
      } else if (inspected.stat.isFile() && predicate(full)) {
        result.push(full);
      }
    }
  }
  return result;
}

function findFiles(root, predicate) {
  return walkContainedFiles(root, predicate, {
    skipDirectories: PORT_SCAN_SKIPPED_DIRECTORIES,
  });
}

// Assets referenced by a prefab often live in an embedded or registry package
// rather than under `Assets`, so those roots are indexed too. Without them the
// porter reports NESTED_PREFAB_GUID_MISSING / SCRIPT_GUID_UNRESOLVED and emits
// placeholders for perfectly resolvable content.
function unityPackageAssetRoots(unityRoot) {
  const projectRoot = inferUnityProjectRoot(unityRoot);
  if (!projectRoot) return [];
  return [
    { dir: path.join(projectRoot, 'Packages'), prefix: 'Packages' },
    { dir: path.join(projectRoot, 'Library', 'PackageCache'), prefix: 'PackageCache' },
  ];
}

class UnityAssetDatabase {
  constructor(root, extraRoots = []) {
    this.root = path.resolve(root);
    this.extraRoots = extraRoots.map((entry) => ({
      dir: path.resolve(entry.dir),
      prefix: entry.prefix || '',
    }));
    this.byGuid = new Map();
  }

  scan() {
    this.scanRoot(this.root, '');
    for (const extra of this.extraRoots) {
      if (fs.existsSync(extra.dir)) this.scanRoot(extra.dir, extra.prefix);
    }
  }

  scanRoot(dir, prefix) {
    for (const metaFile of findFiles(dir, (file) => file.endsWith('.meta'))) {
      const text = fs.readFileSync(metaFile, 'utf8');
      const guid = /^guid:\s*([a-fA-F0-9]+)/m.exec(text)?.[1];
      // `Assets` is scanned first and wins: a project copy of a package asset
      // is the one Unity itself resolves.
      if (!guid || this.byGuid.has(guid)) continue;
      const assetPath = metaFile.slice(0, -'.meta'.length);
      let relativePath = toPosix(path.relative(dir, assetPath));
      if (prefix) {
        // Cached package folders carry a content hash (`name@hash`). Strip it so
        // the imported Cocos path stays stable when the package is updated.
        relativePath = `${prefix}/${relativePath.replace(/^([^/@]+)@[^/]+\//, '$1/')}`;
      }
      this.byGuid.set(guid, {
        guid,
        path: assetPath,
        relativePath,
        ext: path.extname(assetPath).toLowerCase(),
        stem: path.basename(assetPath, path.extname(assetPath)),
      });
    }
  }

  get(guid) {
    return this.byGuid.get(String(guid || '')) || null;
  }
}

class CocosAssetDatabase {
  constructor(root) {
    this.root = path.resolve(root);
    this.assetsRoot = path.join(this.root, 'assets');
    this.records = [];
    this.byStem = new Map();
    this.scriptsByClass = new Map();
    this.layersByName = new Map();
  }

  scan(options = {}) {
    this.scanLayers();
    for (const metaFile of findFiles(this.assetsRoot, (file) => file.endsWith('.meta'))) {
      const meta = readJsonIfExists(metaFile);
      if (!meta || !meta.uuid) continue;
      const assetPath = metaFile.slice(0, -'.meta'.length);
      const ext = path.extname(assetPath).toLowerCase();
      const stem = path.basename(assetPath, ext);

      // If this model was already fully imported by Cocos, prune any stale pending
      // placeholder sub-assets that the port tool added in a previous run.  Leaving
      // them in causes the Cocos editor to attempt (and fail) to re-import them with
      // "Importer exec failed: <file>@<id>" because the asset is already imported
      // and its importer no longer processes placeholder entries.
      if (['.fbx', '.gltf', '.glb'].includes(ext) && meta.imported === true && hasImportedSubMeta(meta.subMetas, 'gltf-mesh')) {
        let pruned = false;
        for (const [id, subMeta] of Object.entries(meta.subMetas || {})) {
          if (subMeta?.importer === 'gltf-mesh' && isPendingGeneratedSubMeta(subMeta)) {
            delete meta.subMetas[id];
            pruned = true;
          }
        }
        if (pruned && !options.readOnly) fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
      }

      const record = {
        uuid: meta.uuid,
        meta,
        metaFile,
        path: assetPath,
        relativePath: toPosix(path.relative(this.root, assetPath)),
        ext,
        stem,
        importer: meta.importer || '',
        subMetas: meta.subMetas || {},
      };
      this.records.push(record);
      const key = normalizeKey(stem);
      if (!this.byStem.has(key)) this.byStem.set(key, []);
      this.byStem.get(key).push(record);
      if (ext === '.ts') this.indexScript(record);
    }
  }

  registerLayer(name, value) {
    if (!name && name !== '0') return;
    this.layersByName.set(String(name), Number(value));
  }

  scanLayers() {
    for (const builtin of COCOS_BUILTIN_LAYER_ALIASES) {
      for (const name of builtin.names) this.registerLayer(name, builtin.value);
    }

    const project = readJsonIfExists(path.join(this.root, 'settings', 'v2', 'packages', 'project.json'));
    for (const layer of project?.layer || []) {
      const value = Number(layer?.value);
      if (!layer?.name || !Number.isFinite(value)) continue;
      this.registerLayer(layer.name, value);
    }
  }

  indexScript(record) {
    let source = '';
    try {
      source = fs.readFileSync(record.path, 'utf8');
    } catch {
      return;
    }
    const classes = [];
    for (const match of source.matchAll(/@ccclass\(['"]([^'"]+)['"]\)/g)) classes.push(match[1]);
    for (const match of source.matchAll(/export\s+class\s+([A-Za-z0-9_]+)/g)) classes.push(match[1]);
    // Unity writes bools as 0/1 and vectors as bare {x,y[,z]}. Knowing which Cocos
    // fields are declared boolean / Vec2 / Vec3 lets the porter emit the right types
    // instead of a number where the inspector expects a checkbox.
    const booleanFields = new Set();
    const vectorFields = new Map();
    for (const match of source.matchAll(
      /(?:^|[\n;{])[ \t]*(?:@property(?:\([^\n)]*\))?[ \t]*(?:\r?\n[ \t]*)?)?(?:public |private |protected |readonly )*([A-Za-z_$][\w$]*)[ \t]*!?\??[ \t]*(?::[ \t]*boolean[ \t]*)?=[ \t]*(?:true|false)\b/g,
    )) booleanFields.add(match[1]);
    for (const match of source.matchAll(
      /(?:^|[\n;{])[ \t]*(?:@property(?:\([^\n)]*\))?[ \t]*(?:\r?\n[ \t]*)?)?(?:public |private |protected |readonly )*([A-Za-z_$][\w$]*)[ \t]*!?\??[ \t]*:[ \t]*boolean[ \t]*[;=]/g,
    )) booleanFields.add(match[1]);
    for (const match of source.matchAll(
      /(?:^|[\n;{])[ \t]*(?:@property(?:\([^\n)]*\))?[ \t]*(?:\r?\n[ \t]*)?)?(?:public |private |protected |readonly )*([A-Za-z_$][\w$]*)[ \t]*!?\??[ \t]*(?::[ \t]*(Vec2|Vec3)[ \t]*)?=[ \t]*new (Vec2|Vec3)\(/g,
    )) vectorFields.set(match[1], `cc.${match[3]}`);
    for (const match of source.matchAll(
      /(?:^|[\n;{])[ \t]*(?:@property(?:\([^\n)]*\))?[ \t]*(?:\r?\n[ \t]*)?)?(?:public |private |protected |readonly )*([A-Za-z_$][\w$]*)[ \t]*!?\??[ \t]*:[ \t]*(Vec2|Vec3)[ \t]*[;=]/g,
    )) if (!vectorFields.has(match[1])) vectorFields.set(match[1], `cc.${match[2]}`);
    // Every member name the class actually declares. A MonoBehaviour is bound to
    // a Cocos class by NAME alone, so without this the porter cannot tell a real
    // match from two unrelated classes that happen to share a name - it would
    // write Unity's fields into a class that has none of them and report success.
    const memberNames = new Set();
    for (const match of source.matchAll(
      /(?:^|\n)[ \t]*(?:@property(?:\([^\n)]*\))?[ \t]*(?:\r?\n[ \t]*)?)?(?:public |private |protected |readonly |static |declare |abstract )*([A-Za-z_$][\w$]*)[ \t]*[!?]?[ \t]*[:=(]/g,
    )) memberNames.add(match[1]);
    for (const match of source.matchAll(/(?:^|\n)[ \t]*(?:public |private |protected |static )*(?:get|set)[ \t]+([A-Za-z_$][\w$]*)/g)) {
      memberNames.add(match[1]);
    }
    for (const keyword of TS_NON_MEMBER_KEYWORDS) memberNames.delete(keyword);

    for (const className of classes) {
      this.scriptsByClass.set(className, {
        className,
        uuid: record.uuid,
        classId: compressUuid(record.uuid),
        path: record.path,
        relativePath: record.relativePath,
        booleanFields,
        vectorFields,
        memberNames,
      });
    }
  }

  layerValue(nameOrValue, fallback = COCOS_DEFAULT_LAYER_VALUE) {
    if (typeof nameOrValue === 'number') return nameOrValue;
    if (typeof nameOrValue === 'string' && /^-?\d+$/.test(nameOrValue.trim())) return Number(nameOrValue);
    if (this.layersByName.has(nameOrValue)) return this.layersByName.get(nameOrValue);
    return fallback;
  }

  findByStem(stem) {
    const key = normalizeKey(stem);
    const exact = this.byStem.get(key) || [];
    if (exact.length) return exact;

    const relaxed = normalizeAssetLookupKey(stem);
    if (relaxed && relaxed !== key) {
      const relaxedExact = this.byStem.get(relaxed) || [];
      if (relaxedExact.length) return relaxedExact;
    }

    const fuzzy = [];
    for (const [candidateKey, records] of this.byStem.entries()) {
      if (!relaxed) continue;
      if (candidateKey === relaxed || candidateKey.startsWith(relaxed) || relaxed.startsWith(candidateKey)) {
        fuzzy.push(...records);
      }
    }
    return fuzzy;
  }

  findScriptClass(className) {
    return this.scriptsByClass.get(className) || null;
  }

  resolveSpriteByStem(stem) {
    const records = this.findByStem(stem);
    for (const record of records) {
      const spriteFrame = firstImportedSubMetaRecord(record.uuid, record.subMetas, 'sprite-frame');
      if (spriteFrame) return spriteFrame.uuid;
    }
    return '';
  }

  resolveFontByStem(stem) {
    const records = this.findByStem(stem);
    for (const record of records) {
      if (record.importer === 'ttf-font'
        || ['.font', '.eot', '.ttf', '.woff', '.svg', '.ttc'].includes(record.ext)) return record.uuid;
    }
    return '';
  }

  resolveMaterialByStem(stem) {
    const records = this.findByStem(stem);
    for (const record of records) {
      if (record.importer === 'material') return record.uuid;
      const material = firstSubMetaRecord(record.uuid, record.subMetas, 'gltf-material', stem);
      if (material) return material.uuid;
    }
    return '';
  }

  resolveModelMaterialUuidsByStem(stem, materialNameHints = []) {
    const records = this.findByStem(stem);
    const candidates = records.filter((record) => ['.fbx', '.gltf', '.glb'].includes(record.ext));
    const hints = materialNameHints.map((hint) => String(hint || ''));
    for (const record of candidates) {
      const materials = subMetaRecords(record.uuid, record.subMetas, 'gltf-material');
      if (!materials.length) continue;
      if (!hints.some((hint) => hint.trim())) {
        return {
          materialUuids: materials.map((material) => material.uuid),
          source: record.relativePath,
          fallbackExt: record.ext,
        };
      }

      const unused = new Set(materials.map((material) => material.id));
      const materialUuids = hints.map((hint) => {
        const normalizedHint = normalizeKey(hint);
        let match = null;
        if (normalizedHint) {
          match = materials.find((material) => (
            unused.has(material.id) &&
            normalizeKey(material.subMeta.name || material.subMeta.displayName || '').includes(normalizedHint)
          ));
        }
        if (!match) match = materials.find((material) => unused.has(material.id)) || null;
        if (!match) return '';
        unused.delete(match.id);
        return match.uuid;
      });

      return {
        materialUuids,
        source: record.relativePath,
        fallbackExt: record.ext,
      };
    }
    return null;
  }

  resolveModelMeshByStem(stem, meshNameHint = '') {
    const records = this.findByStem(stem);
    const candidates = records.filter((record) => ['.fbx', '.gltf', '.glb'].includes(record.ext));
    for (const record of candidates) {
      const meshRecord = firstImportedSubMetaRecord(record.uuid, record.subMetas, 'gltf-mesh', meshNameHint);
      const mesh = meshRecord?.uuid || '';
      const materials = subMetaRecords(record.uuid, record.subMetas, 'gltf-material');
      if (mesh) {
        return {
          meshUuid: mesh,
          materialUuid: materials[0]?.uuid || '',
          materialUuids: materials.map((material) => material.uuid),
          materialNames: materials.map((material) => (
            material.subMeta.name || material.subMeta.displayName || ''
          )),
          source: record.relativePath,
          fallbackExt: record.ext,
        };
      }
    }
    return null;
  }

  resolveModelPrefabByStem(stem, preferredUnityRelativePath = '') {
    const records = this.findByStem(stem);
    const preferredSuffix = toPosix(preferredUnityRelativePath).toLowerCase();
    const candidates = records
      .filter((record) => ['.fbx', '.gltf', '.glb'].includes(record.ext))
      .sort((left, right) => {
        if (!preferredSuffix) return 0;
        const leftPreferred = toPosix(left.relativePath).toLowerCase().endsWith(preferredSuffix);
        const rightPreferred = toPosix(right.relativePath).toLowerCase().endsWith(preferredSuffix);
        return Number(rightPreferred) - Number(leftPreferred);
      });
    for (const record of candidates) {
      const scenes = subMetaRecords(record.uuid, record.subMetas, 'gltf-scene')
        .filter(({ subMeta }) => !isPendingGeneratedSubMeta(subMeta));
      for (const scene of scenes) {
        const objects = readJsonIfExists(libraryJsonPathForUuid({ cocosRoot: this.root }, scene.uuid));
        const rootId = objects?.[0]?.data?.__id__;
        const rootNode = Number.isInteger(rootId) ? objects[rootId] : null;
        const prefabInfoId = rootNode?._prefab?.__id__;
        const rootLocalId = Number.isInteger(prefabInfoId) ? objects[prefabInfoId]?.fileId : '';
        if (!rootNode || !rootLocalId) continue;
        const materialNames = new Map(
          subMetaRecords(record.uuid, record.subMetas, 'gltf-material')
            .map((material) => [
              material.uuid,
              String(material.subMeta.name || material.subMeta.displayName || '')
                .replace(/\.material$/i, ''),
            ]),
        );
        const materialSlots = [];
        for (const component of objects) {
          if (!['cc.MeshRenderer', 'cc.SkinnedMeshRenderer'].includes(component?.__type__)) continue;
          const componentPrefabInfoId = component.__prefab?.__id__;
          const rendererLocalId = Number.isInteger(componentPrefabInfoId)
            ? objects[componentPrefabInfoId]?.fileId
            : '';
          if (!rendererLocalId) continue;
          for (let slot = 0; slot < (component._materials || []).length; slot += 1) {
            const materialUuid = component._materials[slot]?.__uuid__ || '';
            materialSlots.push({
              rendererLocalId,
              slot,
              materialUuid,
              materialName: materialNames.get(materialUuid) || '',
            });
          }
        }
        return {
          prefabUuid: scene.uuid,
          rootLocalId,
          rootName: rootNode._name || stem,
          materialSlots,
          assetPath: record.path,
          source: record.relativePath,
          fallbackExt: record.ext,
        };
      }
    }
    return null;
  }

  resolveModelAnimationByStem(stem, animationNameHint = '') {
    const normalizedHint = normalizeKey(animationNameHint);
    const shortHint = normalizeKey(String(animationNameHint || '').split('|').pop());
    const records = this.findByStem(stem);
    const candidates = records.filter((record) => ['.fbx', '.gltf', '.glb'].includes(record.ext));
    for (const record of candidates) {
      const animations = subMetaRecords(record.uuid, record.subMetas, 'gltf-animation');
      const match = animations.find(({ subMeta }) => {
        const name = normalizeKey(subMeta.name || subMeta.displayName || '');
        return name === normalizedHint
          || (shortHint && (name.endsWith(shortHint) || name.includes(shortHint)));
      });
      if (match) {
        return {
          uuid: match.uuid,
          name: String(match.subMeta.name || match.subMeta.displayName || animationNameHint)
            .replace(/\.animation$/i, ''),
          source: record.relativePath,
        };
      }
    }
    return null;
  }

  resolveModelAnimationsByStem(stem) {
    const records = this.findByStem(stem);
    const candidates = records.filter((record) => ['.fbx', '.gltf', '.glb'].includes(record.ext));
    for (const record of candidates) {
      const animations = subMetaRecords(record.uuid, record.subMetas, 'gltf-animation')
        .sort((left, right) => (
          Number(left.subMeta?.userData?.gltfIndex ?? Number.MAX_SAFE_INTEGER)
          - Number(right.subMeta?.userData?.gltfIndex ?? Number.MAX_SAFE_INTEGER)
        ));
      if (animations.length) {
        return animations.map(({ uuid, subMeta }) => ({
          uuid,
          name: String(subMeta.name || subMeta.displayName || '').replace(/\.animation$/i, ''),
          source: record.relativePath,
        }));
      }
    }
    return [];
  }

  resolveAnimationGraphByStem(stem) {
    const records = this.findByStem(stem);
    for (const record of records) {
      if (record.importer === 'animation-graph') return record.uuid;
    }
    return '';
  }

  firstSubMeta(record, importer, nameHint) {
    return firstSubMetaUuid(record.uuid, record.subMetas, importer, nameHint);
  }

  currentSubAssetUuid(uuid, expectedType) {
    const parsed = splitCocosSubAssetUuid(uuid);
    if (!parsed.baseUuid) return '';
    const record = this.records.find((item) => item.uuid === parsed.baseUuid);
    if (!record) return '';
    const importer = importerForExpectedType(expectedType);
    if (!importer) return '';

    const current = record.subMetas?.[parsed.subId];
    if (current?.importer === importer && !isPendingGeneratedSubMeta(current)) {
      return current.uuid || `${record.uuid}@${parsed.subId}`;
    }

    const replacement = firstImportedSubMetaRecord(record.uuid, record.subMetas, importer);
    return replacement?.uuid || '';
  }
}

function normalizeAssetLookupKey(stem) {
  return normalizeKey(stem)
    .replace(/gameplay$/i, '')
    .replace(/ingame$/i, '')
    .replace(/icon$/i, '')
    .replace(/ui$/i, '')
    .replace(/sprite$/i, '');
}

function subMetaLookupHints(nameHint = '') {
  const text = String(nameHint || '').trim();
  const hints = [];
  const seen = new Set();
  const push = (value) => {
    const normalized = normalizeKey(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    hints.push(normalized);
  };

  push(text);
  push(text.replace(/\s*\(\d+\)\s*$/, ''));
  push(text.replace(/[._-]\d+$/, ''));
  push(text.replace(/\s+\d+$/, ''));
  return hints;
}

function firstSubMetaRecord(baseUuid, subMetas, importer, nameHint = '') {
  const records = subMetaRecords(baseUuid, subMetas, importer);
  if (!records.length) return null;
  const hint = normalizeKey(nameHint);
  if (hint) {
    for (const record of records) {
      if (normalizeKey(record.subMeta.name || record.subMeta.displayName || '').includes(hint)) return record;
    }
  }
  return records[0] || null;
}

function findSubMetaRecordByName(baseUuid, subMetas, importer, nameHint = '') {
  const hint = normalizeKey(nameHint);
  if (!hint) return null;
  for (const record of subMetaRecords(baseUuid, subMetas, importer)) {
    if (normalizeKey(record.subMeta.name || record.subMeta.displayName || '').includes(hint)) return record;
  }
  return null;
}

function firstImportedSubMetaRecord(baseUuid, subMetas, importer, nameHint = '') {
  const hints = subMetaLookupHints(nameHint);
  if (hints.length) {
    for (const hint of hints) {
      for (const record of subMetaRecords(baseUuid, subMetas, importer)) {
        if (
          !isPendingGeneratedSubMeta(record.subMeta) &&
          normalizeKey(record.subMeta.name || record.subMeta.displayName || '').includes(hint)
        ) {
          return record;
        }
      }
    }
  }
  for (const record of subMetaRecords(baseUuid, subMetas, importer)) {
    if (!isPendingGeneratedSubMeta(record.subMeta)) return record;
  }
  return null;
}

function subMetaRecords(baseUuid, subMetas, importer = '') {
  if (!baseUuid) return [];
  const entries = Object.entries(subMetas || {});
  if (!entries.length) return [];
  const sortedEntries = [
    ...entries.filter(([, sub]) => !isPendingGeneratedSubMeta(sub)),
    ...entries.filter(([, sub]) => isPendingGeneratedSubMeta(sub)),
  ];
  return sortedEntries
    .filter(([, sub]) => !importer || sub.importer === importer)
    .map(([id, sub]) => ({ id, subMeta: sub, uuid: sub.uuid || `${baseUuid}@${id}` }));
}

function splitCocosSubAssetUuid(uuid) {
  const text = String(uuid || '');
  const at = text.indexOf('@');
  if (at < 0) return { baseUuid: text, subId: '' };
  return {
    baseUuid: text.slice(0, at),
    subId: text.slice(at + 1),
  };
}

function importerForExpectedType(expectedType) {
  if (expectedType === 'cc.Mesh') return 'gltf-mesh';
  if (expectedType === 'cc.Material') return 'gltf-material';
  if (expectedType === 'cc.SpriteFrame') return 'sprite-frame';
  return '';
}

function firstSubMetaUuid(baseUuid, subMetas, importer, nameHint = '') {
  const record = firstSubMetaRecord(baseUuid, subMetas, importer, nameHint);
  return record?.uuid || '';
}

function resolveImportedSpriteAsset(assetFile) {
  return resolveImportedSpriteAssetImpl(assetFile);
}

function isPendingGeneratedSubMeta(subMeta) {
  return isPendingGeneratedSubMetaImpl(subMeta);
}

function hasImportedSubMeta(subMetas, importer) {
  return hasImportedSubMetaImpl(subMetas, importer);
}

function subMetaFilesForImportedState(imported, files) {
  return subMetaFilesForImportedStateImpl(imported, files);
}

function uniqueSubMetaId(subMetas, seed) {
  return uniqueSubMetaIdImpl(subMetas, seed);
}

function sanitizeAssetDisplayName(value, fallback = 'asset') {
  const cleaned = String(value || fallback).trim().replace(/[\\/:*?"<>|]+/g, '_');
  return cleaned || fallback;
}

function getImageDimensions(assetFile) {
  try {
    const buffer = fs.readFileSync(assetFile);
    if (
      buffer.length >= 24 &&
      buffer.toString('ascii', 1, 4) === 'PNG'
    ) {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
      };
    }
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (length < 2) break;
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          return {
            width: buffer.readUInt16BE(offset + 7),
            height: buffer.readUInt16BE(offset + 5),
          };
        }
        offset += 2 + length;
      }
    }
  } catch {
    return { width: 1, height: 1 };
  }
  return { width: 1, height: 1 };
}

function spriteFrameVertices(width, height) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return {
    rawPosition: [
      -halfWidth, -halfHeight, 0,
      halfWidth, -halfHeight, 0,
      -halfWidth, halfHeight, 0,
      halfWidth, halfHeight, 0,
    ],
    indexes: [0, 1, 2, 2, 1, 3],
    uv: [0, height, width, height, 0, 0, width, 0],
    nuv: [0, 0, 1, 0, 0, 1, 1, 1],
    minPos: [-halfWidth, -halfHeight, 0],
    maxPos: [halfWidth, halfHeight, 0],
  };
}

function readPrintableStrings(file) {
  return readPrintableStringsImpl(file);
}

function readUnitySpriteTextureGuid(assetFile) {
  return readUnitySpriteTextureGuidImpl(assetFile);
}

function resolveUnitySpriteTextureAsset(spriteAsset, unityDb) {
  return resolveUnitySpriteTextureAssetImpl(spriteAsset, unityDb);
}

function resolveUnitySpriteFrame(spriteAsset, options, unityDb, cocosDb, reporter) {
  return resolveUnitySpriteFrameImpl(spriteAsset, options, unityDb, cocosDb, reporter);
}

function reportResolvedUnitySprite(result, spriteAsset, reporter, options) {
  return reportResolvedUnitySpriteImpl(result, spriteAsset, reporter, options);
}

function blockEntryIndent(lines) {
  let minIndent = Infinity;
  for (const rawLine of lines || []) {
    const line = String(rawLine || '');
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!/^(-\s+)?[^:]+\s*:/.test(trimmed)) continue;
    const indent = line.match(/^\s*/)?.[0]?.length || 0;
    if (indent < minIndent) minIndent = indent;
  }
  return Number.isFinite(minIndent) ? minIndent : -1;
}

function parseUnitySerializedScalarMap(doc, key) {
  const block = getIndentedBlock(doc, key);
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
  const block = getIndentedBlock(doc, 'm_TexEnvs');
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

function firstDefinedMaterialValue(source, keys, fallback = undefined) {
  for (const key of keys || []) {
    if (source && source[key] != null) return source[key];
  }
  return fallback;
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

function convertedUnityMaterialAssetPath(materialAsset, options) {
  const importedPath = importedUnityAssetPath(materialAsset, options);
  return importedPath ? importedPath.replace(/\.mat$/i, '.mtl') : '';
}

function resolveStandaloneMaterialAssetUuid(assetFile, options) {
  if (!assetFile) return '';
  const resolved = resolveCurrentStandaloneMaterialUuid(assetFile, options);
  if (resolved) return resolved;
  const meta = readJsonIfExists(`${assetFile}.meta`);
  return meta?.importer === 'material' && meta?.uuid ? meta.uuid : '';
}

function readUnityPhysicsMaterialDoc(assetFile) {
  if (!assetFile || !fs.existsSync(assetFile)) return null;
  return parseUnityYaml(assetFile).find((doc) => doc.classId === 134 || doc.typeName === 'PhysicsMaterial') || null;
}

function convertedUnityPhysicsMaterialAssetPath(physicsMaterialAsset, options) {
  const importedPath = importedUnityAssetPath(physicsMaterialAsset, options);
  if (!importedPath) return '';
  return importedPath.replace(/\.[^.]+$/i, '.pmtl');
}

function ensurePhysicsMaterialAssetMeta(assetFile, options) {
  const metaFile = `${assetFile}.meta`;
  const existing = readJsonIfExists(metaFile) || {};
  const relativePath = toPosix(path.relative(options.cocosRoot, assetFile));
  const meta = {
    ver: existing.ver || '1.0.1',
    importer: existing.importer || 'physics-material',
    imported: existing.imported ?? true,
    uuid: existing.uuid || stableUuid(`physics-material:${relativePath}`),
    files: Array.isArray(existing.files) && existing.files.length ? existing.files : ['.json'],
    subMetas: {},
    userData: { ...(existing.userData || {}) },
  };

  if (JSON.stringify(existing) !== JSON.stringify(meta)) {
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }
  return meta;
}

function syncImportedPhysicsMaterialLibraryCache(physicsMaterialData, meta, options) {
  if (!meta?.uuid || !physicsMaterialData || options.dryRun) return false;
  const libraryFile = libraryJsonPathForUuid(options, meta.uuid);
  ensureDir(path.dirname(libraryFile));
  fs.writeFileSync(libraryFile, `${JSON.stringify(physicsMaterialData, null, 2)}\n`, 'utf8');
  return true;
}

function resolveCurrentPhysicsMaterialUuid(assetFile, options) {
  if (!assetFile) return '';
  const libraryUuid = resolveLibraryAssetUuid(assetFile, options, ['cc.PhysicsMaterial', 'cc.PhysicMaterial'], { forceReload: true });
  if (libraryUuid) return libraryUuid;
  const meta = readJsonIfExists(`${assetFile}.meta`);
  return meta?.importer === 'physics-material' && meta?.uuid ? meta.uuid : '';
}

function convertUnityPhysicsMaterialToCocos(physicsMaterialAsset, options, reporter) {
  if (!physicsMaterialAsset?.path || !fs.existsSync(physicsMaterialAsset.path)) return '';

  const physicsDoc = readUnityPhysicsMaterialDoc(physicsMaterialAsset.path);
  if (!physicsDoc) {
    reporter.medium('PHYSICS_MATERIAL_CONVERSION_FAILED', physicsMaterialAsset.relativePath, '', 'Unity PhysicsMaterial could not be parsed');
    return '';
  }

  const convertedDest = convertedUnityPhysicsMaterialAssetPath(physicsMaterialAsset, options);
  if (!convertedDest) return '';

  const dynamicFriction = Math.max(0, finiteNumber(getField(physicsDoc, 'm_DynamicFriction', 0), 0));
  const staticFriction = Math.max(0, finiteNumber(getField(physicsDoc, 'm_StaticFriction', 0), 0));
  const restitution = Math.max(0, finiteNumber(getField(physicsDoc, 'm_Bounciness', 0), 0));
  const friction = Math.max(dynamicFriction, staticFriction);
  const physicsMaterialData = {
    __type__: 'cc.PhysicsMaterial',
    _name: String(getField(physicsDoc, 'm_Name', physicsMaterialAsset.stem) || physicsMaterialAsset.stem),
    _friction: friction,
    _rollingFriction: 0,
    _spinningFriction: 0,
    _restitution: restitution,
  };

  if (!options.dryRun) {
    ensureDir(path.dirname(convertedDest));
    ensureDirectoryMetas(path.dirname(convertedDest), path.join(options.cocosRoot, 'assets'));
    fs.writeFileSync(convertedDest, `${JSON.stringify(physicsMaterialData, null, 2)}\n`, 'utf8');
    const meta = ensurePhysicsMaterialAssetMeta(convertedDest, options);
    syncImportedPhysicsMaterialLibraryCache(physicsMaterialData, meta, options);
  }

  reporter.low(
    'PHYSICS_MATERIAL_CONVERTED',
    physicsMaterialAsset.relativePath,
    toPosix(path.relative(options.cocosRoot, convertedDest)),
    'Unity PhysicsMaterial was converted to Cocos PhysicsMaterial',
    `friction=${friction}, restitution=${restitution}`,
  );

  return convertedDest;
}

function resolveUnityPhysicsMaterialUuid(physicsMaterialAsset, options, reporter, gameObjectName = '') {
  if (!physicsMaterialAsset) return '';

  const convertedDest = convertedUnityPhysicsMaterialAssetPath(physicsMaterialAsset, options);
  if (convertedDest && fs.existsSync(convertedDest)) {
    const existingUuid = resolveCurrentPhysicsMaterialUuid(convertedDest, options);
    if (existingUuid) return existingUuid;
  }

  const writtenDest = convertUnityPhysicsMaterialToCocos(physicsMaterialAsset, options, reporter);
  const uuid = resolveCurrentPhysicsMaterialUuid(writtenDest || convertedDest, options);
  if (!uuid) {
    reporter.medium('PHYSICS_MATERIAL_UNRESOLVED', physicsMaterialAsset.relativePath, gameObjectName, 'Unity PhysicsMaterial could not be resolved to a Cocos PhysicsMaterial asset');
  }
  return uuid;
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
  const copyConfig = { deferNeedsImportReport: true, ...importConfig };
  const needsMetaRefresh = Boolean(importConfig.particleTexture);

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

function convertUnityMaterialToCocos(materialAsset, options, unityDb, reporter) {
  return convertUnityMaterialToCocosImpl(materialAsset, options, unityDb, reporter);
}

function resolveUnityMaterialUuid(materialAsset, options, unityDb, cocosDb, reporter, gameObjectName) {
  return resolveUnityMaterialUuidImpl(materialAsset, options, unityDb, cocosDb, reporter, gameObjectName);
}

function resolveUnityParticleMaterial(materialAsset, options, unityDb, reporter, gameObjectName) {
  return resolveUnityParticleMaterialImpl(materialAsset, options, unityDb, reporter, gameObjectName);
}

function resolveBuiltinPrimitiveMeshUuid(...hints) {
  for (const hint of hints) {
    const normalized = normalizeKey(hint || '');
    if (!normalized) continue;
    for (const [key, uuid] of Object.entries(BUILTIN_PRIMITIVE_MESH_UUIDS)) {
      if (normalized === key || normalized.startsWith(key)) return uuid;
    }
  }
  return '';
}

function isUnityBuiltinExtraRef(ref) {
  return unityRefGuid(ref) === UNITY_BUILTIN_EXTRA_GUID;
}

function resolveUnityBuiltinMeshUuid(meshRef, ...hints) {
  if (!isUnityBuiltinExtraRef(meshRef)) return '';
  const primitive = UNITY_BUILTIN_MESH_FILE_ID_TO_PRIMITIVE[unityRefFileId(meshRef)];
  if (primitive) return BUILTIN_PRIMITIVE_MESH_UUIDS[primitive] || '';
  return resolveBuiltinPrimitiveMeshUuid(...hints);
}

function extractFbxMeshNames(assetFile) {
  const strings = readPrintableStrings(assetFile);
  const names = [];
  const seen = new Set();
  const pushName = (name) => {
    const clean = sanitizeAssetDisplayName(String(name || '').replace(/^Geometry::/, ''), '');
    const key = normalizeKey(clean);
    if (!key || seen.has(key)) return;
    if (/^(geometry|mesh|model|objecttype|geometryversion)$/i.test(clean)) return;
    seen.add(key);
    names.push(clean);
  };

  for (let i = 0; i < strings.length - 3; i++) {
    if (/^Geometry/i.test(strings[i]) && /^GeometryS$/i.test(strings[i + 2]) && /^Mesh$/i.test(strings[i + 3])) {
      pushName(strings[i + 1]);
    }
  }

  for (const text of strings) {
    const match = /^Geometry::(.+)$/i.exec(text);
    if (match) pushName(match[1]);
  }

  return names;
}

function prioritizedNames(primary, candidates, fallback) {
  const out = [];
  const seen = new Set();
  const push = (name) => {
    const clean = sanitizeAssetDisplayName(name, '');
    const key = normalizeKey(clean);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };
  push(primary);
  for (const candidate of candidates || []) push(candidate);
  push(fallback);
  return out;
}

/**
 * Unity point/spot intensity -> Cocos luminance (cd/m2).
 *
 * Cocos is photometric, Unity's intensity is a bare multiplier, so the constant
 * is a calibration rather than a conversion. It is anchored to the directional
 * mapping just above (Unity 1.0 = 65000lx, Cocos' full-sun value): Unity 1.0
 * here is read as a ~10000lm lamp, which at Cocos' default sphere size 0.15
 * (luminance = flux / 4*PI^2*size^2, i.e. flux / 0.888) lands near this figure.
 *
 * The previous 1000x left ported point lights roughly an order of magnitude
 * under Unity - visibly present in the inspector, invisible on screen next to a
 * directional light mapped at 65000.
 */
const UNITY_PUNCTUAL_INTENSITY_TO_LUMINANCE = 10000;

const COCOS_TEXTURE_WRAP_MODES = new Set(['repeat', 'clamp-to-edge', 'mirrored-repeat']);

/** Falls back to Unity's default (repeat) rather than Cocos' (clamp). */
function cocosWrapMode(value, fallback = 'repeat') {
  return COCOS_TEXTURE_WRAP_MODES.has(value) ? value : fallback;
}

function ensureImageAssetMeta(assetFile, config = {}) {
  const metaFile = `${assetFile}.meta`;
  const existing = readJsonIfExists(metaFile) || {};
  const ext = path.extname(assetFile).toLowerCase();
  const displayName = path.basename(assetFile, ext);
  const isParticleTexture = Boolean(config.particleTexture);
  const fixAlphaTransparencyArtifacts = config.fixAlphaTransparencyArtifacts
    ?? existing.userData?.fixAlphaTransparencyArtifacts
    ?? false;
  const spriteTrimType = ['auto', 'custom', 'none'].includes(config.spriteTrimType)
    ? config.spriteTrimType
    : 'auto';
  const wrapModeS = cocosWrapMode(config.wrapModeS);
  const wrapModeT = cocosWrapMode(config.wrapModeT);
  const requestedImageType = String(config.imageType || '').toLowerCase();
  const wantsTextureType = isParticleTexture || requestedImageType === 'texture';
  const wantsSpriteFrameType = requestedImageType === 'sprite-frame' || !wantsTextureType;
  const meta = {
    ver: existing.ver || '1.0.27',
    importer: existing.importer || 'image',
    imported: existing.imported ?? true,
    uuid: existing.uuid || randomUuid(),
    files: Array.isArray(existing.files) && existing.files.length ? existing.files : ['.json', ext],
    subMetas: { ...(existing.subMetas || {}) },
    userData: { ...(existing.userData || {}) },
  };

  let changed = !existing.uuid;
  for (const [id, subMeta] of Object.entries(meta.subMetas || {})) {
    if (id !== COCOS_IMAGE_TEXTURE_SUBMETA_ID && subMeta?.importer === 'texture' && isPendingGeneratedSubMeta(subMeta)) {
      delete meta.subMetas[id];
      changed = true;
    }
    if (id !== COCOS_IMAGE_SPRITE_FRAME_SUBMETA_ID && subMeta?.importer === 'sprite-frame' && isPendingGeneratedSubMeta(subMeta)) {
      delete meta.subMetas[id];
      changed = true;
    }
  }
  const generatedSpriteFrame = meta.subMetas[COCOS_IMAGE_SPRITE_FRAME_SUBMETA_ID];
  if (wantsTextureType && generatedSpriteFrame?.importer === 'sprite-frame' && isPendingGeneratedSubMeta(generatedSpriteFrame)) {
    delete meta.subMetas[COCOS_IMAGE_SPRITE_FRAME_SUBMETA_ID];
    changed = true;
  }

  let textureRecord = meta.subMetas[COCOS_IMAGE_TEXTURE_SUBMETA_ID]?.importer === 'texture'
    ? {
        id: COCOS_IMAGE_TEXTURE_SUBMETA_ID,
        uuid: meta.subMetas[COCOS_IMAGE_TEXTURE_SUBMETA_ID].uuid || `${meta.uuid}@${COCOS_IMAGE_TEXTURE_SUBMETA_ID}`,
        subMeta: meta.subMetas[COCOS_IMAGE_TEXTURE_SUBMETA_ID],
      }
    : null;
  if (!textureRecord) {
    const id = COCOS_IMAGE_TEXTURE_SUBMETA_ID;
    textureRecord = {
      id,
      uuid: `${meta.uuid}@${id}`,
      subMeta: {
        importer: 'texture',
        uuid: `${meta.uuid}@${id}`,
        displayName,
        id,
        name: 'texture',
        userData: {
          wrapModeS,
          wrapModeT,
          imageUuidOrDatabaseUri: meta.uuid,
          isUuid: true,
          visible: false,
          minfilter: 'linear',
          magfilter: 'linear',
          mipfilter: 'none',
          anisotropy: 0,
          unityCocosPortPendingImport: true,
        },
        ver: '1.0.22',
        imported: false,
        files: [],
        subMetas: {},
      },
    };
    meta.subMetas[id] = textureRecord.subMeta;
    changed = true;
  }

  if (wantsTextureType) {
    textureRecord.subMeta.userData = {
      ...(textureRecord.subMeta.userData || {}),
      wrapModeS,
      wrapModeT,
      imageUuidOrDatabaseUri: meta.uuid,
      isUuid: true,
      visible: false,
      minfilter: 'linear',
      magfilter: 'linear',
      mipfilter: 'none',
      anisotropy: 0,
    };
  }

  let existingSpriteFrame = meta.subMetas[COCOS_IMAGE_SPRITE_FRAME_SUBMETA_ID]?.importer === 'sprite-frame'
    ? meta.subMetas[COCOS_IMAGE_SPRITE_FRAME_SUBMETA_ID]
    : null;
  if (wantsSpriteFrameType && !existingSpriteFrame) {
    const { width, height } = getImageDimensions(assetFile);
    const id = COCOS_IMAGE_SPRITE_FRAME_SUBMETA_ID;
    meta.subMetas[id] = {
      importer: 'sprite-frame',
      uuid: `${meta.uuid}@${id}`,
      displayName,
      id,
      name: 'spriteFrame',
      userData: {
        trimThreshold: 1,
        rotated: false,
        offsetX: 0,
        offsetY: 0,
        trimX: 0,
        trimY: 0,
        width,
        height,
        rawWidth: width,
        rawHeight: height,
        borderTop: 0,
        borderBottom: 0,
        borderLeft: 0,
        borderRight: 0,
        packable: true,
        pixelsToUnit: 100,
        pivotX: 0.5,
        pivotY: 0.5,
        meshType: 0,
        vertices: spriteFrameVertices(width, height),
        isUuid: true,
        imageUuidOrDatabaseUri: textureRecord.uuid,
        atlasUuid: '',
        trimType: spriteTrimType,
        unityCocosPortPendingImport: true,
      },
      ver: '1.0.12',
      imported: false,
      files: [],
      subMetas: {},
    };
    changed = true;
    existingSpriteFrame = meta.subMetas[id];
  }

  if (existingSpriteFrame) {
    existingSpriteFrame.userData = {
      ...(existingSpriteFrame.userData || {}),
      trimType: spriteTrimType,
    };
    if (spriteTrimType === 'none') {
      const { width, height } = getImageDimensions(assetFile);
      Object.assign(existingSpriteFrame.userData, {
        offsetX: 0,
        offsetY: 0,
        trimX: 0,
        trimY: 0,
        width,
        height,
        rawWidth: width,
        rawHeight: height,
        vertices: spriteFrameVertices(width, height),
      });
    }
  }

  meta.userData = {
    ...meta.userData,
    type: wantsTextureType ? 'texture' : 'sprite-frame',
    fixAlphaTransparencyArtifacts,
    hasAlpha: true,
    redirect: textureRecord.uuid,
  };

  if (wantsTextureType) {
    meta.userData = {
      ...meta.userData,
      type: 'texture',
      flipVertical: false,
      fixAlphaTransparencyArtifacts,
      flipGreenChannel: false,
      hasAlpha: true,
      redirect: textureRecord.uuid,
    };
  }

  if (changed || JSON.stringify(existing) !== JSON.stringify(meta)) {
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

function ensureFontAssetMeta(assetFile) {
  const metaFile = `${assetFile}.meta`;
  const existing = readJsonIfExists(metaFile) || {};
  const meta = {
    ver: existing.ver || '1.0.1',
    importer: existing.importer || 'ttf-font',
    imported: existing.imported ?? true,
    uuid: existing.uuid || randomUuid(),
    files: Array.isArray(existing.files) && existing.files.length
      ? existing.files : ['.json', path.basename(assetFile)],
    subMetas: {},
    userData: { ...(existing.userData || {}) },
  };
  if (JSON.stringify(existing) !== JSON.stringify(meta)) {
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }
  return meta;
}

function ensureModelAssetMeta(assetFile, config = {}) {
  const metaFile = `${assetFile}.meta`;
  const existing = readJsonIfExists(metaFile) || {};
  const ext = path.extname(assetFile).toLowerCase();
  const importer = ext === '.fbx' ? 'fbx' : ['.gltf', '.glb'].includes(ext) ? 'gltf' : 'asset';
  const stem = path.basename(assetFile, ext);
  const meta = {
    ver: existing.ver || '2.3.14',
    importer: existing.importer || importer,
    imported: existing.imported ?? true,
    uuid: existing.uuid || randomUuid(),
    files: Array.isArray(existing.files) ? existing.files : [],
    subMetas: { ...(existing.subMetas || {}) },
    userData: { ...(existing.userData || {}) },
  };

  let changed = !existing.uuid;
  const importedMeshesExist = hasImportedSubMeta(meta.subMetas, 'gltf-mesh');

  // If Cocos has already fully imported this model, remove any stale pending
  // placeholder sub-assets the port tool added in earlier runs.  Keeping them
  // causes the Cocos editor to attempt (and fail) to re-import those sub-assets
  // with "Importer exec failed: <file>@<id>" because the importer no longer
  // finds a matching mesh for the placeholder gltfIndex.
  const fbxAlreadyImported = meta.imported === true && importedMeshesExist;
  if (fbxAlreadyImported) {
    for (const [id, subMeta] of Object.entries(meta.subMetas)) {
      if (subMeta?.importer === 'gltf-mesh' && isPendingGeneratedSubMeta(subMeta)) {
        delete meta.subMetas[id];
        changed = true;
      }
    }
  }

  const meshNameHint = config.meshNameHint || '';
  const hintResolved = meshNameHint ? findSubMetaRecordByName(meta.uuid, meta.subMetas, 'gltf-mesh', meshNameHint) : null;
  if (!importedMeshesExist || (meshNameHint && !hintResolved && !fbxAlreadyImported)) {
    const extracted = ext === '.fbx' ? extractFbxMeshNames(assetFile) : [];
    const meshNames = prioritizedNames(meshNameHint, meshNameHint ? extracted.filter((name) => normalizeKey(name).includes(normalizeKey(meshNameHint))) : extracted, stem);
    const namesToCreate = meshNameHint ? [meshNames[0]] : meshNames;
    let gltfIndex = Object.values(meta.subMetas).filter((subMeta) => subMeta?.importer === 'gltf-mesh').length;
    for (const meshName of namesToCreate) {
      const existingRecord = findSubMetaRecordByName(meta.uuid, meta.subMetas, 'gltf-mesh', meshName);
      const replacesPendingGltfMesh = existingRecord && isPendingGeneratedSubMeta(existingRecord.subMeta);
      const preferredId = importer === 'gltf' && (gltfIndex === 0 || replacesPendingGltfMesh) ? '1ebeb' : '';
      if (existingRecord) {
        if (!preferredId || existingRecord.id === preferredId || !isPendingGeneratedSubMeta(existingRecord.subMeta)) continue;
        delete meta.subMetas[existingRecord.id];
        changed = true;
      }
      const subMetaGltfIndex = preferredId === '1ebeb' ? 0 : gltfIndex;
      const id = preferredId && !meta.subMetas[preferredId]
        ? preferredId
        : uniqueSubMetaId(meta.subMetas, `${meta.uuid}:gltf-mesh:${meshName}`);
      meta.subMetas[id] = {
        importer: 'gltf-mesh',
        uuid: `${meta.uuid}@${id}`,
        displayName: '',
        id,
        name: `${meshName}.mesh`,
        userData: {
          gltfIndex: subMetaGltfIndex,
          unityCocosPortPendingImport: true,
        },
        ver: '1.1.1',
        imported: false,
        files: subMetaFilesForImportedState(false, ['.bin', '.json']),
        subMetas: {},
      };
      gltfIndex = Math.max(gltfIndex, subMetaGltfIndex + 1);
      changed = true;
    }
  }

  if (changed) fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return meta;
}

function ensurePreparedAssetMeta(assetFile, kind, config = {}) {
  if (kind === 'image') return ensureImageAssetMeta(assetFile, config);
  if (kind === 'model') return ensureModelAssetMeta(assetFile, config);
  if (kind === 'material') return ensureMaterialAssetMeta(assetFile, config);
  if (kind === 'font') return ensureFontAssetMeta(assetFile, config);
  return '';
}

function importedUnitySpineAssetPath(unityAsset, options) {
  if (!unityAsset?.relativePath) return '';
  const relativePath = toPosix(unityAsset.relativePath)
    .replace(/\.atlas\.txt$/i, '.atlas')
    .replace(/\.skel\.bytes$/i, '.skel');
  return path.join(options.cocosRoot, 'assets', 'unity_imported', relativePath);
}

function ensureSpineAtlasMeta(assetFile, options) {
  const metaFile = `${assetFile}.meta`;
  const existing = readJsonIfExists(metaFile) || {};
  const relativePath = toPosix(path.relative(options.cocosRoot, assetFile));
  const ext = path.extname(assetFile).toLowerCase();
  const meta = {
    ver: existing.ver || '1.0.0',
    importer: existing.importer || '*',
    imported: existing.imported ?? true,
    uuid: existing.uuid || stableUuid(`spine-atlas:${relativePath}`),
    files: Array.isArray(existing.files) && existing.files.length ? existing.files : [ext || '.atlas', '.json'],
    subMetas: {},
    userData: { ...(existing.userData || {}) },
  };
  if (!options.dryRun && JSON.stringify(existing) !== JSON.stringify(meta)) {
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }
  return meta;
}

function ensureSpineDataMeta(assetFile, atlasUuid, options) {
  const metaFile = `${assetFile}.meta`;
  const existing = readJsonIfExists(metaFile) || {};
  const relativePath = toPosix(path.relative(options.cocosRoot, assetFile));
  const ext = path.extname(assetFile).toLowerCase();
  const files = ext === '.skel' ? ['.bin', '.json'] : ['.json'];
  const meta = {
    ver: existing.ver || '1.2.7',
    importer: existing.importer || 'spine-data',
    imported: existing.imported ?? true,
    uuid: existing.uuid || stableUuid(`spine-data:${relativePath}`),
    files,
    subMetas: {},
    userData: {
      ...(existing.userData || {}),
      atlasUuid,
    },
  };
  if (!options.dryRun && JSON.stringify(existing) !== JSON.stringify(meta)) {
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }
  return meta;
}

function parseSpineAtlasTextureNames(atlasFile) {
  if (!atlasFile || !fs.existsSync(atlasFile)) return [];
  const lines = fs.readFileSync(atlasFile, 'utf8').split(/\r?\n/);
  const names = [];
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    if (/^[^:#]+\.(png|jpg|jpeg|webp)$/i.test(trimmed)) names.push(trimmed);
  }
  return [...new Set(names)];
}

function copyPreparedSpineAsset(sourceFile, destFile, options) {
  if (!sourceFile || !destFile || !fs.existsSync(sourceFile) || options.dryRun) return;
  ensureDir(path.dirname(destFile));
  ensureDirectoryMetas(path.dirname(destFile), path.join(options.cocosRoot, 'assets'));
  copyAssetIfChanged(sourceFile, destFile);
}

function resolveCurrentSpineDataUuid(assetFile, options) {
  if (!assetFile || !fs.existsSync(assetFile)) return '';
  const libraryUuid = resolveLibraryAssetUuid(assetFile, options, 'sp.SkeletonData', { forceReload: true });
  if (libraryUuid) return libraryUuid;
  return readJsonIfExists(`${assetFile}.meta`)?.uuid || '';
}

function resolveUnitySpineSkeletonDataUuid(skeletonDataRef, options, unityDb, reporter) {
  const skeletonDataAsset = unityDb.get(unityRefGuid(skeletonDataRef));
  if (!skeletonDataAsset?.path || !fs.existsSync(skeletonDataAsset.path)) {
    reporter.medium('SPINE_DATA_ASSET_UNRESOLVED', '', '', 'Unity SkeletonData asset could not be resolved');
    return '';
  }

  const docs = parseUnityYaml(skeletonDataAsset.path);
  const skeletonDoc = docs[0];
  if (!skeletonDoc) {
    reporter.medium('SPINE_DATA_ASSET_UNPARSEABLE', skeletonDataAsset.relativePath, '', 'Unity SkeletonData asset could not be parsed');
    return '';
  }

  const skeletonJsonAsset = unityDb.get(unityRefGuid(getField(skeletonDoc, 'skeletonJSON')));
  if (!skeletonJsonAsset?.path || !fs.existsSync(skeletonJsonAsset.path)) {
    reporter.medium('SPINE_JSON_UNRESOLVED', skeletonDataAsset.relativePath, '', 'Spine skeleton JSON/BIN source could not be resolved from SkeletonData asset');
    return '';
  }

  const atlasAssetRef = getNestedList(skeletonDoc, 'atlasAssets')[0] || null;
  const atlasAsset = unityDb.get(unityRefGuid(atlasAssetRef));
  let atlasTextAsset = atlasAsset;
  if (atlasAsset?.ext === '.asset' && atlasAsset.path && fs.existsSync(atlasAsset.path)) {
    const atlasDocs = parseUnityYaml(atlasAsset.path);
    const atlasDoc = atlasDocs[0];
    atlasTextAsset = unityDb.get(unityRefGuid(getField(atlasDoc || { lines: [] }, 'atlasFile')));
  }
  if (!atlasTextAsset?.path || !fs.existsSync(atlasTextAsset.path)) {
    reporter.medium('SPINE_ATLAS_UNRESOLVED', skeletonDataAsset.relativePath, '', 'Spine atlas text file could not be resolved from SkeletonData asset');
    return '';
  }

  const skeletonDataDest = importedUnitySpineAssetPath(skeletonJsonAsset, options);
  const atlasDest = importedUnitySpineAssetPath(atlasTextAsset, options);
  copyPreparedSpineAsset(skeletonJsonAsset.path, skeletonDataDest, options);
  copyPreparedSpineAsset(atlasTextAsset.path, atlasDest, options);

  for (const textureName of parseSpineAtlasTextureNames(atlasTextAsset.path)) {
    const textureSource = path.join(path.dirname(atlasTextAsset.path), textureName);
    if (!fs.existsSync(textureSource)) continue;
    copyUnityAssetToCocosImpl({
      path: textureSource,
      relativePath: toPosix(path.join(path.dirname(atlasTextAsset.relativePath), textureName)),
    }, options, reporter, 'image', 'low', { deferNeedsImportReport: true });
  }

  const atlasMeta = ensureSpineAtlasMeta(atlasDest, options);
  const skeletonMeta = ensureSpineDataMeta(skeletonDataDest, atlasMeta.uuid, options);
  const skeletonDataUuid = resolveCurrentSpineDataUuid(skeletonDataDest, options) || skeletonMeta.uuid;

  reporter.low(
    'SPINE_DATA_ASSET_PREPARED',
    skeletonDataAsset.relativePath,
    toPosix(path.relative(options.cocosRoot, skeletonDataDest)),
    'Spine skeleton data and atlas assets were prepared for Cocos sp.Skeleton wiring'
  );

  return skeletonDataUuid;
}

function resolveImportedModelAsset(assetFile, options, meshNameHint = '') {
  if (!assetFile || !fs.existsSync(assetFile)) return null;
  const ext = path.extname(assetFile).toLowerCase();
  if (ext === '.asset') {
    const meshRecord = matchLibraryAssetRecordByName(
      libraryAssetRecordsForFile(assetFile, options, 'cc.Mesh', { forceReload: true, includeBase: true, includeSubAssets: true, all: true }),
      meshNameHint,
    );
    if (!meshRecord) return null;
    const materialUuids = libraryAssetRecordsForFile(assetFile, options, 'cc.Material', { forceReload: true, includeBase: true, includeSubAssets: true, all: true })
      .map((record) => record.uuid);
    return {
      meshUuid: meshRecord.uuid,
      materialUuid: materialUuids[0] || '',
      materialUuids,
      source: toPosix(path.relative(options.cocosRoot, assetFile)),
      fallbackExt: ext,
      pendingImport: false,
    };
  }
  if (!['.fbx', '.gltf', '.glb'].includes(ext)) return null;
  const meta = readJsonIfExists(`${assetFile}.meta`);
  if (!meta?.uuid) return null;
  let mesh = meshNameHint ? findSubMetaRecordByName(meta.uuid, meta.subMetas, 'gltf-mesh', meshNameHint) : null;
  if (!mesh) {
    const fallback = firstSubMetaRecord(meta.uuid, meta.subMetas, 'gltf-mesh');
    if (meshNameHint && fallback && isPendingGeneratedSubMeta(fallback.subMeta)) return null;
    mesh = fallback;
  }
  if (!mesh) return null;
  const materials = subMetaRecords(meta.uuid, meta.subMetas, 'gltf-material');
  return {
    meshUuid: mesh.uuid,
    materialUuid: materials[0]?.uuid || '',
    materialUuids: materials.map((material) => material.uuid),
    source: toPosix(path.relative(options.cocosRoot, assetFile)),
    fallbackExt: ext,
    pendingImport: isPendingGeneratedSubMeta(mesh.subMeta),
  };
}

function sleepMs(ms) {
  if (ms <= 0) return;
  if (typeof Atomics?.wait === 'function' && typeof SharedArrayBuffer === 'function') {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    return;
  }
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

/**
 * NGÂN SÁCH CHỜ IMPORT — nguyên nhân thật của PERF-01.
 * =====================================================
 * Porter chờ Cocos Creator import asset vừa copy (sprite/model) để lấy UUID của
 * sub-asset trong `library/`. Mặc định chờ tới 10.000ms MỖI asset.
 *
 * Khi Cocos Creator KHÔNG chạy, sẽ không bao giờ có ai import — nên mỗi asset
 * đốt trọn 10s vô ích. Đo trên MyCozyHome: prefab `BoxHeaderTop` mất 123s,
 * trong đó 116s là chờ (12 sprite × ~10s), chỉ ~6s là xử lý thật.
 *
 * Cơ chế: nếu N lần chờ đầu tiên đều hết hạn mà không có kết quả, kết luận
 * "không có importer" và BỎ chờ cho mọi asset còn lại trong lần chạy này.
 * Một asset import thành công sẽ reset lại phán quyết đó.
 */
const importWaitBudget = {
  consecutiveTimeouts: 0,
  totalWaitedMs: 0,
  skippedWaits: 0,
  giveUpAfter: 2,
  disabled: false,

  sawSuccess: false,
  probeMs: 1500,

  /** Thời gian tối đa được phép chờ cho asset kế tiếp (0 = không chờ). */
  budgetFor(options) {
    // A dry-run is a pure planning pass. It must never wait for an editor-side
    // importer because no copied asset can appear and no output UUID can be
    // persisted by this invocation. Keep this check ahead of every configured
    // timeout/probe so callers do not need the redundant --no-import-wait flag.
    if (options?.dryRun) return 0;
    const configured = Math.max(0, Number(options?.modelImportWaitMs ?? DEFAULT_MODEL_IMPORT_WAIT_MS) || 0);
    if (configured === 0) return 0;
    if (this.disabled) {
      this.skippedWaits += 1;
      return 0;
    }
    // Chưa từng có asset nào import xong => chỉ PROBE ngắn. Nếu Cocos Creator
    // đang chạy thì asset đầu tiên xuất hiện rất nhanh; nếu không chạy thì ta
    // mất 1,5s thay vì 10s cho mỗi lần thăm dò.
    if (!this.sawSuccess) return Math.min(configured, this.probeMs);
    return configured;
  },

  /** Ghi nhận kết quả một lần chờ để quyết định có tiếp tục chờ nữa không. */
  record(resolved, waitedMs) {
    this.totalWaitedMs += Math.max(0, waitedMs);
    if (resolved) {
      this.consecutiveTimeouts = 0;
      this.disabled = false;
      this.sawSuccess = true; // từ giờ mới dùng timeout đầy đủ
      return;
    }
    if (waitedMs <= 0) return; // không thực sự chờ thì không tính
    this.consecutiveTimeouts += 1;
    if (!this.disabled && this.consecutiveTimeouts >= this.giveUpAfter) {
      this.disabled = true;
      // KHÔNG kết luận "Cocos không chạy": đo được rằng ngay cả khi editor đang
      // mở, Cocos cũng không import file vừa copy trong vài giây — nó chỉ quét
      // lại asset khi được refresh. Nên chỉ nói đúng sự thật quan sát được.
      log(
        `${this.consecutiveTimeouts} lần chờ import đều hết hạn — asset vừa copy chưa được Cocos import. ` +
        'Bỏ chờ cho các asset còn lại (prefab vẫn được ghi, chỉ thiếu UUID sub-asset của sprite/mesh).'
      );
      log(
        'Cách nối UUID: refresh asset trong Cocos Creator (menu Assets > Refresh, hoặc MCP ' +
        '`project_refresh_assets`) rồi chạy lại đúng lệnh này — lần hai sẽ tìm thấy ngay. ' +
        'Dùng --no-import-wait nếu chủ động không cần nối UUID.'
      );
    }
  },

  summary() {
    if (!this.totalWaitedMs && !this.skippedWaits) return '';
    const parts = [`đã chờ import ${(this.totalWaitedMs / 1000).toFixed(1)}s`];
    if (this.skippedWaits) parts.push(`bỏ chờ ${this.skippedWaits} asset`);
    return parts.join(', ');
  },
};

function waitForImportedModelAsset(assetFile, options, meshNameHint = '') {
  let resolved = resolveImportedModelAsset(assetFile, options, meshNameHint);
  if (resolved && !resolved.pendingImport) return resolved;

  const timeout = importWaitBudget.budgetFor(options);
  const startedAt = Date.now();
  const deadline = startedAt + timeout;
  while ((!resolved || resolved.pendingImport) && Date.now() < deadline) {
    sleepMs(Math.min(100, deadline - Date.now()));
    resolved = resolveImportedModelAsset(assetFile, options, meshNameHint);
  }
  importWaitBudget.record(resolved && !resolved.pendingImport, Date.now() - startedAt);
  return resolved;
}

function assetDbUrlForFile(assetFile, options) {
  const assetsRoot = path.join(options.cocosRoot, 'assets');
  const relative = path.relative(assetsRoot, assetFile);
  if (!relative || relative.startsWith('..')) return '';
  return `db://assets/${toPosix(relative)}`;
}

function loadLibraryAssetData(options, forceReload = false) {
  if (!forceReload && options._libraryAssetData !== undefined) return options._libraryAssetData;
  options._libraryAssetData = readJsonIfExists(path.join(options.cocosRoot, 'library', '.assets-data.json')) || {};
  return options._libraryAssetData;
}

function libraryAssetGroupsForFile(assetFile, options, config = {}) {
  const url = assetDbUrlForFile(assetFile, options);
  if (!url) return [];

  const assetData = loadLibraryAssetData(options, Boolean(config.forceReload));
  const groups = new Map();
  let order = 0;
  for (const [key, entry] of Object.entries(assetData || {})) {
    const entryUrl = entry?.url;
    if (!entryUrl || (entryUrl !== url && !String(entryUrl).startsWith(`${url}@`))) continue;
    const baseUuid = key.split('@')[0];
    if (!groups.has(baseUuid)) groups.set(baseUuid, { baseUuid, order: order++, uuids: new Set() });
    groups.get(baseUuid).uuids.add(key);
  }

  return [...groups.values()].sort((a, b) => b.order - a.order);
}

function libraryJsonPathForUuid(options, uuid) {
  return path.join(options.cocosRoot, 'library', uuid.slice(0, 2), `${uuid}.json`);
}

function libraryAssetRecordsForFile(assetFile, options, typeNames, config = {}) {
  const expected = new Set((Array.isArray(typeNames) ? typeNames : [typeNames]).filter(Boolean));
  if (!expected.size) return [];

  const results = [];
  const seen = new Set();
  for (const candidate of libraryAssetGroupsForFile(assetFile, options, config)) {
    const candidateUuids = [];
    if (config.includeBase !== false) candidateUuids.push(candidate.baseUuid);
    if (config.includeSubAssets !== false) candidateUuids.push(...[...candidate.uuids].filter((uuid) => uuid.includes('@')).sort());
    for (const uuid of candidateUuids) {
      if (!uuid || seen.has(uuid)) continue;
      const json = readJsonIfExists(libraryJsonPathForUuid(options, uuid));
      const type = Array.isArray(json) ? json[0]?.__type__ : json?.__type__;
      if (!type || !expected.has(type)) continue;
      seen.add(uuid);
      results.push({ uuid, json });
      if (!config.all) return results;
    }
  }
  return results;
}

function resolveLibrarySubAssetUuid(assetFile, options, typeNames, config = {}) {
  return libraryAssetRecordsForFile(assetFile, options, typeNames, { ...config, includeBase: false })[0]?.uuid || '';
}

function resolveLibraryAssetUuid(assetFile, options, typeNames, config = {}) {
  return libraryAssetRecordsForFile(assetFile, options, typeNames, config)[0]?.uuid || '';
}

function matchLibraryAssetRecordByName(records, nameHint = '') {
  const hint = normalizeKey(nameHint);
  if (hint) {
    for (const record of records) {
      if (normalizeKey(record.json?._name || '').includes(hint)) return record;
    }
  }
  return records[0] || null;
}

function resolveCurrentSpriteFrameUuid(assetFile, options) {
  const libraryUuid = resolveLibrarySubAssetUuid(assetFile, options, 'cc.SpriteFrame', { forceReload: true });
  if (libraryUuid) return libraryUuid;
  return resolveImportedSpriteAsset(assetFile);
}

function waitForCurrentSpriteFrameUuid(assetFile, options) {
  let libraryUuid = resolveLibrarySubAssetUuid(assetFile, options, 'cc.SpriteFrame', { forceReload: true });
  if (libraryUuid) return libraryUuid;

  const timeout = importWaitBudget.budgetFor(options);
  const startedAt = Date.now();
  const deadline = startedAt + timeout;
  while (!libraryUuid && Date.now() < deadline) {
    sleepMs(Math.min(100, deadline - Date.now()));
    libraryUuid = resolveLibrarySubAssetUuid(assetFile, options, 'cc.SpriteFrame', { forceReload: true });
  }
  importWaitBudget.record(!!libraryUuid, Date.now() - startedAt);
  if (libraryUuid) return libraryUuid;
  return resolveImportedSpriteAsset(assetFile);
}

function resolveCurrentStandaloneMaterialUuid(assetFile, options) {
  if (!assetFile || !fs.existsSync(assetFile)) return '';
  return resolveLibraryAssetUuid(assetFile, options, 'cc.Material', { forceReload: true });
}

function resolveCurrentFontUuid(assetFile, options) {
  if (!assetFile || !fs.existsSync(assetFile)) return '';
  const libraryUuid = resolveLibraryAssetUuid(assetFile, options, 'cc.TTFFont', { forceReload: true });
  if (libraryUuid) return libraryUuid;
  const meta = readJsonIfExists(`${assetFile}.meta`);
  return meta?.uuid || '';
}

function inferModelSubMetaFromLibraryUuid(uuid, assetFile, options) {
  const file = libraryJsonPathForUuid(options, uuid);
  const json = readJsonIfExists(file);
  if (!json) return null;

  const id = uuid.split('@')[1] || '';
  const stem = path.basename(assetFile, path.extname(assetFile));
  const withFiles = (meta, suffixes) => ({
    ...meta,
    files: suffixes.filter((suffix) => fs.existsSync(file.replace(/\.json$/i, suffix))),
    subMetas: {},
    imported: true,
  });

  if (Array.isArray(json) && json[0]?.__type__ === 'cc.Prefab') {
    return withFiles({ importer: 'gltf-scene', uuid, displayName: '', id, name: `${stem}.prefab`, ver: '1.0.14', userData: {} }, ['.json']);
  }
  if (json.__type__ === 'cc.Mesh') {
    return withFiles({ importer: 'gltf-mesh', uuid, displayName: '', id, name: `${json._name || stem}.mesh`, ver: '1.1.1', userData: {} }, ['.bin', '.json']);
  }
  if (json.__type__ === 'cc.Material') {
    return withFiles({ importer: 'gltf-material', uuid, displayName: '', id, name: `${json._name || stem}.material`, ver: '1.0.14', userData: {} }, ['.json']);
  }
  if (json.__type__ === 'cc.ImageAsset') {
    return withFiles({ importer: 'gltf-embeded-image', uuid, displayName: '', id, name: `${stem}-${id}.image`, ver: '1.0.3', userData: { type: 'texture' } }, ['.json', '.png', '.jpg', '.jpeg', '.webp']);
  }
  if (json.__type__ === 'cc.Texture2D') {
    const imageUuid = Array.isArray(json.content?.mipmaps) ? json.content.mipmaps[0] || '' : '';
    return withFiles({
      importer: 'texture',
      uuid,
      displayName: '',
      id,
      name: `${stem}-${id}.texture`,
      ver: '1.0.22',
      userData: imageUuid ? { isUuid: true, imageUuidOrDatabaseUri: imageUuid } : {},
    }, ['.json']);
  }
  return null;
}

function tempImportedModelGltfPath(baseUuid, options) {
  if (!baseUuid) return '';
  return path.join(options.cocosRoot, 'temp', 'asset-db', 'assets', 'fbx.FBX-glTF-conv', baseUuid, 'output', 'out.gltf');
}

function inferModelSubMetasFromTempOutput(candidate, assetFile, options) {
  const assetData = loadLibraryAssetData(options, true);
  const gltf = readJsonIfExists(tempImportedModelGltfPath(candidate.baseUuid, options));
  if (!gltf || !Array.isArray(gltf.meshes) || !gltf.meshes.length) return {};

  const sameBase = (uuid) => String(uuid || '').startsWith(`${candidate.baseUuid}@`);
  const candidateEntries = [...candidate.uuids]
    .filter((uuid) => uuid.includes('@'))
    .map((uuid) => ({ uuid, entry: assetData[uuid] || {} }));
  const sceneEntry = candidateEntries.find(({ entry }) => {
    const depends = Array.isArray(entry?.value?.depends) ? entry.value.depends : [];
    return depends.some((dep) => sameBase(dep));
  });
  const sceneDepends = Array.isArray(sceneEntry?.entry?.value?.depends) ? sceneEntry.entry.value.depends : [];

  const isImageLike = (entry) => Boolean(entry?.value && Object.prototype.hasOwnProperty.call(entry.value, 'imageExtName'));
  const hasDepends = (entry) => Array.isArray(entry?.value?.depends) && entry.value.depends.length > 0;

  const meshUuids = sceneDepends.filter((uuid) => {
    if (!sameBase(uuid)) return false;
    const entry = assetData[uuid] || {};
    return !isImageLike(entry) && !hasDepends(entry);
  });
  const materialUuids = sceneDepends.filter((uuid) => {
    if (!sameBase(uuid)) return false;
    const entry = assetData[uuid] || {};
    return !isImageLike(entry) && hasDepends(entry);
  });

  const subMetas = {};
  for (let index = 0; index < Math.min(meshUuids.length, gltf.meshes.length); index += 1) {
    const uuid = meshUuids[index];
    const id = uuid.split('@')[1] || '';
    const mesh = gltf.meshes[index] || {};
    subMetas[id] = {
      importer: 'gltf-mesh',
      uuid,
      displayName: '',
      id,
      name: `${mesh.name || path.basename(assetFile, path.extname(assetFile))}.mesh`,
      userData: { gltfIndex: index },
      ver: '1.1.1',
      imported: true,
      files: ['.bin', '.json'],
      subMetas: {},
    };
  }

  const materials = Array.isArray(gltf.materials) ? gltf.materials : [];
  for (let index = 0; index < Math.min(materialUuids.length, materials.length); index += 1) {
    const uuid = materialUuids[index];
    const id = uuid.split('@')[1] || '';
    const material = materials[index] || {};
    subMetas[id] = {
      importer: 'gltf-material',
      uuid,
      displayName: '',
      id,
      name: `${material.name || path.basename(assetFile, path.extname(assetFile))}.material`,
      userData: { gltfIndex: index },
      ver: '1.0.14',
      imported: true,
      files: ['.json'],
      subMetas: {},
    };
  }

  if (sceneEntry?.uuid) {
    const id = sceneEntry.uuid.split('@')[1] || '';
    subMetas[id] = {
      importer: 'gltf-scene',
      uuid: sceneEntry.uuid,
      displayName: '',
      id,
      name: `${path.basename(assetFile, path.extname(assetFile))}.prefab`,
      userData: { gltfIndex: 0 },
      ver: '1.0.14',
      imported: true,
      files: ['.json'],
      subMetas: {},
    };
  }

  return subMetas;
}

function recoverModelMetaFromLibrary(assetFile, options) {
  const metaFile = `${assetFile}.meta`;
  const existing = readJsonIfExists(metaFile) || {};
  if (hasImportedSubMeta(existing.subMetas, 'gltf-mesh')) return existing;

  const candidates = libraryAssetGroupsForFile(assetFile, options);
  for (const candidate of candidates) {
    const subMetas = {};
    for (const uuid of [...candidate.uuids].filter((value) => value.includes('@')).sort()) {
      const subMeta = inferModelSubMetaFromLibraryUuid(uuid, assetFile, options);
      if (!subMeta) continue;
      subMetas[subMeta.id] = subMeta;
    }
    if (!Object.values(subMetas).some((subMeta) => subMeta.importer === 'gltf-mesh')) {
      Object.assign(subMetas, inferModelSubMetasFromTempOutput(candidate, assetFile, options));
    }
    if (!Object.values(subMetas).some((subMeta) => subMeta.importer === 'gltf-mesh')) continue;

    const ext = path.extname(assetFile).toLowerCase();
    const recovered = {
      ver: existing.ver || '2.3.14',
      importer: existing.importer || (ext === '.fbx' ? 'fbx' : 'gltf'),
      imported: true,
      uuid: candidate.baseUuid,
      files: Array.isArray(existing.files) ? existing.files : [],
      subMetas,
      userData: existing.userData || {},
    };
    fs.writeFileSync(metaFile, `${JSON.stringify(recovered, null, 2)}\n`, 'utf8');
    return recovered;
  }

  return null;
}

function buildUnityPrefabModel(file, unityDb, reporter, options, recursionDepth = 0) {
  const docs = parseUnityYaml(file);
  const byId = new Map(docs.map((doc) => [doc.fileId, doc]));
  const gameObjects = new Map();
  const transforms = new Map();
  const componentDocs = new Map();
  const prefabInstances = [];
  const prefabInstanceInfos = new Map();

  for (const doc of docs) {
    if (doc.classId === 1) {
      const components = getNestedList(doc, 'm_Component')
        .map((item) => unityRefFileId(item.component || item))
        .filter(Boolean);
      gameObjects.set(doc.fileId, {
        fileId: doc.fileId,
        name: String(getField(doc, 'm_Name', 'GameObject')),
        layer: Number(getField(doc, 'm_Layer', 0) || 0),
        active: Number(getField(doc, 'm_IsActive', 1)) !== 0,
        components,
        transformId: 0,
      });
      continue;
    }

    if (doc.classId === 4 || doc.classId === 224) {
      const gameObjectId = unityRefFileId(getField(doc, 'm_GameObject'));
      const parentId = unityRefFileId(getField(doc, 'm_Father'));
      const children = getNestedList(doc, 'm_Children').map(unityRefFileId).filter(Boolean);
      const localPosition = getField(doc, 'm_LocalPosition', { x: 0, y: 0, z: 0 });
      const anchoredPosition = doc.classId === 224 ? getField(doc, 'm_AnchoredPosition', null) : null;
      transforms.set(doc.fileId, {
        fileId: doc.fileId,
        gameObjectId,
        parentId,
        children,
        isRect: doc.classId === 224,
        localPosition,
        anchoredPosition: anchoredPosition
          ? { x: anchoredPosition.x ?? 0, y: anchoredPosition.y ?? 0 }
          : null,
        localRotation: getField(doc, 'm_LocalRotation', { x: 0, y: 0, z: 0, w: 1 }),
        localScale: getField(doc, 'm_LocalScale', { x: 1, y: 1, z: 1 }),
        euler: getField(doc, 'm_LocalEulerAnglesHint', { x: 0, y: 0, z: 0 }),
        sizeDelta: getField(doc, 'm_SizeDelta', { x: 100, y: 100 }),
        anchorMin: getField(doc, 'm_AnchorMin', { x: 0.5, y: 0.5 }),
        anchorMax: getField(doc, 'm_AnchorMax', { x: 0.5, y: 0.5 }),
        anchor: getField(doc, 'm_Pivot', { x: 0.5, y: 0.5 }),
      });
      const go = gameObjects.get(gameObjectId);
      if (go) go.transformId = doc.fileId;
      continue;
    }

    if (doc.classId === 1001) {
      prefabInstances.push(doc);
      prefabInstanceInfos.set(doc.fileId, parsePrefabInstanceInfo(doc));
      continue;
    }

    componentDocs.set(doc.fileId, doc);
  }

  if (prefabInstances.length) {
    reporter.add(
      options.recursive ? 'low' : 'medium',
      'NESTED_PREFAB_INSTANCE',
      file,
      '',
      `${prefabInstances.length} nested PrefabInstance records detected`,
      options.recursive
        ? 'Recursive pass links nested Unity prefabs to generated Cocos prefabs when possible and reports model/unsupported placeholders.'
        : 'Run with --recursive to inspect nested prefab sources and report dependencies.'
    );
    if (options.recursive) {
      for (const instance of prefabInstances) inspectPrefabInstanceDependency(instance, unityDb, reporter, file, recursionDepth);
    }
  }

  materializeStrippedTransforms({
    file,
    byId,
    gameObjects,
    transforms,
    componentDocs,
    prefabInstanceInfos,
    unityDb,
    reporter,
    options,
    recursionDepth,
  });
  normalizeTransformChildLinks(transforms);

  const roots = [...transforms.values()].filter((transform) => isRootTransform(transform, transforms, gameObjects));
  if (roots.length === 0) {
    reporter.high('PREFAB_NO_ROOT', file, '', 'Unity prefab has no root transform');
  }
  inheritRootLayersFromDescendants(roots, gameObjects, transforms, reporter, file);

  const is3DObject = isUnityPrefabLikely3D(gameObjects, componentDocs, transforms);
  return { file, docs, byId, gameObjects, transforms, componentDocs, roots, is3DObject };
}

function hasEmittableGameObject(transform, gameObjects) {
  return Boolean(transform?.gameObjectId && gameObjects.has(transform.gameObjectId));
}

function isRootTransform(transform, transforms, gameObjects) {
  if (!hasEmittableGameObject(transform, gameObjects)) return false;
  const parent = transforms.get(transform.parentId);
  return !hasEmittableGameObject(parent, gameObjects);
}

function normalizeTransformChildLinks(transforms) {
  for (const transform of transforms.values()) {
    const parent = transforms.get(transform.parentId);
    if (!parent || parent.fileId === transform.fileId) continue;
    if (!parent.children.includes(transform.fileId)) parent.children.push(transform.fileId);
  }
}

function isUnityPrefabLikely3D(gameObjects, componentDocs, transforms) {
  for (const gameObject of gameObjects.values()) {
    for (const componentId of gameObject.components || []) {
      const classId = Number(componentDocs.get(componentId)?.classId || 0);
      if (UNITY_3D_PREFAB_COMPONENT_HINTS.has(classId)) return true;
    }
  }

  const epsilon = 1e-4;
  for (const transform of transforms.values()) {
    const positionZ = Number(transform?.localPosition?.z || 0);
    const rotationX = Number(transform?.euler?.x || 0);
    const rotationY = Number(transform?.euler?.y || 0);
    const scaleZ = Number(transform?.localScale?.z == null ? 1 : transform.localScale.z);
    if (Math.abs(positionZ) > epsilon) return true;
    if (Math.abs(rotationX) > epsilon || Math.abs(rotationY) > epsilon) return true;
    if (Math.abs(scaleZ - 1) > epsilon) return true;
  }

  return false;
}

function inheritRootLayersFromDescendants(roots, gameObjects, transforms, reporter, file) {
  for (const root of roots) {
    const rootGameObject = gameObjects.get(root.gameObjectId);
    if (!rootGameObject || Number(rootGameObject.layer) !== 0) continue;

    const descendantLayers = new Set();
    const stack = [...(root.children || [])];
    while (stack.length) {
      const transformId = stack.pop();
      const transform = transforms.get(transformId);
      if (!transform) continue;
      const gameObject = gameObjects.get(transform.gameObjectId);
      if (gameObject && Number(gameObject.layer) !== 0) descendantLayers.add(Number(gameObject.layer));
      for (const childId of transform.children || []) stack.push(childId);
    }

    if (descendantLayers.size === 1) {
      const inheritedLayer = [...descendantLayers][0];
      rootGameObject.layer = inheritedLayer;
      reporter.low('ROOT_LAYER_INHERITED', file, rootGameObject.name, `Root Unity layer 0 inherited descendant layer ${inheritedLayer}`);
    }
  }
}

function inspectPrefabInstanceDependency(doc, unityDb, reporter, ownerFile, recursionDepth) {
  const source = getField(doc, 'm_SourcePrefab');
  const guid = unityRefGuid(source);
  if (!guid) return;
  const asset = unityDb.get(guid);
  if (!asset) {
    reporter.high('NESTED_PREFAB_GUID_MISSING', ownerFile, '', 'Nested prefab source guid was not found in Unity meta database', guid);
    return;
  }
  if (recursionDepth > 8) {
    reporter.medium('NESTED_PREFAB_RECURSION_LIMIT', asset.path, '', 'Nested prefab recursion limit reached');
    return;
  }
  reporter.low('NESTED_PREFAB_DEPENDENCY', ownerFile, asset.relativePath, 'Nested prefab dependency discovered', asset.path);
}

// A Unity PrefabInstance is one object, but it can expose several stripped
// Transforms: its root, plus any inner transform that owns added children or is
// referenced by a script field. Each stripped Transform would otherwise
// materialize its own copy of the linked prefab/model, so the instance ends up
// duplicated. Keep the root and fold the rest into it.
function collapseStrippedTransformsToInstanceRoot(context) {
  const {
    file,
    byId,
    transforms,
    prefabInstanceInfos,
    referencedTransformIds,
    childReferencedTransformIds,
    reporter,
  } = context;

  const strippedByInstance = new Map();
  for (const transform of transforms.values()) {
    if (transform.gameObjectId) continue;
    const doc = byId.get(transform.fileId);
    if (!doc?.stripped) continue;
    const instanceId = unityRefFileId(getField(doc, 'm_PrefabInstance'));
    if (!instanceId) continue;
    if (!strippedByInstance.has(instanceId)) strippedByInstance.set(instanceId, []);
    strippedByInstance.get(instanceId).push(transform);
  }

  for (const [instanceId, group] of strippedByInstance.entries()) {
    if (group.length < 2) continue;
    const instanceInfo = prefabInstanceInfos.get(instanceId);
    const rootTransform = group.find((entry) => childReferencedTransformIds.has(entry.fileId))
      || group.find((entry) => entry.parentId && entry.parentId === instanceInfo?.parentTransformId)
      || group[0];

    for (const transform of group) {
      if (transform === rootTransform) continue;
      if (!referencedTransformIds.has(transform.fileId)) continue;

      for (const other of transforms.values()) {
        if (other.parentId === transform.fileId) other.parentId = rootTransform.fileId;
      }
      for (const childId of transform.children || []) {
        if (!rootTransform.children.includes(childId)) rootTransform.children.push(childId);
      }
      transforms.delete(transform.fileId);
      referencedTransformIds.delete(transform.fileId);
      reporter.low(
        'NESTED_PREFAB_INNER_TRANSFORM_COLLAPSED',
        file,
        transform.fileId,
        'Inner stripped Transform of a nested Unity PrefabInstance was folded into the instance root so the nested prefab is only instantiated once',
        `instance ${instanceId} -> ${rootTransform.fileId}`,
      );
    }
  }
}

function materializeStrippedTransforms(context) {
  const {
    file,
    byId,
    gameObjects,
    transforms,
    componentDocs,
    prefabInstanceInfos,
    unityDb,
    reporter,
    options,
    recursionDepth,
  } = context;

  const referencedTransformIds = new Set();
  const childReferencedTransformIds = new Set();
  for (const transform of transforms.values()) {
    for (const childId of transform.children || []) {
      referencedTransformIds.add(childId);
      childReferencedTransformIds.add(childId);
    }
    if (transform.parentId) referencedTransformIds.add(transform.parentId);
  }

  // Unity prefab variants do not add model/prefab instance transforms to the
  // source hierarchy's m_Children list. The only ownership edge is stored in
  // the outer PrefabInstance.m_AddedGameObjects list. Treat those stripped
  // transforms as referenced children so variant-only visuals are
  // materialized instead of being silently discarded.
  for (const instanceInfo of prefabInstanceInfos.values()) {
    for (const transformId of instanceInfo.addedGameObjectTransformIds || []) {
      referencedTransformIds.add(transformId);
      childReferencedTransformIds.add(transformId);
    }
  }

  collapseStrippedTransformsToInstanceRoot({
    file,
    byId,
    transforms,
    prefabInstanceInfos,
    referencedTransformIds,
    childReferencedTransformIds,
    reporter,
  });

  for (const transform of [...transforms.values()]) {
    if (transform.gameObjectId) continue;
    const doc = byId.get(transform.fileId);
    if (!doc?.stripped) continue;
    const instanceId = unityRefFileId(getField(doc, 'm_PrefabInstance'));
    const instanceInfo = prefabInstanceInfos.get(instanceId);
    if (!referencedTransformIds.has(transform.fileId) && instanceInfo?.parentTransformId) {
      continue;
    }
    const correspondingSourceObject = getField(doc, 'm_CorrespondingSourceObject');
    const props = instanceInfo ? prefabOverrideProps(instanceInfo, correspondingSourceObject) : {};
    const sourceGuid = unityRefGuid(instanceInfo?.sourcePrefab);
    const sourceAsset = unityDb.get(sourceGuid);
    const rootGameObjectId = sourceGameObjectIdForTransform(
      sourceAsset,
      unityRefFileId(correspondingSourceObject),
    );
    const rootGameObjectProps = prefabOverridePropsByFileId(instanceInfo, sourceGuid, rootGameObjectId);
    const gameObjectProps = Object.keys(rootGameObjectProps).length
      ? rootGameObjectProps
      : firstGameObjectOverrideProps(instanceInfo, sourceGuid);
    const syntheticGameObjectId = `${instanceId}:go`;
    const sourceName = sourceAsset ? path.basename(sourceAsset.path, path.extname(sourceAsset.path)) : 'NestedPrefab';
    const name = String(gameObjectProps.m_Name || props.m_Name || sourceName);

    const overridden = transformFromPrefabOverrides(transform, props);
    transform.localPosition = overridden.localPosition;
    transform.anchoredPosition = overridden.anchoredPosition;
    transform.localRotation = overridden.localRotation;
    transform.localScale = overridden.localScale;
    transform.euler = overridden.euler;
    transform.sizeDelta = overridden.sizeDelta;
    transform.anchorMin = overridden.anchorMin;
    transform.anchorMax = overridden.anchorMax;
    transform.anchor = overridden.anchor;
    transform.parentId = instanceInfo?.parentTransformId || transform.parentId;
    transform.gameObjectId = syntheticGameObjectId;

    gameObjects.set(syntheticGameObjectId, {
      fileId: syntheticGameObjectId,
      name,
      layer: Number(gameObjectProps.m_Layer ?? props.m_Layer ?? 0),
      active: (gameObjectProps.m_IsActive ?? props.m_IsActive) == null
        ? true
        : Number(gameObjectProps.m_IsActive ?? props.m_IsActive) !== 0,
      components: [],
      transformId: transform.fileId,
    });

    if (transform.parentId && transforms.has(transform.parentId)) {
      const parent = transforms.get(transform.parentId);
      if (!parent.children.includes(transform.fileId)) parent.children.push(transform.fileId);
    }

    if (sourceAsset?.ext === '.prefab' && options.recursive) {
      const nestedPrefab = queueNestedPrefabAsset(options, sourceAsset, unityDb, reporter, recursionDepth + 1);
      if (nestedPrefab?.rootLocalId && nestedPrefab?.prefabUuid) {
        const gameObject = gameObjects.get(syntheticGameObjectId);
        gameObject.nestedPrefab = {
          sourceAsset,
          model: nestedPrefab.model,
          rootName: nestedPrefab.rootName,
          outputFile: nestedPrefab.outputFile,
          prefabUuid: nestedPrefab.prefabUuid,
          rootLocalId: nestedPrefab.rootLocalId,
          overrideInfo: instanceInfo,
          sourceGuid,
        };
        reporter.low(
          'NESTED_PREFAB_LINKED',
          sourceAsset.relativePath,
          name,
          transform.parentId
            ? 'Nested prefab will be emitted as a Cocos prefab instance'
            : 'Top-level nested prefab source resolved for flattening into local Cocos nodes'
        );
      } else {
        const detail = sourceAsset ? sourceAsset.relativePath : `instance ${instanceId}`;
        reporter.medium('NESTED_PREFAB_PLACEHOLDER', file, name, 'Nested prefab could not resolve its generated root info; emitted as placeholder node', detail);
      }
    } else if (sourceAsset && ['.fbx', '.gltf', '.glb'].includes(sourceAsset.ext)) {
      const gameObject = gameObjects.get(syntheticGameObjectId);
      const materialOverrideGroups = collectPrefabMaterialOverrideGroups(instanceInfo, sourceGuid, unityDb);
      gameObject.syntheticModelAsset = sourceAsset;
      gameObject.syntheticModelName = name;
      gameObject.syntheticModelMaterialOverrideGroups = materialOverrideGroups;
      gameObject.syntheticModelExternalMaterialRemaps = collectUnityModelExternalMaterialRemaps(sourceAsset, unityDb);
      for (const [componentId, componentDoc] of componentDocs.entries()) {
        if (!componentDoc?.stripped || Number(componentDoc.classId) !== 95) continue;
        if (unityRefFileId(getField(componentDoc, 'm_PrefabInstance')) !== instanceId) continue;
        const animatorSourceObject = getField(componentDoc, 'm_CorrespondingSourceObject');
        const animatorProps = prefabOverrideProps(instanceInfo, animatorSourceObject);
        const controllerRef = animatorProps.m_Controller;
        const controllerGuid = unityRefGuid(controllerRef);
        if (!controllerGuid) continue;
        const controllerFileId = unityRefFileId(controllerRef) || '9100000';
        const controllerType = Number(controllerRef?.type || 2);
        componentDocs.set(componentId, {
          ...componentDoc,
          stripped: false,
          lines: [
            ...componentDoc.lines,
            `  m_Controller: {fileID: ${controllerFileId}, guid: ${controllerGuid}, type: ${controllerType}}`,
          ],
        });
        gameObject.components.push(componentId);
        reporter.low(
          'STRIPPED_MODEL_ANIMATOR_MATERIALIZED',
          sourceAsset.relativePath,
          name,
          'Animator override on the nested Unity model was materialized as a mounted Cocos AnimationController',
          controllerGuid,
        );
      }
    } else {
      const detail = sourceAsset ? sourceAsset.relativePath : `instance ${instanceId}`;
      reporter.medium('NESTED_PREFAB_PLACEHOLDER', file, name, 'Nested prefab emitted as placeholder node', detail);
    }
  }

  for (const [instanceId, instanceInfo] of prefabInstanceInfos.entries()) {
    const alreadyMaterialized = [...transforms.values()].some((transform) => {
      const transformDoc = byId.get(transform.fileId);
      return unityRefFileId(getField(transformDoc, 'm_PrefabInstance')) === instanceId;
    });
    if (alreadyMaterialized || instanceInfo.parentTransformId) continue;

    const sourceGuid = unityRefGuid(instanceInfo.sourcePrefab);
    const sourceAsset = unityDb.get(sourceGuid);
    if (!sourceAsset || !['.fbx', '.gltf', '.glb'].includes(sourceAsset.ext)) continue;

    const transformProps = firstTransformOverrideProps(instanceInfo, sourceGuid);
    const gameObjectProps = firstGameObjectOverrideProps(instanceInfo, sourceGuid);
    const transformId = `${instanceId}:root-transform`;
    const gameObjectId = `${instanceId}:root-game-object`;
    const transform = transformFromPrefabOverrides({
      fileId: transformId,
      gameObjectId,
      parentId: 0,
      children: [],
      isRect: false,
      localPosition: { x: 0, y: 0, z: 0 },
      localRotation: { x: 0, y: 0, z: 0, w: 1 },
      localScale: { x: 1, y: 1, z: 1 },
      euler: { x: 0, y: 0, z: 0 },
      sizeDelta: { x: 100, y: 100 },
      anchorMin: { x: 0.5, y: 0.5 },
      anchorMax: { x: 0.5, y: 0.5 },
      anchor: { x: 0.5, y: 0.5 },
    }, transformProps);
    Object.assign(transform, {
      fileId: transformId,
      gameObjectId,
      parentId: 0,
      children: [],
      isRect: false,
    });
    transforms.set(transformId, transform);
    gameObjects.set(gameObjectId, {
      fileId: gameObjectId,
      name: String(gameObjectProps.m_Name || sourceAsset.stem),
      layer: Number(gameObjectProps.m_Layer || 0),
      active: gameObjectProps.m_IsActive == null ? true : Number(gameObjectProps.m_IsActive) !== 0,
      components: [],
      transformId,
      syntheticModelAsset: sourceAsset,
      syntheticModelName: String(gameObjectProps.m_Name || sourceAsset.stem),
      syntheticModelMaterialOverrideGroups: collectPrefabMaterialOverrideGroups(instanceInfo, sourceGuid, unityDb),
      syntheticModelExternalMaterialRemaps: collectUnityModelExternalMaterialRemaps(sourceAsset, unityDb),
    });
    reporter.low(
      'ROOT_MODEL_PREFAB_INSTANCE_MATERIALIZED',
      sourceAsset.relativePath,
      gameObjectProps.m_Name || sourceAsset.stem,
      'Materialized a Unity prefab containing only a root model PrefabInstance',
    );
  }

  // Unity stores `m_AddedComponents` of a nested PrefabInstance on stripped
  // GameObjects, which carry no `m_Component` list, so nothing would ever claim
  // them. Cocos can only mount extra components on the instance root, so
  // re-target them there instead of dropping them.
  for (const [componentId, componentDoc] of componentDocs.entries()) {
    const ownerId = unityRefFileId(getField(componentDoc, 'm_GameObject'));
    if (!ownerId) continue;
    const ownerDoc = byId.get(ownerId);
    if (!ownerDoc?.stripped || Number(ownerDoc.classId) !== 1) continue;
    const instanceId = unityRefFileId(getField(ownerDoc, 'm_PrefabInstance'));
    if (!instanceId) continue;
    const host = gameObjects.get(`${instanceId}:go`)
      || gameObjects.get(`${instanceId}:root-game-object`);
    if (!host || host.components.includes(componentId)) continue;
    host.components.push(componentId);
    reporter.low(
      'NESTED_PREFAB_ADDED_COMPONENT_MOUNTED',
      file,
      host.name,
      'Component added to a stripped GameObject of a nested Unity PrefabInstance was mounted on the Cocos prefab instance root',
      `component ${componentId}`,
    );
  }
}

function collectUnityModelExternalMaterialRemaps(modelAsset, unityDb) {
  const metaFile = modelAsset?.path ? `${modelAsset.path}.meta` : '';
  if (!metaFile || !fs.existsSync(metaFile)) return [];

  const lines = fs.readFileSync(metaFile, 'utf8').split(/\r?\n/);
  const remaps = [];
  let inExternalObjects = false;
  let materialEntry = false;
  let name = '';

  for (const line of lines) {
    if (/^  externalObjects:\s*$/.test(line)) {
      inExternalObjects = true;
      continue;
    }
    if (!inExternalObjects) continue;
    if (/^  [A-Za-z_][^:]*:\s*/.test(line) && !/^  -\s/.test(line)) break;

    const typeMatch = /^\s+type:\s*(.+?)\s*$/.exec(line);
    if (typeMatch) {
      materialEntry = /(?:^|:)Material$/i.test(String(parseUnityScalar(typeMatch[1])));
      continue;
    }
    const nameMatch = /^\s+name:\s*(.+?)\s*$/.exec(line);
    if (nameMatch && materialEntry) {
      name = String(parseUnityScalar(nameMatch[1]) || '');
      continue;
    }
    const targetMatch = /^\s+second:\s*(\{.*\})\s*$/.exec(line);
    if (!targetMatch || !materialEntry || !name) continue;
    const target = parseUnityScalar(targetMatch[1]);
    const materialAsset = unityDb.get(unityRefGuid(target));
    if (materialAsset) remaps.push({ name, materialAsset });
    materialEntry = false;
    name = '';
  }

  return remaps;
}

function describeNestedPrefabAsset(options, sourceAsset, unityDb, reporter, recursionDepth = 0) {
  if (recursionDepth > 8) {
    reporter.medium('NESTED_PREFAB_RECURSION_LIMIT', sourceAsset.relativePath, '', 'Nested prefab recursion limit reached');
    return null;
  }

  const model = buildUnityPrefabModel(sourceAsset.path, unityDb, reporter, options, recursionDepth);
  const root = model.roots[0];
  if (!root) {
    reporter.medium('NESTED_PREFAB_NO_ROOT', sourceAsset.relativePath, '', 'Nested prefab source has no root transform; prefab link skipped');
    return null;
  }

  const rootGameObject = model.gameObjects.get(root.gameObjectId);
  if (!rootGameObject) {
    reporter.medium('NESTED_PREFAB_NO_ROOT_GAMEOBJECT', sourceAsset.relativePath, '', 'Nested prefab root has no GameObject; prefab link skipped');
    return null;
  }

  const rootName = rootGameObject.name || path.basename(sourceAsset.path, path.extname(sourceAsset.path));
  return {
    model,
    rootName,
    rootLocalId: `node-${sanitizeFileId(rootName)}-${root.fileId}`,
  };
}

function parsePrefabInstanceInfo(doc) {
  const info = {
    fileId: doc.fileId,
    parentTransformId: unityRefFileId(getField(doc, 'm_TransformParent')),
    sourcePrefab: getField(doc, 'm_SourcePrefab'),
    overridesByTarget: new Map(),
    removedGameObjectSourceIds: parsePrefabInstanceReferenceList(doc, 'm_RemovedGameObjects'),
    removedComponentSourceIds: parsePrefabInstanceReferenceList(doc, 'm_RemovedComponents'),
    addedGameObjectTransformIds: parsePrefabInstanceAddedGameObjectIds(doc),
  };

  let current = null;
  for (const line of doc.lines) {
    const targetMatch = /^\s*-\s+target:\s*(\{.*\})\s*$/.exec(line);
    if (targetMatch) {
      const target = parseUnityScalar(targetMatch[1]);
      current = {
        targetFileId: unityRefFileId(target),
        targetGuid: unityRefGuid(target),
        propertyPath: '',
        value: '',
        objectReference: null,
      };
      continue;
    }
    if (!current) continue;
    const propertyMatch = /^\s*propertyPath:\s*(.*)$/.exec(line);
    if (propertyMatch) {
      current.propertyPath = String(parseUnityScalar(propertyMatch[1]));
      continue;
    }
    const valueMatch = /^\s*value:\s*(.*)$/.exec(line);
    if (valueMatch) {
      current.value = parseUnityScalar(valueMatch[1]);
      continue;
    }
    const objectRefMatch = /^\s*objectReference:\s*(\{.*\})\s*$/.exec(line);
    if (objectRefMatch) {
      current.objectReference = parseUnityScalar(objectRefMatch[1]);
      const key = `${current.targetGuid}:${current.targetFileId}`;
      if (!info.overridesByTarget.has(key)) info.overridesByTarget.set(key, {});
      info.overridesByTarget.get(key)[current.propertyPath] = current.objectReference?.fileID ? current.objectReference : current.value;
      current = null;
    }
  }

  return info;
}

function parsePrefabInstanceAddedGameObjectIds(doc) {
  const result = [];
  const lines = doc?.lines || [];
  const start = lines.findIndex((line) => /^\s*m_AddedGameObjects:\s*$/.test(line));
  if (start < 0) return result;
  const fieldIndent = String(lines[start]).match(/^\s*/)?.[0]?.length || 0;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0]?.length || 0;
    if (indent <= fieldIndent && !line.trimStart().startsWith('- ')) break;
    const match = /^\s*addedObject:\s*(\{.*\})\s*$/.exec(line);
    if (!match) continue;
    const fileId = unityRefFileId(parseUnityScalar(match[1]));
    if (fileId) result.push(fileId);
  }
  return result;
}

function parsePrefabInstanceReferenceList(doc, fieldName) {
  const result = [];
  const lines = doc?.lines || [];
  const start = lines.findIndex((line) => new RegExp(`^\\s*${fieldName}:\\s*$`).test(line));
  if (start < 0) return result;
  const fieldIndent = String(lines[start]).match(/^\s*/)?.[0]?.length || 0;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0]?.length || 0;
    if (indent <= fieldIndent && !line.trimStart().startsWith('- ')) break;
    const match = /^\s*-\s*(\{.*\})\s*$/.exec(line);
    if (!match) continue;
    const fileId = unityRefFileId(parseUnityScalar(match[1]));
    if (fileId) result.push(fileId);
  }
  return result;
}

function prefabOverrideProps(info, correspondingSourceObject) {
  const guid = unityRefGuid(correspondingSourceObject);
  const fileId = unityRefFileId(correspondingSourceObject);
  return info.overridesByTarget.get(`${guid}:${fileId}`) || {};
}

function prefabOverridePropsByFileId(info, sourceGuid, fileId) {
  if (!info || !sourceGuid || !fileId) return {};
  return info.overridesByTarget.get(`${sourceGuid}:${fileId}`) || {};
}

const sourceGameObjectIdCache = new Map();

/**
 * A stripped Transform records the SOURCE prefab Transform it came from. Its overrides
 * live under the source *GameObject* id, so that id has to be looked up in the source
 * prefab; guessing it picks up a child's m_IsActive / m_Name instead of the root's.
 */
function sourceGameObjectIdForTransform(sourceAsset, sourceTransformFileId) {
  if (!sourceAsset?.path || !sourceTransformFileId) return '';
  const cacheKey = `${sourceAsset.path}:${sourceTransformFileId}`;
  if (sourceGameObjectIdCache.has(cacheKey)) return sourceGameObjectIdCache.get(cacheKey);

  let gameObjectId = '';
  try {
    for (const doc of parseUnityYaml(sourceAsset.path)) {
      if (String(doc.fileId) !== String(sourceTransformFileId)) continue;
      gameObjectId = unityRefFileId(getField(doc, 'm_GameObject')) || '';
      break;
    }
  } catch {
    gameObjectId = '';
  }
  sourceGameObjectIdCache.set(cacheKey, gameObjectId);
  return gameObjectId;
}

function firstGameObjectOverrideProps(info, sourceGuid) {
  if (!info || !sourceGuid) return {};
  for (const [key, props] of info.overridesByTarget.entries()) {
    if (!key.startsWith(`${sourceGuid}:`)) continue;
    if (
      Object.prototype.hasOwnProperty.call(props, 'm_Name') ||
      Object.prototype.hasOwnProperty.call(props, 'm_Layer') ||
      Object.prototype.hasOwnProperty.call(props, 'm_IsActive')
    ) {
      return props;
    }
  }
  return {};
}

function firstTransformOverrideProps(info, sourceGuid) {
  if (!info || !sourceGuid) return {};
  for (const [key, props] of info.overridesByTarget.entries()) {
    if (!key.startsWith(`${sourceGuid}:`)) continue;
    if (Object.keys(props).some((propertyPath) => (
      propertyPath.startsWith('m_LocalPosition.')
      || propertyPath.startsWith('m_LocalRotation.')
      || propertyPath.startsWith('m_LocalScale.')
      || propertyPath.startsWith('m_LocalEulerAnglesHint.')
    ))) {
      return props;
    }
  }
  return {};
}

function collectPrefabMaterialOverrideGroups(info, sourceGuid, unityDb) {
  if (!info || !sourceGuid || !unityDb) return [];

  const groups = [];
  for (const [key, props] of info.overridesByTarget.entries()) {
    if (!key.startsWith(`${sourceGuid}:`)) continue;

    const materialAssets = [];
    let hasMaterialOverride = false;
    for (const [propertyPath, value] of Object.entries(props || {})) {
      const match = /^m_Materials\.Array\.data\[(\d+)\]$/.exec(propertyPath);
      if (!match) continue;
      hasMaterialOverride = true;
      materialAssets[Number(match[1])] = unityDb.get(unityRefGuid(value)) || null;
    }

    if (!hasMaterialOverride) continue;
    groups.push({
      sourceFileId: key.slice(sourceGuid.length + 1),
      materialAssets,
    });
  }

  return groups;
}

function applyGameObjectOverrideFields(gameObject, props) {
  if (!gameObject || !props) return;
  if (props.m_Name != null) gameObject.name = String(props.m_Name);
  if (props.m_Layer != null) gameObject.layer = Number(props.m_Layer);
  if (props.m_IsActive != null) gameObject.active = Number(props.m_IsActive) !== 0;
}

function transformFromPrefabOverrides(baseTransform, props) {
  const localPosition = {
    x: Number(props['m_LocalPosition.x'] ?? baseTransform.localPosition?.x ?? 0),
    y: Number(props['m_LocalPosition.y'] ?? baseTransform.localPosition?.y ?? 0),
    z: Number(props['m_LocalPosition.z'] ?? baseTransform.localPosition?.z ?? 0),
  };
  const anchoredPosition = {
    x: Number(props['m_AnchoredPosition.x'] ?? baseTransform.anchoredPosition?.x ?? localPosition.x ?? 0),
    y: Number(props['m_AnchoredPosition.y'] ?? baseTransform.anchoredPosition?.y ?? localPosition.y ?? 0),
  };
  const localRotation = {
    x: Number(props['m_LocalRotation.x'] ?? baseTransform.localRotation?.x ?? 0),
    y: Number(props['m_LocalRotation.y'] ?? baseTransform.localRotation?.y ?? 0),
    z: Number(props['m_LocalRotation.z'] ?? baseTransform.localRotation?.z ?? 0),
    w: Number(props['m_LocalRotation.w'] ?? baseTransform.localRotation?.w ?? 1),
  };
  const localScale = {
    x: Number(props['m_LocalScale.x'] ?? baseTransform.localScale?.x ?? 1),
    y: Number(props['m_LocalScale.y'] ?? baseTransform.localScale?.y ?? 1),
    z: Number(props['m_LocalScale.z'] ?? baseTransform.localScale?.z ?? 1),
  };
  const euler = {
    x: Number(props['m_LocalEulerAnglesHint.x'] ?? baseTransform.euler?.x ?? 0),
    y: Number(props['m_LocalEulerAnglesHint.y'] ?? baseTransform.euler?.y ?? 0),
    z: Number(props['m_LocalEulerAnglesHint.z'] ?? baseTransform.euler?.z ?? 0),
  };
  const sizeDelta = {
    x: Number(props['m_SizeDelta.x'] ?? baseTransform.sizeDelta?.x ?? 100),
    y: Number(props['m_SizeDelta.y'] ?? baseTransform.sizeDelta?.y ?? 100),
  };
  const anchorMin = {
    x: Number(props['m_AnchorMin.x'] ?? baseTransform.anchorMin?.x ?? 0.5),
    y: Number(props['m_AnchorMin.y'] ?? baseTransform.anchorMin?.y ?? 0.5),
  };
  const anchorMax = {
    x: Number(props['m_AnchorMax.x'] ?? baseTransform.anchorMax?.x ?? anchorMin.x),
    y: Number(props['m_AnchorMax.y'] ?? baseTransform.anchorMax?.y ?? anchorMin.y),
  };
  const anchor = {
    x: Number(props['m_Pivot.x'] ?? baseTransform.anchor?.x ?? 0.5),
    y: Number(props['m_Pivot.y'] ?? baseTransform.anchor?.y ?? 0.5),
  };
  return { localPosition, anchoredPosition, localRotation, localScale, euler, sizeDelta, anchorMin, anchorMax, anchor };
}

function unityCanvasRenderMode(gameObject, model) {
  for (const componentId of gameObject?.components || []) {
    const doc = model?.componentDocs?.get(componentId);
    if (Number(doc?.classId || 0) !== 223) continue;
    return Number(getField(doc, 'm_RenderMode', 0) || 0);
  }
  return null;
}

function resolveTransformLayout(transform, parentTransform, options = {}) {
  const localPosition = {
    x: finiteNumber(transform?.localPosition?.x, 0),
    y: finiteNumber(transform?.localPosition?.y, 0),
    z: finiteNumber(transform?.localPosition?.z, 0),
  };
  const localRotation = transform?.localRotation || { x: 0, y: 0, z: 0, w: 1 };
  const localScale = transform?.localScale || { x: 1, y: 1, z: 1 };
  const euler = transform?.euler || { x: 0, y: 0, z: 0 };
  const sizeDelta = {
    x: finiteNumber(transform?.sizeDelta?.x, 100),
    y: finiteNumber(transform?.sizeDelta?.y, 100),
  };
  const anchor = {
    x: finiteNumber(transform?.anchor?.x, 0.5),
    y: finiteNumber(transform?.anchor?.y, 0.5),
  };

  if (!transform?.isRect) return { localPosition, localRotation, localScale, euler, sizeDelta, anchor };

  const anchoredPosition = {
    x: finiteNumber(transform?.anchoredPosition?.x, localPosition.x),
    y: finiteNumber(transform?.anchoredPosition?.y, localPosition.y),
  };
  // Unity serializes a world-space Canvas as a RectTransform directly below a
  // normal 3D Transform. Its anchored position describes the inner UI rect;
  // the 3D placement remains in m_LocalPosition/m_LocalRotation/m_LocalScale.
  // Treating the 3D parent as a 100x100 UI rect moved TapeJam's lock canvas by
  // roughly (-50, -50) world units. The explicit option also covers a detached
  // world-space Canvas root in a standalone prefab.
  if (options.preserveLocalPosition || (parentTransform && !parentTransform.isRect)) {
    return {
      localPosition,
      localRotation,
      localScale,
      euler,
      sizeDelta,
      anchor,
    };
  }
  const parentLayout = parentTransform?.resolvedLayout;
  if (!parentLayout?.size) {
    return {
      localPosition: { x: anchoredPosition.x, y: anchoredPosition.y, z: localPosition.z },
      localRotation,
      localScale,
      euler,
      sizeDelta,
      anchor,
    };
  }

  const parentSize = {
    x: finiteNumber(parentLayout.size?.x, 0),
    y: finiteNumber(parentLayout.size?.y, 0),
  };
  const parentAnchor = {
    x: finiteNumber(parentLayout.anchor?.x, 0.5),
    y: finiteNumber(parentLayout.anchor?.y, 0.5),
  };
  const anchorMin = {
    x: finiteNumber(transform?.anchorMin?.x, 0.5),
    y: finiteNumber(transform?.anchorMin?.y, 0.5),
  };
  const anchorMax = {
    x: finiteNumber(transform?.anchorMax?.x, anchorMin.x),
    y: finiteNumber(transform?.anchorMax?.y, anchorMin.y),
  };
  const stretch = {
    x: anchorMax.x - anchorMin.x,
    y: anchorMax.y - anchorMin.y,
  };
  const resolvedSize = {
    x: sizeDelta.x + (parentSize.x * stretch.x),
    y: sizeDelta.y + (parentSize.y * stretch.y),
  };
  const anchorReference = {
    x: ((anchorMin.x + (stretch.x * anchor.x)) - parentAnchor.x) * parentSize.x,
    y: ((anchorMin.y + (stretch.y * anchor.y)) - parentAnchor.y) * parentSize.y,
  };

  return {
    localPosition: {
      x: anchorReference.x + anchoredPosition.x,
      y: anchorReference.y + anchoredPosition.y,
      z: localPosition.z,
    },
    localRotation,
    localScale,
    euler,
    sizeDelta: resolvedSize,
    anchor,
  };
}

function inferRectSizeFromHierarchy(transform, model, cache = new Map(), visiting = new Set()) {
  if (!transform?.isRect || !Array.isArray(transform.children) || !transform.children.length) return null;
  if (cache.has(transform.fileId)) return cache.get(transform.fileId);
  if (visiting.has(transform.fileId)) return null;

  visiting.add(transform.fileId);
  let inferredWidth = 0;
  let inferredHeight = 0;
  let hasWidthCandidate = false;
  let hasHeightCandidate = false;

  for (const childId of transform.children) {
    const child = model.transforms.get(childId);
    if (!child?.isRect) continue;

    const anchorMinX = finiteNumber(child.anchorMin?.x, 0.5);
    const anchorMaxX = finiteNumber(child.anchorMax?.x, anchorMinX);
    const anchorMinY = finiteNumber(child.anchorMin?.y, 0.5);
    const anchorMaxY = finiteNumber(child.anchorMax?.y, anchorMinY);
    const sizeDeltaX = finiteNumber(child.sizeDelta?.x, 0);
    const sizeDeltaY = finiteNumber(child.sizeDelta?.y, 0);
    const childIntrinsic = inferRectSizeFromHierarchy(child, model, cache, visiting);
    const width = Math.max(0, sizeDeltaX, finiteNumber(childIntrinsic?.x, 0));
    const height = Math.max(0, sizeDeltaY, finiteNumber(childIntrinsic?.y, 0));
    const stretchX = anchorMaxX - anchorMinX;
    const stretchY = anchorMaxY - anchorMinY;

    if (Math.abs(stretchX) < 1e-6 && width > 0) {
      inferredWidth = Math.max(inferredWidth, width);
      hasWidthCandidate = true;
    } else if (finiteNumber(childIntrinsic?.x, 0) > 0 && Math.abs(stretchX) > 1e-6) {
      const parentWidth = (childIntrinsic.x - sizeDeltaX) / stretchX;
      if (Number.isFinite(parentWidth) && parentWidth > 0) {
        inferredWidth = Math.max(inferredWidth, parentWidth);
        hasWidthCandidate = true;
      }
    }
    if (Math.abs(stretchY) < 1e-6 && height > 0) {
      inferredHeight = Math.max(inferredHeight, height);
      hasHeightCandidate = true;
    } else if (finiteNumber(childIntrinsic?.y, 0) > 0 && Math.abs(stretchY) > 1e-6) {
      const parentHeight = (childIntrinsic.y - sizeDeltaY) / stretchY;
      if (Number.isFinite(parentHeight) && parentHeight > 0) {
        inferredHeight = Math.max(inferredHeight, parentHeight);
        hasHeightCandidate = true;
      }
    }
  }

  visiting.delete(transform.fileId);
  const inferred = (!hasWidthCandidate && !hasHeightCandidate) ? null : {
    x: hasWidthCandidate ? inferredWidth : 0,
    y: hasHeightCandidate ? inferredHeight : 0,
  };
  cache.set(transform.fileId, inferred);
  return inferred;
}

function hasPrefabOverrideKey(props, key) {
  return Object.prototype.hasOwnProperty.call(props || {}, key);
}

function decodeUnityColor32(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  const rgba = number >>> 0;
  return {
    r: ((rgba >>> 24) & 0xff) / 255,
    g: ((rgba >>> 16) & 0xff) / 255,
    b: ((rgba >>> 8) & 0xff) / 255,
    a: (rgba & 0xff) / 255,
  };
}

function mergeUnityColorOverride(baseColor, props, prefix, packedKey = '') {
  const colorValue = {
    r: finiteNumber(baseColor?.r, 1),
    g: finiteNumber(baseColor?.g, 1),
    b: finiteNumber(baseColor?.b, 1),
    a: finiteNumber(baseColor?.a, 1),
  };
  const hasChannelOverride = ['r', 'g', 'b', 'a'].some((channel) => hasPrefabOverrideKey(props, `${prefix}.${channel}`));

  if (!hasChannelOverride && packedKey && hasPrefabOverrideKey(props, packedKey)) {
    const packed = decodeUnityColor32(props[packedKey]);
    if (packed) Object.assign(colorValue, packed);
  }

  for (const channel of ['r', 'g', 'b', 'a']) {
    const key = `${prefix}.${channel}`;
    if (hasPrefabOverrideKey(props, key)) colorValue[channel] = finiteNumber(props[key], colorValue[channel]);
  }

  return colorValue;
}

function resolveNestedLabelSizing(props, sourceDoc) {
  const hasExplicitFontSize = [
    'm_fontSize',
    'm_fontSizeBase',
    'm_fontSizeMin',
    'm_fontSizeMax',
  ].some((key) => hasPrefabOverrideKey(props, key));
  const hasAutoSizeOverride = hasPrefabOverrideKey(props, 'm_enableAutoSizing');
  if (!hasExplicitFontSize && !hasAutoSizeOverride) return null;

  const autoSizing = Number((props.m_enableAutoSizing ?? getField(sourceDoc, 'm_enableAutoSizing', 0)) || 0) !== 0;
  const requested = finiteNumber(props.m_fontSize, NaN);
  const base = finiteNumber(props.m_fontSizeBase, NaN);
  const sourceRequested = finiteNumber(getField(sourceDoc, 'm_fontSize', 22), 22);
  const sourceBase = finiteNumber(getField(sourceDoc, 'm_fontSizeBase', sourceRequested), sourceRequested);
  const max = finiteNumber(props.m_fontSizeMax, finiteNumber(getField(sourceDoc, 'm_fontSizeMax', NaN), NaN));

  let fontSize = Number.isFinite(requested)
    ? requested
    : Number.isFinite(base)
      ? base
      : sourceBase;
  if (autoSizing && Number.isFinite(max)) fontSize = max;

  fontSize = Math.max(1, Number.isFinite(fontSize) ? fontSize : sourceRequested);
  return {
    autoSizing,
    fontSize,
    overflow: autoSizing ? 2 : null,
  };
}

function buildNestedPrefabPropertyOverrides(gameObject, transform, sourceModel) {
  const nestedPrefab = gameObject?.nestedPrefab;
  const overrideInfo = nestedPrefab?.overrideInfo;
  const sourceGuid = nestedPrefab?.sourceGuid;
  if (!overrideInfo || !sourceGuid || !sourceModel) return [];

  const overrides = [];
  const rootTransform = sourceModel.roots?.[0];
  if (rootTransform?.isRect) {
    overrides.push(
      {
        localId: `cmp-ui-transform-${rootTransform.fileId}`,
        propertyPath: '_contentSize',
        value: size(
          finiteNumber(transform?.sizeDelta?.x, 100),
          finiteNumber(transform?.sizeDelta?.y, 100)
        ),
      },
      {
        localId: `cmp-ui-transform-${rootTransform.fileId}`,
        propertyPath: '_anchorPoint',
        value: vec2(
          finiteNumber(transform?.anchor?.x, 0.5),
          finiteNumber(transform?.anchor?.y, 0.5)
        ),
      },
    );
  }

  for (const [key, props] of overrideInfo.overridesByTarget.entries()) {
    if (!key.startsWith(`${sourceGuid}:`)) continue;
    const sourceFileId = key.slice(sourceGuid.length + 1);
    const sourceDoc = sourceModel.componentDocs.get(sourceFileId);
    if (!sourceDoc || Number(sourceDoc.classId) !== 114) continue;
    if (!hasField(sourceDoc, 'm_Text') && !hasField(sourceDoc, 'm_text')) continue;

    const localId = `cmp-label-${sourceFileId}`;
    if (hasPrefabOverrideKey(props, 'm_Text') || hasPrefabOverrideKey(props, 'm_text')) {
      overrides.push({
        localId,
        propertyPath: '_string',
        value: String(props.m_Text ?? props.m_text ?? ''),
      });
    }

    const labelSizing = resolveNestedLabelSizing(props, sourceDoc);
    if (labelSizing != null) {
      overrides.push(
        { localId, propertyPath: '_fontSize', value: labelSizing.fontSize },
        { localId, propertyPath: '_actualFontSize', value: labelSizing.fontSize },
        { localId, propertyPath: '_lineHeight', value: labelSizing.fontSize },
      );
      if (labelSizing.overflow != null) {
        overrides.push({ localId, propertyPath: '_overflow', value: labelSizing.overflow });
      }
    }

    const hasColorOverride = Object.keys(props || {}).some((propertyPath) => (
      propertyPath === 'm_fontColor32.rgba' || propertyPath.startsWith('m_fontColor.')
    ));
    if (hasColorOverride) {
      const baseColor = getField(sourceDoc, 'm_fontColor', getField(sourceDoc, 'm_Color', { r: 1, g: 1, b: 1, a: 1 }));
      overrides.push({
        localId,
        propertyPath: '_color',
        value: unityColorToCocos(mergeUnityColorOverride(baseColor, props, 'm_fontColor', 'm_fontColor32.rgba')),
      });
    }

    const isTmpLabel = hasField(sourceDoc, 'm_fontAsset') || hasField(sourceDoc, 'm_fontStyle');
    if (isTmpLabel && (
      hasPrefabOverrideKey(props, 'm_fontStyle') || hasPrefabOverrideKey(props, 'm_fontWeight')
    )) {
      const style = finiteNumber(props.m_fontStyle, finiteNumber(getField(sourceDoc, 'm_fontStyle', 0), 0));
      const weight = finiteNumber(props.m_fontWeight, finiteNumber(getField(sourceDoc, 'm_fontWeight', 400), 400));
      overrides.push(
        { localId, propertyPath: '_isBold', value: (style & 1) !== 0 || weight >= 700 },
        { localId, propertyPath: '_isItalic', value: (style & 2) !== 0 },
        { localId, propertyPath: '_isUnderline', value: (style & 4) !== 0 },
      );
    }

    const legacyStyleKey = Object.prototype.hasOwnProperty.call(props || {}, 'm_FontData.m_FontStyle')
      ? 'm_FontData.m_FontStyle'
      : (Object.prototype.hasOwnProperty.call(props || {}, 'm_FontStyle') ? 'm_FontStyle' : '');
    if (!isTmpLabel && legacyStyleKey) {
      const style = finiteNumber(props[legacyStyleKey], 0);
      overrides.push(
        { localId, propertyPath: '_isBold', value: style === 1 || style === 3 },
        { localId, propertyPath: '_isItalic', value: style === 2 || style === 3 },
      );
    }
  }

  return overrides;
}

function nestedPrefabNeedsParticleOverrideFlattening(nestedPrefab) {
  const { model, overrideInfo, sourceGuid } = nestedPrefab || {};
  if (!model || !overrideInfo || !sourceGuid) return false;
  if (overrideInfo.removedGameObjectSourceIds?.length || overrideInfo.removedComponentSourceIds?.length) {
    return true;
  }
  for (const key of overrideInfo.overridesByTarget.keys()) {
    if (!key.startsWith(`${sourceGuid}:`)) continue;
    const sourceFileId = key.slice(sourceGuid.length + 1);
    const classId = Number(model.componentDocs.get(sourceFileId)?.classId || 0);
    if (classId === 198 || classId === 199) return true;
    const props = overrideInfo.overridesByTarget.get(key) || {};
    if (Object.keys(props).some((propertyPath) => /^m_Materials\.Array\.data\[\d+\]$/.test(propertyPath))) {
      return true;
    }
  }
  return false;
}

/**
 * Unity has no native Rate over Distance in Cocos, so the porter attaches
 * UnityParticleRateOverDistanceEmitter while building the *source* prefab. When an
 * instance overrides the rate, that helper is already in place with the source value,
 * so it has to be re-synced here from the effective data.
 */
function syncNestedRateOverDistanceHelper(builder, particleId, particleData, reporter, nestedPrefab) {
  const rateRange = particleData?.EmissionModule?.rateOverDistance;
  if (!rateRange || Number(rateRange.minMaxState || 0) !== 0) return;
  const effectiveRate = Number(rateRange.scalar || 0);
  if (!(effectiveRate > 0)) return;

  const particle = builder.objects[particleId];
  const nodeId = Number(particle?.node?.__id__);
  const node = Number.isInteger(nodeId) ? builder.objects[nodeId] : null;
  if (!node) return;

  for (const componentRef of node._components || []) {
    const component = builder.objects[Number(componentRef?.__id__)];
    if (!component || Number(component.particleSystem?.__id__) !== particleId) continue;
    if (typeof component.rateOverDistance !== 'number') continue;
    if (component.rateOverDistance === effectiveRate) return;
    reporter.low(
      'PARTICLE_RATE_OVER_DISTANCE_OVERRIDE_SYNCED',
      nestedPrefab?.sourceAsset?.relativePath || '',
      node._name || '',
      `Rate over Distance ${component.rateOverDistance} -> ${effectiveRate} from the prefab instance override`,
    );
    component.rateOverDistance = effectiveRate;
    return;
  }
}

function applyNestedParticlePrefabOverrides(builder, nestedPrefab, reporter, options, unityDb, cocosDb) {
  const { model, overrideInfo, sourceGuid } = nestedPrefab;
  let applied = 0;

  for (const transform of model.transforms.values()) {
    const props = prefabOverridePropsByFileId(overrideInfo, sourceGuid, transform.fileId);
    if (!Object.keys(props).length) continue;
    const nodeId = builder.nodeMapByTransform.get(transform.fileId);
    const node = builder.objects[nodeId];
    if (!node) continue;
    const resolved = transformFromPrefabOverrides(transform, props);
    node._lpos = convertPosition(resolved.localPosition);
    node._lrot = convertRotation(resolved.localRotation);
    node._lscale = convertScale(resolved.localScale);
    node._euler = convertTransformEuler(resolved);
    applied += 1;
  }

  for (const gameObject of model.gameObjects.values()) {
    const props = prefabOverridePropsByFileId(overrideInfo, sourceGuid, gameObject.fileId);
    if (!Object.keys(props).length) continue;
    const nodeId = builder.nodeMapByGameObject.get(gameObject.fileId);
    const node = builder.objects[nodeId];
    if (!node) continue;
    if (props.m_Name != null) node._name = String(props.m_Name);
    if (props.m_IsActive != null) node._active = Number(props.m_IsActive) !== 0;
    applied += 1;
  }

  for (const sourceGameObjectId of overrideInfo.removedGameObjectSourceIds || []) {
    const nodeId = builder.nodeMapByGameObject.get(sourceGameObjectId);
    const node = builder.objects[nodeId];
    if (!node) continue;
    node._active = false;
    applied += 1;
  }

  for (const gameObject of model.gameObjects.values()) {
    const particleDoc = (gameObject.components || [])
      .map((componentId) => model.componentDocs.get(componentId))
      .find((doc) => Number(doc?.classId) === 198);
    if (!particleDoc) continue;
    const rendererDoc = (gameObject.components || [])
      .map((componentId) => model.componentDocs.get(componentId))
      .find((doc) => Number(doc?.classId) === 199) || null;
    const particleProps = prefabOverridePropsByFileId(
      overrideInfo,
      sourceGuid,
      particleDoc.fileId,
    );
    const rendererProps = rendererDoc
      ? prefabOverridePropsByFileId(overrideInfo, sourceGuid, rendererDoc.fileId)
      : {};
    if (!Object.keys(particleProps).length && !Object.keys(rendererProps).length) continue;

    const particleId = builder.componentMap.get(particleDoc.fileId);
    if (!Number.isInteger(particleId)) continue;
    const particleData = parseUnityParticleDoc(particleDoc);
    const rendererData = parseUnityRendererDoc(rendererDoc);
    applyUnitySerializedOverrides(particleData, particleProps);
    applyUnitySerializedOverrides(rendererData, rendererProps);
    applyUnityParticleDataToCocos(builder, particleId, particleData, rendererData);
    if (particleProps.m_Enabled != null) {
      builder.objects[particleId]._enabled = Number(particleProps.m_Enabled) !== 0;
    }
    syncNestedRateOverDistanceHelper(builder, particleId, particleData, reporter, nestedPrefab);

    const materialOverride = Object.entries(rendererProps)
      .find(([propertyPath]) => /^m_Materials\.Array\.data\[0\]$/.test(propertyPath));
    if (materialOverride) {
      const materialAsset = unityDb.get(unityRefGuid(materialOverride[1]));
      const material = materialAsset
        ? resolveUnityParticleMaterial(materialAsset, options, unityDb, reporter, gameObject.name)
        : null;
      if (material?.materialUuid) {
        applyParticleRendererMaterial(
          builder,
          particleId,
          material.materialUuid,
          material.textureUuid,
        );
      }
    }
    applied += Object.keys(particleProps).length + Object.keys(rendererProps).length;
  }

  const genericMaterialAssets = collectPrefabMaterialOverrideGroups(
    overrideInfo,
    sourceGuid,
    unityDb,
  )
    .filter((group) => Number(model.componentDocs.get(group.sourceFileId)?.classId || 0) !== 199)
    .flatMap((group) => group.materialAssets || [])
    .filter(Boolean);
  if (genericMaterialAssets.length) {
    const materialOverrides = builder.objects.filter((object) => (
      object?.__type__ === 'CCPropertyOverrideInfo'
      && object.propertyPath?.[0] === '_materials'
    ));
    const meshRenderers = builder.objects.filter((object) => (
      object?.__type__ === 'cc.MeshRenderer'
      || object?.__type__ === 'cc.SkinnedMeshRenderer'
    ));
    genericMaterialAssets.forEach((materialAsset, slot) => {
      const materialUuid = resolveUnityMaterialUuid(
        materialAsset,
        options,
        unityDb,
        cocosDb,
        reporter,
        nestedPrefab.rootName || '',
      );
      if (!materialUuid) return;
      const materialRef = cocosUuid(materialUuid, 'cc.Material');
      if (materialOverrides[slot]) materialOverrides[slot].value = materialRef;
      else if (meshRenderers[0]) meshRenderers[0]._materials[slot] = materialRef;
      applied += 1;
    });
  }

  if (applied) {
    reporter.low(
      'NESTED_PARTICLE_OVERRIDES_APPLIED',
      nestedPrefab.sourceAsset?.relativePath || '',
      nestedPrefab.rootName || '',
      `Applied ${applied} Unity nested-prefab particle, renderer, transform, and active-state overrides before flattening`,
    );
  }
  return applied;
}

function resolveUnityMaterialUuids(materialAssets, options, unityDb, cocosDb, reporter, gameObjectName) {
  return (materialAssets || [])
    .map((materialAsset) => {
      if (!materialAsset) return '';
      return resolveUnityMaterialUuid(materialAsset, options, unityDb, cocosDb, reporter, gameObjectName);
    })
    .filter(Boolean);
}

function replaceUnityFileIdsInLines(lines, idMap) {
  return lines.map((line) => line.replace(/fileID:\s*(-?\d+)/g, (match, id) => {
    const next = idMap.get(id);
    return next ? `fileID: ${next}` : match;
  }));
}

function collectCocosRefs(value, visit, key = '') {
  if (Array.isArray(value)) {
    for (const item of value) collectCocosRefs(item, visit, key);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, '__id__')) {
    visit(value.__id__, key);
    return;
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    collectCocosRefs(childValue, visit, childKey);
  }
}

function remapCocosIds(value, idMap, skipKeys, key = '') {
  if (Array.isArray(value)) return value.map((item) => remapCocosIds(item, idMap, skipKeys, key));
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, '__id__')) {
    if (skipKeys.has(key)) return value;
    return cocosRef(idMap.get(value.__id__) ?? value.__id__);
  }
  const out = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = remapCocosIds(childValue, idMap, skipKeys, childKey);
  }
  return out;
}

function resolveSpriteFrameOriginalSize(options, cocosDb, spriteUuid) {
  const uuid = String(spriteUuid || '');
  if (!uuid) return null;
  if (!options._spriteFrameOriginalSizeByUuid) options._spriteFrameOriginalSizeByUuid = new Map();
  if (options._spriteFrameOriginalSizeByUuid.has(uuid)) return options._spriteFrameOriginalSizeByUuid.get(uuid);

  const assetFile = options._spriteFrameAssetFileByUuid?.get(uuid);
  if (assetFile) {
    const meta = readJsonIfExists(`${assetFile}.meta`);
    for (const subMeta of Object.values(meta?.subMetas || {})) {
      if (subMeta?.uuid !== uuid || subMeta.importer !== 'sprite-frame') continue;
      const width = Number(subMeta.userData?.rawWidth ?? subMeta.userData?.width);
      const height = Number(subMeta.userData?.rawHeight ?? subMeta.userData?.height);
      if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
        const size = { width, height };
        options._spriteFrameOriginalSizeByUuid.set(uuid, size);
        return size;
      }
    }
  }

  const libraryJson = readJsonIfExists(libraryJsonPathForUuid(options, uuid));
  const originalSize = libraryJson?.content?.originalSize || libraryJson?.content?.rect;
  const libraryWidth = Number(originalSize?.width);
  const libraryHeight = Number(originalSize?.height);
  if (Number.isFinite(libraryWidth) && libraryWidth > 0 && Number.isFinite(libraryHeight) && libraryHeight > 0) {
    const size = { width: libraryWidth, height: libraryHeight };
    options._spriteFrameOriginalSizeByUuid.set(uuid, size);
    return size;
  }

  for (const record of cocosDb.records || []) {
    for (const subMeta of Object.values(record.subMetas || {})) {
      if (subMeta?.uuid !== uuid || subMeta.importer !== 'sprite-frame') continue;
      const width = Number(subMeta.userData?.rawWidth ?? subMeta.userData?.width);
      const height = Number(subMeta.userData?.rawHeight ?? subMeta.userData?.height);
      if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
        const size = { width, height };
        options._spriteFrameOriginalSizeByUuid.set(uuid, size);
        return size;
      }
    }
  }

  return null;
}

function fitPreserveAspectSize(rectSize, spriteSize) {
  const rectWidth = Number(rectSize?.width);
  const rectHeight = Number(rectSize?.height);
  const spriteWidth = Number(spriteSize?.width);
  const spriteHeight = Number(spriteSize?.height);
  if (
    !Number.isFinite(rectWidth) || rectWidth <= 0 ||
    !Number.isFinite(rectHeight) || rectHeight <= 0 ||
    !Number.isFinite(spriteWidth) || spriteWidth <= 0 ||
    !Number.isFinite(spriteHeight) || spriteHeight <= 0
  ) {
    return null;
  }
  const scale = Math.min(rectWidth / spriteWidth, rectHeight / spriteHeight);
  return {
    width: spriteWidth * scale,
    height: spriteHeight * scale,
  };
}

class CocosPrefabBuilder {
  constructor(name, cocosDb, reporter, options) {
    this.name = name;
    this.cocosDb = cocosDb;
    this.reporter = reporter;
    this.options = options;
    this.objects = [];
    this.nodeMapByGameObject = new Map();
    this.nodeMapByTransform = new Map();
    this.componentMap = new Map();
    this.uiTransformByNode = new Map();
    this.nodePrefabInfoMap = new Map();
    this.nestedPrefabInstanceByNode = new Map();
    this.mountedChildrenByInstanceTarget = new Map();
    this.mountedComponentsByInstanceTarget = new Map();
    this.prefabInfoIds = [];
    this.rootPrefabInfoId = 0;
    this.nestedPrefabInstanceRootIds = [];
    this.add({
      __type__: 'cc.Prefab',
      _name: name,
      _objFlags: 0,
      __editorExtras__: {},
      _native: '',
      data: cocosRef(1),
      optimizationPolicy: 0,
      persistent: false,
    });
  }

  add(obj) {
    this.objects.push(obj);
    return this.objects.length - 1;
  }

  compPrefabInfo(fileId) {
    return this.add({ __type__: 'cc.CompPrefabInfo', fileId });
  }

  prefabInfo(fileId, rootId = 1) {
    const id = this.add({
      __type__: 'cc.PrefabInfo',
      root: cocosRef(rootId),
      asset: cocosRef(0),
      fileId,
      instance: null,
      targetOverrides: null,
      nestedPrefabInstanceRoots: null,
    });
    this.prefabInfoIds.push(id);
    return id;
  }

  addNode(name, parentId, transform, layerValue, active, fileId) {
    const id = this.add({
      __type__: 'cc.Node',
      _name: name,
      _objFlags: 0,
      __editorExtras__: {},
      _parent: parentId == null ? null : cocosRef(parentId),
      _children: [],
      _active: active,
      _components: [],
      _prefab: null,
      _lpos: convertNodePosition(transform),
      _lrot: convertRotation(transform?.localRotation),
      _lscale: convertScale(transform?.localScale),
      _mobility: 0,
      _layer: layerValue,
      _euler: convertTransformEuler(transform),
      _id: '',
    });
    const prefabInfoId = this.prefabInfo(fileId, 1);
    this.objects[id]._prefab = cocosRef(prefabInfoId);
    this.nodePrefabInfoMap.set(id, prefabInfoId);
    if (parentId == null) this.rootPrefabInfoId = prefabInfoId;
    this.attachChild(parentId, id);
    return id;
  }

  addTargetInfo(localId) {
    return this.add({
      __type__: 'cc.TargetInfo',
      localID: [localId],
    });
  }

  addPropertyOverride(targetInfoId, propertyPath, value) {
    return this.add({
      __type__: 'CCPropertyOverrideInfo',
      targetInfo: cocosRef(targetInfoId),
      propertyPath: Array.isArray(propertyPath) ? propertyPath : [propertyPath],
      value,
    });
  }

  // Cocos identifies a nested instance by its own cc.PrefabInstance.fileId. The
  // instance root's PrefabInfo.fileId is the SOURCE prefab's root localID and is
  // deliberately shared by every instance of that prefab; emitting a unique id here
  // only gets normalised away the next time the editor saves the prefab.
  addNestedPrefabInstance(name, parentId, transform, layerValue, active, prefabUuid, rootLocalId, extraPropertyOverrides = []) {
    const nodeId = this.add({
      __type__: 'cc.Node',
      _objFlags: 0,
      _parent: parentId == null ? null : cocosRef(parentId),
      _prefab: null,
      __editorExtras__: {},
    });
    const targetInfoIds = new Map();
    const ensureTargetInfoId = (localId) => {
      if (!targetInfoIds.has(localId)) targetInfoIds.set(localId, this.addTargetInfo(localId));
      return targetInfoIds.get(localId);
    };
    const propertyOverrides = [];
    const pushOverride = (localId, propertyPath, value) => {
      if (value === undefined) return;
      propertyOverrides.push(this.addPropertyOverride(ensureTargetInfoId(localId), propertyPath, value));
    };

    pushOverride(rootLocalId, '_name', name);
    pushOverride(rootLocalId, '_lpos', convertNodePosition(transform));
    pushOverride(rootLocalId, '_lrot', convertRotation(transform?.localRotation));
    pushOverride(rootLocalId, '_lscale', convertScale(transform?.localScale));
    pushOverride(rootLocalId, '_euler', convertTransformEuler(transform));
    pushOverride(rootLocalId, '_layer', layerValue);
    pushOverride(rootLocalId, '_active', active);
    for (const entry of extraPropertyOverrides || []) {
      pushOverride(entry.localId, entry.propertyPath, entry.value);
    }

    const instanceId = this.add({
      __type__: 'cc.PrefabInstance',
      fileId: randomLocalId(),
      prefabRootNode: cocosRef(1),
      mountedChildren: [],
      mountedComponents: [],
      propertyOverrides: propertyOverrides.map(cocosRef),
      removedComponents: [],
    });
    const prefabInfoId = this.add({
      __type__: 'cc.PrefabInfo',
      root: cocosRef(nodeId),
      asset: cocosUuid(prefabUuid, 'cc.Prefab'),
      fileId: rootLocalId,
      instance: cocosRef(instanceId),
      targetOverrides: null,
      nestedPrefabInstanceRoots: null,
    });
    this.objects[nodeId]._prefab = cocosRef(prefabInfoId);
    this.nodePrefabInfoMap.set(nodeId, prefabInfoId);
    this.nestedPrefabInstanceByNode.set(nodeId, { instanceId, rootLocalId });
    this.nestedPrefabInstanceRootIds.push(nodeId);
    this.attachChild(parentId, nodeId);
    return nodeId;
  }

  mountedChildrenInfo(targetLocalId) {
    return this.add({
      __type__: 'cc.MountedChildrenInfo',
      targetInfo: cocosRef(this.addTargetInfo(targetLocalId)),
      nodes: [],
    });
  }

  mountChildOnPrefabInstance(parentId, childId) {
    const instance = this.nestedPrefabInstanceByNode.get(parentId);
    if (!instance?.instanceId || !instance.rootLocalId) return false;
    const key = `${instance.instanceId}:${instance.rootLocalId}`;
    let mountedInfoId = this.mountedChildrenByInstanceTarget.get(key);
    if (mountedInfoId == null) {
      mountedInfoId = this.mountedChildrenInfo(instance.rootLocalId);
      this.mountedChildrenByInstanceTarget.set(key, mountedInfoId);
      this.objects[instance.instanceId].mountedChildren.push(cocosRef(mountedInfoId));
    }
    this.objects[mountedInfoId].nodes.push(cocosRef(childId));
    return true;
  }

  mountedComponentsInfo(targetLocalId) {
    return this.add({
      __type__: 'cc.MountedComponentsInfo',
      targetInfo: cocosRef(this.addTargetInfo(targetLocalId)),
      components: [],
    });
  }

  mountComponentOnPrefabInstance(nodeId, componentId) {
    const instance = this.nestedPrefabInstanceByNode.get(nodeId);
    if (!instance?.instanceId || !instance.rootLocalId) return false;
    const key = `${instance.instanceId}:${instance.rootLocalId}`;
    let mountedInfoId = this.mountedComponentsByInstanceTarget.get(key);
    if (mountedInfoId == null) {
      mountedInfoId = this.mountedComponentsInfo(instance.rootLocalId);
      this.mountedComponentsByInstanceTarget.set(key, mountedInfoId);
      this.objects[instance.instanceId].mountedComponents.push(cocosRef(mountedInfoId));
    }
    this.objects[mountedInfoId].components.push(cocosRef(componentId));
    return true;
  }

  attachChild(parentId, childId) {
    if (parentId == null) return;
    if (this.mountChildOnPrefabInstance(parentId, childId)) return;
    const parent = this.objects[parentId];
    if (!Array.isArray(parent._children)) parent._children = [];
    parent._children.push(cocosRef(childId));
  }

  addComponent(nodeId, type, body, unityComponentId, fileId) {
    const mounted = this.nestedPrefabInstanceByNode.has(nodeId);
    const componentId = this.add({
      __type__: type,
      _name: '',
      _objFlags: 0,
      __editorExtras__: mounted ? { mountedRoot: cocosRef(nodeId) } : {},
      node: cocosRef(nodeId),
      _enabled: true,
      __prefab: cocosRef(this.compPrefabInfo(fileId)),
      ...body,
      _id: '',
    });
    if (!this.mountComponentOnPrefabInstance(nodeId, componentId)) {
      this.objects[nodeId]._components.push(cocosRef(componentId));
    }
    if (unityComponentId) this.componentMap.set(unityComponentId, componentId);
    return componentId;
  }

  addModelBakeSettings() {
    return this.add({
      __type__: 'cc.ModelBakeSettings',
      texture: null,
      uvParam: { __type__: 'cc.Vec4', x: 0, y: 0, z: 0, w: 0 },
      _bakeable: false,
      _castShadow: false,
      _receiveShadow: false,
      _recieveShadow: false,
      _lightmapSize: 64,
      _useLightProbe: false,
      _bakeToLightProbe: true,
      _reflectionProbeType: 0,
      _bakeToReflectionProbe: true,
    });
  }

  addMeshRenderer(nodeId, unityComponentId, meshUuid, materialUuid, fileId, config = {}) {
    const materialUuids = Array.isArray(materialUuid)
      ? materialUuid.filter(Boolean)
      : materialUuid
        ? [materialUuid]
        : [];
    return this.addComponent(nodeId, 'cc.MeshRenderer', {
      _materials: materialUuids.map((uuid) => cocosUuid(uuid, 'cc.Material')),
      _visFlags: 0,
      bakeSettings: cocosRef(this.addModelBakeSettings()),
      _mesh: meshUuid ? cocosUuid(meshUuid, 'cc.Mesh') : null,
      _shadowCastingMode: config.castShadows ? 1 : 0,
      _shadowReceivingMode: config.receiveShadows === false ? 0 : 1,
      _shadowBias: 0,
      _shadowNormalBias: 0,
      _reflectionProbeId: -1,
      _reflectionProbeBlendId: -1,
      _reflectionProbeBlendWeight: 0,
      _enabledGlobalStandardSkinObject: false,
      _enableMorph: true,
    }, unityComponentId, fileId);
  }

  addRigidBody(nodeId, unityComponentId, config, fileId) {
    const linearFactor = config?.linearFactor ? vec3(config.linearFactor.x, config.linearFactor.y, config.linearFactor.z) : vec3(1, 1, 1);
    const angularFactor = config?.angularFactor ? vec3(config.angularFactor.x, config.angularFactor.y, config.angularFactor.z) : vec3(1, 1, 1);
    return this.addComponent(nodeId, 'cc.RigidBody', {
      _group: Number(config?.group ?? 1),
      _type: Number(config?.type ?? 1),
      _mass: Number(config?.mass ?? 1),
      _allowSleep: Boolean(config?.allowSleep ?? true),
      _linearDamping: Number(config?.linearDamping ?? 0.1),
      _angularDamping: Number(config?.angularDamping ?? 0.1),
      _useGravity: Boolean(config?.useGravity ?? true),
      _linearFactor: linearFactor,
      _angularFactor: angularFactor,
      _useCCD: Boolean(config?.useCCD ?? false),
    }, unityComponentId, fileId);
  }

  addCharacterController(nodeId, unityComponentId, config, fileId) {
    return this.addComponent(nodeId, 'cc.CapsuleCharacterController', {
      _enabled: Boolean(config?.enabled ?? true),
      _center: vec3(
        Number(config?.center?.x || 0),
        Number(config?.center?.y || 0),
        Number(config?.center?.z || 0),
      ),
      _radius: Math.max(0.01, Number(config?.radius ?? 0.5)),
      _height: Math.max(0.01, Number(config?.height ?? 2.0)),
      _stepOffset: Math.max(0, Number(config?.stepOffset ?? 0.3)),
      _slopeLimit: Number(config?.slopeLimit ?? 45.0),
      _skinWidth: Math.max(0.001, Number(config?.skinWidth ?? 0.08)),
      _minMoveDistance: Math.max(0, Number(config?.minMoveDistance ?? 0.001)),
    }, unityComponentId, fileId);
  }

  addHingeConstraint(nodeId, unityComponentId, config, fileId) {
    return this.addComponent(nodeId, 'cc.HingeConstraint', {
      _enabled: Boolean(config?.enabled ?? true),
      _connectedBody: config?.connectedBodyNodeId != null ? cocosRef(config.connectedBodyNodeId) : null,
      _axis: vec3(
        Number(config?.axis?.x ?? 0),
        Number(config?.axis?.y ?? 1),
        Number(config?.axis?.z ?? 0),
      ),
      _pivotA: vec3(
        Number(config?.pivotA?.x || 0),
        Number(config?.pivotA?.y || 0),
        Number(config?.pivotA?.z || 0),
      ),
      _pivotB: vec3(
        Number(config?.pivotB?.x || 0),
        Number(config?.pivotB?.y || 0),
        Number(config?.pivotB?.z || 0),
      ),
      _enableLimit: Boolean(config?.enableLimit ?? false),
      _lowerLimit: Number(config?.lowerLimit ?? 0),
      _upperLimit: Number(config?.upperLimit ?? 0),
      _enableMotor: Boolean(config?.enableMotor ?? false),
      _motorSpeed: Number(config?.motorSpeed ?? 0),
      _maxMotorForce: Number(config?.maxMotorForce ?? 0),
    }, unityComponentId, fileId);
  }

  addFixedConstraint(nodeId, unityComponentId, config, fileId) {
    return this.addComponent(nodeId, 'cc.FixedConstraint', {
      _enabled: Boolean(config?.enabled ?? true),
      _connectedBody: config?.connectedBodyNodeId != null ? cocosRef(config.connectedBodyNodeId) : null,
    }, unityComponentId, fileId);
  }

  addPointToPointConstraint(nodeId, unityComponentId, config, fileId) {
    return this.addComponent(nodeId, 'cc.PointToPointConstraint', {
      _enabled: Boolean(config?.enabled ?? true),
      _connectedBody: config?.connectedBodyNodeId != null ? cocosRef(config.connectedBodyNodeId) : null,
      _pivotA: vec3(
        Number(config?.pivotA?.x || 0),
        Number(config?.pivotA?.y || 0),
        Number(config?.pivotA?.z || 0),
      ),
      _pivotB: vec3(
        Number(config?.pivotB?.x || 0),
        Number(config?.pivotB?.y || 0),
        Number(config?.pivotB?.z || 0),
      ),
    }, unityComponentId, fileId);
  }

  addCapsuleCollider(nodeId, unityComponentId, config, fileId) {
    return this.addComponent(nodeId, 'cc.CapsuleCollider', {
      _enabled: Boolean(config?.enabled ?? true),
      _material: config?.materialUuid ? cocosUuid(config.materialUuid, 'cc.PhysicsMaterial') : null,
      _isTrigger: Boolean(config?.isTrigger ?? false),
      _center: vec3(
        Number(config?.center?.x || 0),
        Number(config?.center?.y || 0),
        Number(config?.center?.z || 0),
      ),
      _radius: Math.max(0, Number(config?.radius ?? 0.5)),
      _cylinderHeight: Math.max(0, Number(config?.cylinderHeight ?? 1.0)),
      _direction: Number(config?.direction ?? 1),
    }, unityComponentId, fileId);
  }

  addSphereCollider(nodeId, unityComponentId, config, fileId) {
    return this.addComponent(nodeId, 'cc.SphereCollider', {
      _enabled: Boolean(config?.enabled ?? true),
      _material: config?.materialUuid ? cocosUuid(config.materialUuid, 'cc.PhysicsMaterial') : null,
      _isTrigger: Boolean(config?.isTrigger ?? false),
      _center: vec3(
        Number(config?.center?.x || 0),
        Number(config?.center?.y || 0),
        Number(config?.center?.z || 0),
      ),
      _radius: Math.max(0, Number(config?.radius ?? 0.5)),
    }, unityComponentId, fileId);
  }

  addBoxCollider(nodeId, unityComponentId, config, fileId) {
    return this.addComponent(nodeId, 'cc.BoxCollider', {
      _enabled: Boolean(config?.enabled ?? true),
      _material: config?.materialUuid ? cocosUuid(config.materialUuid, 'cc.PhysicsMaterial') : null,
      _isTrigger: Boolean(config?.isTrigger ?? false),
      _center: vec3(
        Number(config?.center?.x || 0),
        Number(config?.center?.y || 0),
        Number(config?.center?.z || 0),
      ),
      _size: vec3(
        Math.max(UNITY_3D_COLLIDER_DEPTH, Number(config?.size?.x ?? 1)),
        Math.max(UNITY_3D_COLLIDER_DEPTH, Number(config?.size?.y ?? 1)),
        Math.max(UNITY_3D_COLLIDER_DEPTH, Number(config?.size?.z ?? UNITY_3D_COLLIDER_DEPTH)),
      ),
    }, unityComponentId, fileId);
  }

  addMeshCollider(nodeId, unityComponentId, config, fileId) {
    return this.addComponent(nodeId, 'cc.MeshCollider', {
      _enabled: Boolean(config?.enabled ?? true),
      _material: config?.materialUuid ? cocosUuid(config.materialUuid, 'cc.PhysicsMaterial') : null,
      _isTrigger: Boolean(config?.isTrigger ?? false),
      _center: vec3(
        Number(config?.center?.x || 0),
        Number(config?.center?.y || 0),
        Number(config?.center?.z || 0),
      ),
      _mesh: config?.meshUuid ? cocosUuid(config.meshUuid, 'cc.Mesh') : null,
      _convex: Boolean(config?.convex ?? false),
    }, unityComponentId, fileId);
  }

  addCircleCollider2D(nodeId, unityComponentId, config, fileId) {
    return this.addComponent(nodeId, 'cc.CircleCollider2D', {
      _enabled: Boolean(config?.enabled ?? true),
      editing: false,
      tag: Number(config?.tag ?? 0),
      _group: Number(config?.group ?? 1),
      _density: Number(config?.density ?? 1),
      _sensor: Boolean(config?.sensor ?? false),
      _friction: Number(config?.friction ?? 0.2),
      _restitution: Number(config?.restitution ?? 0),
      _offset: vec2(
        Number(config?.offset?.x || 0),
        Number(config?.offset?.y || 0),
      ),
      _radius: Math.max(0.01, Number(config?.radius ?? 0.5)),
    }, unityComponentId, fileId);
  }

  addBoxCollider2D(nodeId, unityComponentId, config, fileId) {
    return this.addComponent(nodeId, 'cc.BoxCollider2D', {
      _enabled: Boolean(config?.enabled ?? true),
      editing: false,
      tag: Number(config?.tag ?? 0),
      _group: Number(config?.group ?? 1),
      _density: Number(config?.density ?? 1),
      _sensor: Boolean(config?.sensor ?? false),
      _friction: Number(config?.friction ?? 0.2),
      _restitution: Number(config?.restitution ?? 0),
      _offset: vec2(
        Number(config?.offset?.x || 0),
        Number(config?.offset?.y || 0),
      ),
      _size: size(
        Math.abs(Number(config?.size?.x ?? 1)),
        Math.abs(Number(config?.size?.y ?? 1)),
      ),
    }, unityComponentId, fileId);
  }

  addPolygonCollider2D(nodeId, unityComponentId, config, fileId) {
    return this.addComponent(nodeId, 'cc.PolygonCollider2D', {
      _enabled: Boolean(config?.enabled ?? true),
      editing: false,
      tag: Number(config?.tag ?? 0),
      _group: Number(config?.group ?? 1),
      _density: Number(config?.density ?? 1),
      _sensor: Boolean(config?.sensor ?? false),
      _friction: Number(config?.friction ?? 0.2),
      _restitution: Number(config?.restitution ?? 0),
      _offset: vec2(
        Number(config?.offset?.x || 0),
        Number(config?.offset?.y || 0),
      ),
      threshold: Number(config?.threshold ?? 1),
      _points: (config?.points || []).map((point) => vec2(Number(point?.x || 0), Number(point?.y || 0))),
    }, unityComponentId, fileId);
  }

  addSpriteRenderer(nodeId, unityComponentId, spriteUuid, materialUuid, unityColor, fileId, config = {}) {
    return this.addComponent(nodeId, 'cc.SpriteRenderer', {
      _enabled: Boolean(config?.enabled ?? true),
      _materials: [cocosUuid(materialUuid || BUILTIN_DEFAULT_SPRITE_RENDERER_MATERIAL_UUID, 'cc.Material')],
      _visFlags: 0,
      _spriteFrame: spriteUuid ? cocosUuid(spriteUuid, 'cc.SpriteFrame') : null,
      _mode: 0,
      _color: unityColorToCocos(unityColor),
      _flipX: false,
      _flipY: false,
      _size: vec2(),
    }, unityComponentId, fileId);
  }

  addCamera(nodeId, unityComponentId, doc, fileId) {
    const isOrthographic = Number(getField(doc, 'orthographic', getField(doc, 'm_Orthographic', 0)) || 0) !== 0;
    const projection = isOrthographic ? COCOS_CAMERA_PROJECTION_ORTHO : COCOS_CAMERA_PROJECTION_PERSPECTIVE;
    const fov = Number(getField(doc, 'field of view', getField(doc, 'm_FieldOfView', 60)) || 60);
    const orthoSize = Number(getField(doc, 'orthographic size', getField(doc, 'm_OrthographicSize', 5)) || 5);
    const orthoHeight = orthoSize * 2;
    const near = Number(getField(doc, 'near clip plane', getField(doc, 'm_NearClipPlane', 0.3)) || 0.3);
    const far = Number(getField(doc, 'far clip plane', getField(doc, 'm_FarClipPlane', 1000)) || 1000);
    const background = getField(doc, 'm_BackGroundColor', { r: 0, g: 0, b: 0, a: 0 });

    const unityClearFlags = Number(getField(doc, 'm_ClearFlags', 1) || 1);
    let cocosClearFlags = 6; // Solid color
    if (unityClearFlags === 1) cocosClearFlags = 7; // Skybox
    else if (unityClearFlags === 3) cocosClearFlags = 2; // Depth only
    else if (unityClearFlags === 4) cocosClearFlags = 0; // Nothing

    const cullingMask = Number(getField(doc, 'm_CullingMask.m_Bits', 0xffffffff) ?? 0xffffffff);

    return this.addComponent(nodeId, 'cc.Camera', {
      _projection: projection,
      _priority: 0,
      _fov: fov,
      _fovAxis: 0,
      _orthoHeight: orthoHeight,
      _near: near,
      _far: far,
      _color: unityColorToCocos(background),
      _depth: 1,
      _stencil: 0,
      _clearFlags: cocosClearFlags,
      _rect: rect(),
      _aperture: 19,
      _shutter: 8,
      _iso: 1,
      _screenScale: 1,
      _visibility: cullingMask,
      _targetTexture: null,
      _postProcess: null,
      _usePostProcess: false,
      _cameraType: -1,
      _trackingType: 0,
    }, unityComponentId, fileId);
  }

  addDirectionalLight(nodeId, unityComponentId, doc, fileId) {
    const intensity = Number(getField(doc, 'm_Intensity', 1) || 1);
    const staticSettings = this.add({ __type__: 'cc.StaticLightSettings', _baked: false, _editorOnly: false, _castShadow: false });
    return this.addComponent(nodeId, 'cc.DirectionalLight', {
      _color: unityColorToCocos(getField(doc, 'm_Color', { r: 1, g: 1, b: 1, a: 1 })),
      _useColorTemperature: false,
      _colorTemperature: 6570,
      _staticSettings: cocosRef(staticSettings),
      _visibility: 0xffffffff,
      _illuminanceHDR: intensity * 65000,
      _illuminance: intensity * 65000,
      _illuminanceLDR: intensity * 1.6927083333333333,
      _shadowEnabled: Number(getField(doc, 'm_Shadows.m_Type', 0) || 0) !== 0,
      _shadowPcf: 0,
      _shadowBias: 0.05,
      _shadowNormalBias: 0.4,
      _shadowSaturation: 1,
      _shadowDistance: 50,
      _shadowInvisibleOcclusionRange: 200,
      _csmLevel: 4,
      _csmLayerLambda: 0.75,
      _csmOptimizationMode: 2,
      _csmAdvancedOptions: false,
      _csmLayersTransition: false,
      _csmTransitionRange: 0.05,
      _shadowFixedArea: false,
      _shadowNear: 0.2,
      _shadowFar: 10,
      _shadowOrthoSize: 5,
    }, unityComponentId, fileId);
  }

  addSphereLight(nodeId, unityComponentId, doc, fileId) {
    const intensity = Number(getField(doc, 'm_Intensity', 1) || 1);
    const range = Number(getField(doc, 'm_Range', 10) || 10);
    const staticSettings = this.add({ __type__: 'cc.StaticLightSettings', _baked: false, _editorOnly: false, _castShadow: false });
    return this.addComponent(nodeId, 'cc.SphereLight', {
      _color: unityColorToCocos(getField(doc, 'm_Color', { r: 1, g: 1, b: 1, a: 1 })),
      _useColorTemperature: false,
      _colorTemperature: 6570,
      _staticSettings: cocosRef(staticSettings),
      _visibility: 0xffffffff,
      _luminanceHDR: intensity * UNITY_PUNCTUAL_INTENSITY_TO_LUMINANCE,
      _luminance: intensity * UNITY_PUNCTUAL_INTENSITY_TO_LUMINANCE,
      _luminanceLDR: intensity,
      _range: range,
      _size: 0.15,
    }, unityComponentId, fileId);
  }

  addSpotLight(nodeId, unityComponentId, doc, fileId) {
    const intensity = Number(getField(doc, 'm_Intensity', 1) || 1);
    const range = Number(getField(doc, 'm_Range', 10) || 10);
    const spotAngleDeg = Number(getField(doc, 'm_SpotAngle', 30) || 30);
    const spotAngleRad = (spotAngleDeg * Math.PI) / 180;
    const staticSettings = this.add({ __type__: 'cc.StaticLightSettings', _baked: false, _editorOnly: false, _castShadow: false });
    return this.addComponent(nodeId, 'cc.SpotLight', {
      _color: unityColorToCocos(getField(doc, 'm_Color', { r: 1, g: 1, b: 1, a: 1 })),
      _useColorTemperature: false,
      _colorTemperature: 6570,
      _staticSettings: cocosRef(staticSettings),
      _visibility: 0xffffffff,
      _luminanceHDR: intensity * UNITY_PUNCTUAL_INTENSITY_TO_LUMINANCE,
      _luminance: intensity * UNITY_PUNCTUAL_INTENSITY_TO_LUMINANCE,
      _luminanceLDR: intensity,
      _range: range,
      _size: 0.15,
      _spotAngle: spotAngleRad,
      _shadowEnabled: Number(getField(doc, 'm_Shadows.m_Type', 0) || 0) !== 0,
    }, unityComponentId, fileId);
  }

  addAnimationController(nodeId, unityComponentId, graphUuid, fileId) {
    return this.addComponent(nodeId, 'cc.animation.AnimationController', {
      _graph: graphUuid ? cocosUuid(graphUuid, 'cc.animation.AnimationGraph') : null,
      graph: graphUuid ? cocosUuid(graphUuid, 'cc.animation.AnimationGraph') : null,
    }, unityComponentId, fileId);
  }

  addAnimation(nodeId, clipInfos, defaultClipInfo, fileId) {
    const clipRefs = (clipInfos || [])
      .filter((clipInfo) => clipInfo?.uuid)
      .map((clipInfo) => cocosUuid(clipInfo.uuid, 'cc.AnimationClip'));
    return this.addComponent(nodeId, 'cc.Animation', {
      playOnLoad: false,
      _clips: clipRefs,
      _defaultClip: defaultClipInfo?.uuid ? cocosUuid(defaultClipInfo.uuid, 'cc.AnimationClip') : null,
    }, null, fileId);
  }

  addUiTransform(nodeId, unityComponentId, width, height, anchor, fileId) {
    const componentId = this.addComponent(nodeId, 'cc.UITransform', {
      _contentSize: size(width, height),
      _anchorPoint: vec2(Number(anchor?.x ?? 0.5), Number(anchor?.y ?? 0.5)),
    }, unityComponentId, fileId);
    this.uiTransformByNode.set(nodeId, componentId);
    return componentId;
  }

  addFullStretchWidget(nodeId, fileId) {
    return this.addComponent(nodeId, 'cc.Widget', {
      _alignFlags: 45,
      _target: null,
      _left: 0,
      _right: 0,
      _top: 0,
      _bottom: 0,
      _horizontalCenter: 0,
      _verticalCenter: 0,
      _isAbsLeft: true,
      _isAbsRight: true,
      _isAbsTop: true,
      _isAbsBottom: true,
      _isAbsHorizontalCenter: true,
      _isAbsVerticalCenter: true,
      _originalWidth: 0,
      _originalHeight: 0,
      _alignMode: 2,
      _lockFlags: 0,
    }, null, fileId);
  }

  addCanvas(nodeId, unityComponentId, fileId) {
    return this.addComponent(nodeId, 'cc.Canvas', {
      _cameraComponent: null,
      _alignCanvasWithScreen: false,
    }, unityComponentId, fileId);
  }

  addRenderRoot2D(nodeId, unityComponentId, fileId) {
    return this.addComponent(nodeId, 'cc.RenderRoot2D', {}, unityComponentId, fileId);
  }

  applyPreserveAspectSize(nodeId, spriteUuid) {
    const uiTransformId = this.uiTransformByNode.get(nodeId);
    const uiTransform = uiTransformId == null ? null : this.objects[uiTransformId];
    if (!uiTransform?._contentSize) return;
    const spriteSize = resolveSpriteFrameOriginalSize(this.options, this.cocosDb, spriteUuid);
    const fitted = fitPreserveAspectSize(uiTransform._contentSize, spriteSize);
    if (!fitted) return;
    uiTransform._contentSize = size(fitted.width, fitted.height);
  }

  addSprite(nodeId, unityComponentId, spriteUuid, unityColor, fileId, config = {}) {
    if (config.preserveAspect) this.applyPreserveAspectSize(nodeId, spriteUuid);
    const spriteAlpha = unitySpriteAlpha(unityColor, 1);
    const hasChildren = (this.objects[nodeId]?._children || []).length > 0;
    const customMaterialUuid = spriteAlpha < 1 && hasChildren
      ? ensureUiSpriteAlphaSepMaterial(this.options, this.reporter, spriteAlpha)
      : '';
    return this.addComponent(nodeId, 'cc.Sprite', {
      _customMaterial: customMaterialUuid ? cocosUuid(customMaterialUuid, 'cc.Material') : null,
      _srcBlendFactor: 2,
      _dstBlendFactor: 4,
      _color: unityColorToCocos(unityColor, customMaterialUuid ? 255 : null),
      _spriteFrame: spriteUuid ? cocosUuid(spriteUuid, 'cc.SpriteFrame') : null,
      _type: Number(config.spriteType ?? 0),
      _fillType: Number(config.fillType ?? 0),
      _sizeMode: 0,
      _fillCenter: vec2(),
      _fillStart: Number(config.fillStart ?? 0),
      _fillRange: Number(config.fillRange ?? 0),
      _isTrimmedMode: false,
      _useGrayscale: false,
      _atlas: null,
    }, unityComponentId, fileId);
  }

  addLabel(nodeId, unityComponentId, text, fileId, config = {}) {
    const fontSize = Math.max(1, finiteNumber(config.fontSize, 22));
    const lineHeight = Math.max(1, finiteNumber(config.lineHeight, fontSize));
    const fontUuid = String(config.fontUuid || '');
    const overflow = Number.isFinite(Number(config.overflow)) ? Number(config.overflow) : 2;
    return this.addComponent(nodeId, 'cc.Label', {
      _customMaterial: null,
      _srcBlendFactor: 2,
      _dstBlendFactor: 4,
      _color: unityColorToCocos(config.color || { r: 1, g: 1, b: 1, a: 1 }),
      _string: String(text || ''),
      _horizontalAlign: Math.max(0, Math.min(2, finiteNumber(config.horizontalAlign, 1))),
      _verticalAlign: Math.max(0, Math.min(2, finiteNumber(config.verticalAlign, 1))),
      _actualFontSize: fontSize,
      _fontSize: fontSize,
      _fontFamily: config.fontFamily || 'Arial',
      _lineHeight: lineHeight,
      _overflow: overflow,
      _enableWrapText: Boolean(config.enableWrapText),
      _font: fontUuid ? cocosUuid(fontUuid, 'cc.TTFFont') : null,
      _isSystemFontUsed: !fontUuid,
      _spacingX: finiteNumber(config.spacingX, 0),
      _isItalic: Boolean(config.isItalic),
      _isBold: Boolean(config.isBold),
      _isUnderline: Boolean(config.isUnderline),
      _underlineHeight: Math.max(1, finiteNumber(config.underlineHeight, 2)),
      _cacheMode: 0,
      _enableOutline: Boolean(config.enableOutline),
      _outlineColor: unityColorToCocos(config.outlineColor || { r: 0, g: 0, b: 0, a: 1 }),
      _outlineWidth: Math.max(0, finiteNumber(config.outlineWidth, 2)),
      _enableShadow: Boolean(config.enableShadow),
      _shadowColor: unityColorToCocos(config.shadowColor || { r: 0, g: 0, b: 0, a: 1 }),
      _shadowOffset: vec2(
        finiteNumber(config.shadowOffset?.x, 2),
        finiteNumber(config.shadowOffset?.y, -2),
      ),
      _shadowBlur: Math.max(0, finiteNumber(config.shadowBlur, 2)),
    }, unityComponentId, fileId);
  }

  addButton(nodeId, unityComponentId, fileId) {
    return this.addComponent(nodeId, 'cc.Button', {
      clickEvents: [],
      _interactable: true,
      _transition: 0,
      _normalColor: color(214, 214, 214, 255),
      _hoverColor: color(211, 211, 211, 255),
      _pressedColor: color(255, 255, 255, 255),
      _disabledColor: color(124, 124, 124, 255),
      _normalSprite: null,
      _hoverSprite: null,
      _pressedSprite: null,
      _disabledSprite: null,
      _duration: 0.1,
      _zoomScale: 1.2,
      _target: cocosRef(nodeId),
    }, unityComponentId, fileId);
  }

  addParticleSystemFromTemplate(nodeId, unityComponentId, unityDoc, fileId) {
    const template = this.loadParticleTemplate();
    if (!template) return 0;

    const sourceObjects = template.objects;
    const sourceParticleId = template.particleId;
    const idMap = new Map();
    const queue = [sourceParticleId];
    const skipKeys = new Set(['node', '__prefab']);

    while (queue.length) {
      const oldId = queue.shift();
      if (idMap.has(oldId)) continue;
      const newId = this.add({});
      idMap.set(oldId, newId);
      collectCocosRefs(sourceObjects[oldId], (refId, key) => {
        if (!skipKeys.has(key)) queue.push(refId);
      });
    }

    for (const [oldId, newId] of idMap.entries()) {
      const cloned = remapCocosIds(sourceObjects[oldId], idMap, skipKeys);
      this.objects[newId] = cloned;
    }

    const particleId = idMap.get(sourceParticleId);
    const particle = this.objects[particleId];
    particle.node = cocosRef(nodeId);
    particle.__prefab = cocosRef(this.compPrefabInfo(fileId));
    particle._enabled = true;
    particle.duration = Number(getField(unityDoc, 'lengthInSec', particle.duration || 1) || 1);
    particle.loop = Number(getField(unityDoc, 'looping', particle.loop ? 1 : 0) || 0) !== 0;
    particle.simulationSpeed = Number(getField(unityDoc, 'simulationSpeed', particle.simulationSpeed || 1) || 1);
    particle.playOnAwake = Number(getField(unityDoc, 'playOnAwake', particle.playOnAwake ? 1 : 0) || 0) !== 0;
    particle._prewarm = Number(getField(unityDoc, 'prewarm', particle._prewarm ? 1 : 0) || 0) !== 0;
    particle._id = '';

    this.objects[nodeId]._components.push(cocosRef(particleId));
    if (unityComponentId) this.componentMap.set(unityComponentId, particleId);
    return particleId;
  }

  loadParticleTemplate() {
    if (this.particleTemplate !== undefined) return this.particleTemplate;
    const preferred = [
      path.join(this.options.cocosRoot, 'assets', 'particles', 'Tape_vfx_Basket_close.prefab'),
      path.join(this.options.cocosRoot, 'assets', 'particles', 'TapeTap_NewBox.prefab'),
    ];
    const candidates = [
      ...preferred,
      ...findFiles(path.join(this.options.cocosRoot, 'assets'), (file) => file.endsWith('.prefab')),
    ];
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      const objects = readJsonIfExists(file);
      if (!Array.isArray(objects)) continue;
      const particleId = objects.findIndex((obj) => obj?.__type__ === 'cc.ParticleSystem');
      if (particleId >= 0) {
        this.particleTemplate = { file, objects, particleId };
        return this.particleTemplate;
      }
    }

    const libraryCandidates = findFiles(path.join(this.options.cocosRoot, 'library'), (file) => file.endsWith('.json'));
    for (const file of libraryCandidates) {
      const objects = readJsonIfExists(file);
      if (!Array.isArray(objects)) continue;
      const particleId = objects.findIndex((obj) => obj?.__type__ === 'cc.ParticleSystem');
      if (particleId >= 0) {
        this.particleTemplate = { file, objects, particleId };
        return this.particleTemplate;
      }
    }

    this.particleTemplate = null;
    return this.particleTemplate;
  }

  clonePrefabTree(sourceObjects, parentId = null) {
    if (!Array.isArray(sourceObjects)) return null;
    const sourceRootId = sourceObjects[0]?.data?.__id__;
    if (!Number.isInteger(sourceRootId) || sourceRootId < 0 || !sourceObjects[sourceRootId]) return null;

    const idMap = new Map();
    const queue = [sourceRootId];
    const skipKeys = new Set(['asset']);

    while (queue.length) {
      const oldId = queue.shift();
      if (idMap.has(oldId)) continue;
      const source = sourceObjects[oldId];
      if (!source || typeof source !== 'object') continue;
      const newId = this.add({});
      idMap.set(oldId, newId);
      collectCocosRefs(source, (refId, key) => {
        if (!skipKeys.has(key)) queue.push(refId);
      });
    }

    for (const [oldId, newId] of idMap.entries()) {
      this.objects[newId] = remapCocosIds(sourceObjects[oldId], idMap, skipKeys);
    }

    const rootId = idMap.get(sourceRootId);
    if (!Number.isInteger(rootId)) return null;

    this.objects[rootId]._parent = parentId == null ? null : cocosRef(parentId);
    this.attachChild(parentId, rootId);

    // `prefabRootNode` names the root of the prefab the instance now lives in, so it
    // must not be remapped along with the rest of the clone. Leaving the remapped
    // source root in place makes it point at the instance's own node, and Cocos's
    // getOutMostPrefabInstanceInfo then walks in a circle:
    //   "prefab instance root node has loop".
    for (const newId of idMap.values()) {
      const cloned = this.objects[newId];
      if (cloned?.__type__ === 'cc.PrefabInstance') cloned.prefabRootNode = cocosRef(1);
    }

    const rootPrefabInfoId = this.objects[rootId]?._prefab?.__id__;
    if (parentId == null && Number.isInteger(rootPrefabInfoId)) this.rootPrefabInfoId = rootPrefabInfoId;

    return { rootId, rootPrefabInfoId, idMap };
  }

  validate() {
    const errors = [];
    const walk = (value, where) => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${where}[${index}]`));
        return;
      }
      if (!value || typeof value !== 'object') return;
      if (Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, '__id__')) {
        const id = value.__id__;
        if (!Number.isInteger(id) || id < 0 || id >= this.objects.length) errors.push(`bad ref at ${where}: ${id}`);
        return;
      }
      for (const [key, child] of Object.entries(value)) walk(child, `${where}.${key}`);
    };
    this.objects.forEach((obj, index) => walk(obj, String(index)));

    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      if (obj.__type__ !== 'cc.Node') continue;
      for (const componentRef of obj._components || []) {
        const componentId = componentRef.__id__;
        const component = this.objects[componentId];
        if (!component || component.node?.__id__ !== i) {
          errors.push(`node ${i} has component ${componentId} with mismatched node ref`);
        }
      }
    }
    return errors;
  }
}

function buildCocosPrefabBuilder(model, outputFile, options, reporter, unityDb, cocosDb) {
  const rootName = model.roots[0]
    ? model.gameObjects.get(model.roots[0].gameObjectId)?.name || path.basename(outputFile, '.prefab')
    : path.basename(outputFile, '.prefab');
  const builder = new CocosPrefabBuilder(rootName, cocosDb, reporter, options);
  const layerResolver = buildLayerResolver(options, cocosDb, reporter);

  for (const root of model.roots) emitNodeRecursive(root, null, model, builder, layerResolver, reporter, options, unityDb, cocosDb);
  emitComponents(model, builder, reporter, options, unityDb, cocosDb);
  runtimeComponentPorter.attachParticleSubEmitterFollowers(model, builder, reporter);
  runtimeComponentPorter.attachParticleRateOverDistanceEmitters(model, builder, reporter);
  runtimeComponentPorter.attachParticleHierarchyTransformSync(builder, reporter);
  if (builder.rootPrefabInfoId && builder.nestedPrefabInstanceRootIds.length) {
    const existing = Array.isArray(builder.objects[builder.rootPrefabInfoId].nestedPrefabInstanceRoots)
      ? builder.objects[builder.rootPrefabInfoId].nestedPrefabInstanceRoots.filter((entry) => Number.isInteger(entry?.__id__))
      : [];
    const seen = new Set(existing.map((entry) => entry.__id__));
    const merged = [...existing];
    for (const entry of builder.nestedPrefabInstanceRootIds.map(cocosRef)) {
      if (seen.has(entry.__id__)) continue;
      seen.add(entry.__id__);
      merged.push(entry);
    }
    builder.objects[builder.rootPrefabInfoId].nestedPrefabInstanceRoots = merged;
  }

  const errors = builder.validate();
  for (const error of errors) reporter.high('COCOS_PREFAB_INVALID_REF', outputFile, '', 'Generated prefab reference graph is invalid', error);
  if (errors.length) {
    fail(`Generated prefab "${outputFile}" is invalid with ${errors.length} reference errors: ${errors.join('; ')}`);
  }

  return { builder, rootName };
}

function writeCocosPrefab(outputFile, builder, rootName, options) {
  if (!options.dryRun) {
    ensureDir(path.dirname(outputFile));
    ensureDirectoryMetas(path.dirname(outputFile), path.join(options.cocosRoot, 'assets'));
    fs.writeFileSync(outputFile, `${JSON.stringify(builder.objects, null, 2)}\n`, 'utf8');
    const meta = ensurePrefabMeta(outputFile, rootName);
    syncImportedPrefabLibraryCache(outputFile, builder.objects, meta, options);
  }
}

function syncImportedPrefabLibraryCache(prefabFile, objects, meta, options) {
  if (!meta?.uuid || !Array.isArray(objects)) return false;
  const libraryFile = libraryJsonPathForUuid(options, meta.uuid);
  if (!fs.existsSync(libraryFile)) return false;
  fs.writeFileSync(libraryFile, `${JSON.stringify(objects, null, 2)}\n`, 'utf8');
  return true;
}

function syncImportedMaterialLibraryCache(materialData, meta, options) {
  return syncImportedMaterialLibraryCacheImpl(materialData, meta, options);
}

function recordPendingMeshRepair(options, prefabFile, componentFileId, modelStem, meshNameHint, source) {
  if (!options || !prefabFile || !componentFileId || !modelStem) return;
  if (!options._pendingMeshRepairs) options._pendingMeshRepairs = new Map();
  const key = path.resolve(prefabFile);
  const entries = options._pendingMeshRepairs.get(key) || [];
  entries.push({
    componentFileId,
    modelStem,
    meshNameHint: meshNameHint || '',
    source: source || '',
  });
  options._pendingMeshRepairs.set(key, entries);
}

function componentPrefabFileId(objects, component) {
  const prefabInfoId = component?.__prefab?.__id__;
  if (prefabInfoId == null) return '';
  return objects[prefabInfoId]?.fileId || '';
}

function repairPendingMeshRefs(prefabFile, cocosDb, reporter, options) {
  if (options.dryRun || !options._pendingMeshRepairs) return 0;
  const entries = options._pendingMeshRepairs.get(path.resolve(prefabFile)) || [];
  if (!entries.length || !fs.existsSync(prefabFile)) return 0;

  const objects = readJsonIfExists(prefabFile);
  if (!Array.isArray(objects)) return 0;

  const repairs = [];
  for (const entry of entries) {
    let component = objects.find((obj) => (
      obj?.__type__ === 'cc.MeshRenderer' &&
      componentPrefabFileId(objects, obj) === entry.componentFileId
    ));
    let meshOwner = component;

    if (!meshOwner) {
      component = objects.find((obj) => (
        obj?.__type__ === 'cc.ParticleSystem' &&
        componentPrefabFileId(objects, obj) === entry.componentFileId
      ));
      const rendererId = Number(component?.renderer?.__id__);
      const renderer = Number.isInteger(rendererId) ? objects[rendererId] : null;
      if (renderer?.__type__ === 'cc.ParticleSystemRenderer') meshOwner = renderer;
    }

    if (!meshOwner || meshOwner._mesh) continue;

    const resolved = cocosDb.resolveModelMeshByStem(entry.modelStem, entry.meshNameHint);
    if (!resolved?.meshUuid) continue;

    meshOwner._mesh = cocosUuid(resolved.meshUuid, 'cc.Mesh');
    repairs.push({ ...entry, meshUuid: resolved.meshUuid, source: resolved.source || entry.source });
  }

  if (!repairs.length) return 0;

  fs.writeFileSync(prefabFile, `${JSON.stringify(objects, null, 2)}\n`, 'utf8');
  syncImportedPrefabLibraryCache(prefabFile, objects, readJsonIfExists(`${prefabFile}.meta`), options);
  for (const repair of repairs) {
    reporter.low(
      'PREFAB_PENDING_MESH_REF_REPAIRED',
      toPosix(path.relative(options.cocosRoot, prefabFile)),
      repair.meshNameHint,
      'Pending mesh slot was filled from the current imported model meta',
      `${repair.source || repair.modelStem} -> ${repair.meshUuid}`,
    );
  }
  return repairs.length;
}

function repairAllPendingMeshRefs(cocosDb, reporter, options) {
  if (!options._pendingMeshRepairs) return 0;
  let repaired = 0;
  for (const prefabFile of options._pendingMeshRepairs.keys()) {
    repaired += repairPendingMeshRefs(prefabFile, cocosDb, reporter, options);
  }
  return repaired;
}

function repairGeneratedPrefabAssetRefs(prefabFile, cocosDb, reporter, options) {
  if (options.dryRun || !fs.existsSync(prefabFile)) return 0;
  const objects = readJsonIfExists(prefabFile);
  if (!Array.isArray(objects)) return 0;

  const repairs = [];
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.__uuid__ && value.__expectedType__) {
      const currentUuid = cocosDb.currentSubAssetUuid(value.__uuid__, value.__expectedType__);
      if (currentUuid && currentUuid !== value.__uuid__) {
        repairs.push({ oldUuid: value.__uuid__, newUuid: currentUuid, expectedType: value.__expectedType__ });
        value.__uuid__ = currentUuid;
      }
      return;
    }
    for (const child of Object.values(value)) walk(child);
  };

  walk(objects);
  if (!repairs.length) return 0;

  fs.writeFileSync(prefabFile, `${JSON.stringify(objects, null, 2)}\n`, 'utf8');
  for (const repair of repairs) {
    reporter.low(
      'PREFAB_STALE_ASSET_REF_REPAIRED',
      toPosix(path.relative(options.cocosRoot, prefabFile)),
      repair.expectedType,
      'Stale generated Cocos sub-asset reference was updated to the current imported meta uuid',
      `${repair.oldUuid} -> ${repair.newUuid}`
    );
  }
  return repairs.length;
}

function repairPrefabAndImportedLibraryAssetRefs(prefabFile, cocosDb, reporter, options) {
  let repaired = repairGeneratedPrefabAssetRefs(prefabFile, cocosDb, reporter, options);
  const meta = readJsonIfExists(`${prefabFile}.meta`);
  if (meta?.uuid) {
    repaired += repairGeneratedPrefabAssetRefs(libraryJsonPathForUuid(options, meta.uuid), cocosDb, reporter, options);
  }
  return repaired;
}

function repairSiblingPrefabAssetRefs(outputFile, cocosDb, reporter, options) {
  if (options.dryRun) return;
  const dir = path.dirname(outputFile);
  const siblingPrefabs = walkContainedFiles(
    dir,
    (file) => file.endsWith('.prefab'),
    { recursive: false },
  );
  for (const prefabFile of siblingPrefabs) {
    repairPrefabAndImportedLibraryAssetRefs(prefabFile, cocosDb, reporter, options);
  }
}

function patchParticleMeshLibraryAsset(meshUuid, options) {
  if (!meshUuid || options.dryRun) return false;
  const file = libraryJsonPathForUuid(options, meshUuid);
  const mesh = readJsonIfExists(file);
  if (mesh?.__type__ !== 'cc.Mesh') return false;

  let changed = false;
  for (const primitive of mesh._struct?.primitives || []) {
    if (!primitive || typeof primitive !== 'object') continue;
    if (Array.isArray(primitive.vertexBundelIndices) && !Array.isArray(primitive.vertexBundleIndices)) {
      primitive.vertexBundleIndices = [...primitive.vertexBundelIndices];
      changed = true;
    }
    if (Array.isArray(primitive.vertexBundleIndices) && !Array.isArray(primitive.vertexBundelIndices)) {
      primitive.vertexBundelIndices = [...primitive.vertexBundleIndices];
      changed = true;
    }
  }

  if (!changed) return false;
  fs.writeFileSync(file, `${JSON.stringify(mesh, null, 2)}\n`, 'utf8');
  return true;
}

function patchParticleRendererMeshLibraryAssets(prefabFile, reporter, options) {
  if (options.dryRun || !fs.existsSync(prefabFile)) return 0;
  const objects = readJsonIfExists(prefabFile);
  if (!Array.isArray(objects)) return 0;

  const patched = new Set();
  for (const obj of objects) {
    if (obj?.__type__ !== 'cc.ParticleSystemRenderer') continue;
    const renderMode = Number(obj._renderMode ?? obj.renderMode ?? 0);
    if (renderMode !== 4) continue;
    const meshUuid = obj._mesh?.__uuid__;
    if (!meshUuid || patched.has(meshUuid)) continue;
    if (!patchParticleMeshLibraryAsset(meshUuid, options)) continue;
    patched.add(meshUuid);
    reporter.low(
      'PARTICLE_MESH_LIBRARY_PATCHED',
      toPosix(path.relative(options.cocosRoot, prefabFile)),
      meshUuid,
      'Patched imported Cocos mesh library data for ParticleSystemRenderer Mesh mode compatibility'
    );
  }
  return patched.size;
}

function resolvePrefabAssetUuid(prefabFile, syncNodeName, options) {
  const existing = readJsonIfExists(`${prefabFile}.meta`);
  if (existing?.uuid) return existing.uuid;
  if (options.dryRun) return randomUuid();
  ensureDir(path.dirname(prefabFile));
  ensureDirectoryMetas(path.dirname(prefabFile), path.join(options.cocosRoot, 'assets'));
  return ensurePrefabMeta(prefabFile, syncNodeName)?.uuid || '';
}

function queueNestedPrefabAsset(options, sourceAsset, unityDb, reporter, recursionDepth = 0) {
  if (!options._nestedPrefabAssets) options._nestedPrefabAssets = new Map();
  const key = path.resolve(sourceAsset.path);
  let entry = options._nestedPrefabAssets.get(key);
  if (!entry) {
    entry = {
      sourceAsset,
      outputFile: nestedPrefabOutputPath(options, sourceAsset),
      rootName: path.basename(sourceAsset.path, path.extname(sourceAsset.path)),
      rootLocalId: '',
      prefabUuid: '',
      model: null,
    };
    options._nestedPrefabAssets.set(key, entry);
  }
  if (!entry.model && unityDb && reporter) {
    const nested = describeNestedPrefabAsset(options, sourceAsset, unityDb, reporter, recursionDepth);
    if (nested) {
      entry.model = nested.model;
      entry.rootName = nested.rootName;
      entry.rootLocalId = nested.rootLocalId;
    }
  }
  if (!entry.prefabUuid) entry.prefabUuid = resolvePrefabAssetUuid(entry.outputFile, entry.rootName, options);
  return entry;
}

function nestedPrefabOutputPath(options, sourceAsset) {
  const fileName = `${path.basename(sourceAsset.path, path.extname(sourceAsset.path))}.prefab`;
  return path.join(path.dirname(options.out), fileName);
}

function writeQueuedNestedPrefabAssets(options, reporter, unityDb, cocosDb) {
  if (!options.recursive || !options._nestedPrefabAssets) return;
  if (!options._writtenNestedPrefabAssets) options._writtenNestedPrefabAssets = new Set();

  const queue = [...options._nestedPrefabAssets.values()];
  for (let index = 0; index < queue.length; index++) {
    const entry = queue[index];
    const sourceAsset = entry.sourceAsset;
    const sourcePath = path.resolve(sourceAsset.path);
    if (sourcePath === path.resolve(options.src)) continue;
    if (options._writtenNestedPrefabAssets.has(sourcePath)) continue;
    options._writtenNestedPrefabAssets.add(sourcePath);

    const outputFile = entry.outputFile || nestedPrefabOutputPath(options, sourceAsset);
    if (path.resolve(outputFile) === path.resolve(options.out)) continue;
    if (fs.existsSync(outputFile) && !options.overwrite && !options.dryRun) {
      reporter.medium('NESTED_PREFAB_OUTPUT_EXISTS', sourceAsset.path, outputFile, 'Nested Cocos prefab already exists; use --overwrite to replace it');
      continue;
    }

    const nestedOptions = {
      ...options,
      src: sourceAsset.path,
      out: outputFile,
    };
    const nestedModel = entry.model || buildUnityPrefabModel(sourceAsset.path, unityDb, reporter, nestedOptions);
    const { builder, rootName } = buildCocosPrefabBuilder(nestedModel, outputFile, nestedOptions, reporter, unityDb, cocosDb);
    writeCocosPrefab(outputFile, builder, rootName, nestedOptions);
    reporter.low('NESTED_PREFAB_ASSET_WRITTEN', sourceAsset.path, outputFile, 'Generated Cocos prefab for nested Unity prefab dependency');

    for (const queuedEntry of options._nestedPrefabAssets.values()) {
      if (!queue.some((asset) => path.resolve(asset.sourceAsset.path) === path.resolve(queuedEntry.sourceAsset.path))) {
        queue.push(queuedEntry);
      }
    }
  }
}

function emitCreatorReopenNotice(options, reporter) {
  if (options.dryRun || !options._addedCocosCustomLayers?.size) return;

  const projectFile = toPosix(path.relative(options.cocosRoot, cocosProjectSettingsFile(options.cocosRoot)));
  const addedLayers = [...options._addedCocosCustomLayers.values()]
    .sort((left, right) => Number(left.value) - Number(right.value) || String(left.name).localeCompare(String(right.name)));
  const detail = addedLayers.map((layer) => `${layer.name}=${layer.value}`).join(', ');

  reporter.low(
    'CREATOR_REOPEN_REQUIRED',
    projectFile,
    'Inspector',
    'Added new Cocos custom layer settings during port; reopen Cocos Creator to refresh Inspector layer names',
    detail,
  );
  console.warn(`[unity-cocos-port] WARN: Added Cocos custom layer(s) to ${projectFile}: ${detail}. Reopen Cocos Creator to refresh Inspector layer names.`);
}

function portPrefab(options, reporter) {
  if (!options.src) fail('Missing --src');
  if (!options.out) fail('Missing --out');
  if (!fs.existsSync(options.src)) fail(`Unity prefab not found: ${options.src}`);
  if (fs.existsSync(options.out) && !options.overwrite && !options.dryRun) {
    fail(`Output already exists. Use --overwrite to replace it: ${options.out}`);
  }
  if (!reporter) reporter = new Reporter();
  if (!options._addedCocosCustomLayers) options._addedCocosCustomLayers = new Map();

  const unityDb = new UnityAssetDatabase(options.unityRoot, unityPackageAssetRoots(options.unityRoot));
  unityDb.scan();
  runtimeComponentPorter.ensureParticleSubEmitterFollowerScript(options, reporter);
  runtimeComponentPorter.ensureParticleHierarchyTransformSyncScript(options, reporter);
  runtimeComponentPorter.ensureParticleRateOverDistanceEmitterScript(options, reporter);
  runtimeComponentPorter.ensureSpriteRendererColorAdapterScript(options, reporter);
  runtimeComponentPorter.ensureSpriteRendererColorAssets(options, reporter);
  const cocosDb = new CocosAssetDatabase(options.cocosRoot);
  cocosDb.scan({ readOnly: !!options.dryRun });

  const model = buildUnityPrefabModel(options.src, unityDb, reporter, options);
  const { builder, rootName } = buildCocosPrefabBuilder(model, options.out, options, reporter, unityDb, cocosDb);
  writeCocosPrefab(options.out, builder, rootName, options);
  writeQueuedNestedPrefabAssets(options, reporter, unityDb, cocosDb);
  const refreshedCocosDb = new CocosAssetDatabase(options.cocosRoot);
  refreshedCocosDb.scan({ readOnly: !!options.dryRun });
  repairAllPendingMeshRefs(refreshedCocosDb, reporter, options);
  repairSiblingPrefabAssetRefs(options.out, refreshedCocosDb, reporter, options);
  patchParticleRendererMeshLibraryAssets(options.out, reporter, options);

  emitCreatorReopenNotice(options, reporter);
  const actualReport = options.report && !options.dryRun ? reporter.writeCsv(options.report, rootName) : '';
  const counts = reporter.summary();
  log(`${options.dryRun ? 'Dry-run built' : 'Wrote'} ${toPosix(path.relative(options.cocosRoot, options.out))}`);
  if (actualReport) {
    log(`Report: ${toPosix(path.relative(options.cocosRoot, actualReport))} (high=${counts.high}, medium=${counts.medium}, low=${counts.low})`);
  }
  return { actualReport, counts, rootName, outputFile: options.out };
}

function isDirectory(file) {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function findUnityPrefabFiles(root) {
  return findFiles(root, (file) => path.extname(file).toLowerCase() === '.prefab')
    .sort((left, right) => toPosix(path.relative(root, left)).localeCompare(toPosix(path.relative(root, right))));
}

function buildPrefabBatchPlan(options) {
  if (!options.src) fail('Missing --src');
  if (!options.out) fail('Missing --out');
  if (!fs.existsSync(options.src)) fail(`Unity prefab source not found: ${options.src}`);
  if (!isDirectory(options.src)) return null;
  if (path.extname(options.out).toLowerCase() === '.prefab') {
    fail('When --src is a folder, --out must be a Cocos output folder, not a .prefab file');
  }
  if (fs.existsSync(options.out) && !isDirectory(options.out)) {
    fail(`Output path must be a folder when --src is a folder: ${options.out}`);
  }

  const sourceRoot = path.resolve(options.src);
  const outputRoot = path.resolve(options.out);
  const prefabFiles = findUnityPrefabFiles(sourceRoot);
  if (!prefabFiles.length) fail(`No Unity .prefab files found under: ${sourceRoot}`);

  const plan = prefabFiles.map((sourceFile) => {
    const relative = path.relative(sourceRoot, sourceFile);
    return {
      sourceFile,
      outputFile: path.join(outputRoot, relative),
      relative: toPosix(relative),
    };
  });

  if (!options.overwrite && !options.dryRun) {
    const conflicts = plan.filter((entry) => fs.existsSync(entry.outputFile));
    if (conflicts.length) {
      const listed = conflicts.slice(0, 10).map((entry) => toPosix(path.relative(options.cocosRoot, entry.outputFile))).join(', ');
      const suffix = conflicts.length > 10 ? `, ... +${conflicts.length - 10} more` : '';
      fail(`Output prefab already exists. Use --overwrite to replace it: ${listed}${suffix}`);
    }
  }

  return plan;
}

function portPrefabBatch(options) {
  const plan = buildPrefabBatchPlan(options);
  if (!plan) {
    const reporter = new Reporter();
    return [portPrefab(options, reporter)];
  }

  const totals = { high: 0, medium: 0, low: 0 };
  const sourceRoot = path.resolve(options.src);
  const quiet = !!options.quiet;

  // --jobs: chia danh sách prefab cho các tiến trình con. Dùng tiến trình chứ
  // không dùng worker_threads vì porter giữ một UnityAssetDatabase ~500MB trong
  // bộ nhớ; chia sẻ trong cùng process sẽ không an toàn còn nhân bản thì tốn RAM
  // như nhau, mà tiến trình riêng thì cách ly lỗi tốt hơn.
  if (!options.shard && Number(options.jobs) > 1 && plan.length > 1) {
    // Trả về Promise — `main()` await nó.
    return runShardedBatch(options, plan);
  }

  let work = plan;
  if (options.shard) {
    work = plan.filter((_, i) => i % options.shard.total === options.shard.index);
    log(`Shard ${options.shard.index + 1}/${options.shard.total}: ${work.length}/${plan.length} prefab`);
  } else {
    log(`Found ${plan.length} Unity prefab(s) under ${sourceRoot}`);
  }

  // Cache tăng dần: bỏ qua prefab mà cả nguồn, đích và phạm vi --src đều không đổi.
  const cacheFile = path.join(options.cocosRoot, '.unity', options.shard
    ? `port-cache.shard${options.shard.index}.json`
    : 'port-cache.json');
  const cache = new PortCache(cacheFile, options, !options.noCache && !options.dryRun, sourceRoot);

  const results = [];
  let failed = 0;
  let skipped = 0;
  for (let index = 0; index < work.length; index += 1) {
    const entry = work[index];

    if (cache.canSkip(entry.sourceFile, entry.outputFile)) {
      skipped += 1;
      const counts = cache.cachedCounts(entry.sourceFile);
      totals.high += counts.high;
      totals.medium += counts.medium;
      totals.low += counts.low;
      results.push({
        counts,
        rootName: path.basename(entry.sourceFile, path.extname(entry.sourceFile)),
        outputFile: entry.outputFile,
        cached: true,
      });
      if (!quiet) log(`Cached ${index + 1}/${work.length}: ${entry.relative}`);
      continue;
    }

    if (!quiet) log(`Porting ${index + 1}/${work.length}: ${entry.relative}`);
    const reporter = new Reporter();
    let result = null;
    try {
      result = portPrefab({
        ...options,
        src: entry.sourceFile,
        out: entry.outputFile,
        unityRoot: options.unityRoot || inferUnityRoot(entry.sourceFile),
      }, reporter);
    } catch (error) {
      failed += 1;
      const message = error?.message || String(error);
      reporter.high('PREFAB_PORT_FAILED', entry.sourceFile, entry.outputFile, message);
      const prefabName = path.basename(entry.sourceFile, path.extname(entry.sourceFile));
      const actualReport = options.dryRun ? '' : reporter.writeCsv(options.report, prefabName);
      const counts = reporter.summary();
      result = { actualReport, counts, rootName: prefabName, outputFile: entry.outputFile, failed: true };
      console.error(`[unity-cocos-port] ERROR: ${entry.relative}: ${message}`);
      log(`Report: ${toPosix(path.relative(options.cocosRoot, actualReport))} (high=${counts.high}, medium=${counts.medium}, low=${counts.low})`);
    }
    results.push(result);
    totals.high += result.counts.high;
    totals.medium += result.counts.medium;
    totals.low += result.counts.low;
    if (!result.failed) cache.record(entry.sourceFile, entry.outputFile, result.counts);
  }

  cache.save();
  const waitNote = importWaitBudget.summary();
  log(
    `Batch complete: ${results.length} prefab(s), skipped=${skipped}, failed=${failed}, ` +
    `high=${totals.high}, medium=${totals.medium}, low=${totals.low} | ${cache.summary()}` +
    (waitNote ? ` | ${waitNote}` : '')
  );
  if (failed) process.exitCode = 1;
  return results;
}

/**
 * Chạy batch bằng nhiều tiến trình con, mỗi con nhận một shard của danh sách.
 * Mỗi con ghi report riêng rồi cha gộp lại, nên không có tranh chấp file.
 */
async function runShardedBatch(options, plan) {
  const { spawn } = require('child_process');
  const jobs = Math.min(Number(options.jobs), plan.length);
  log(`Chạy song song ${jobs} tiến trình cho ${plan.length} prefab`);

  // Một lượt duy nhất: bỏ `--jobs`, `--report` VÀ giá trị đi kèm của chúng.
  // (Lọc trước rồi mới quét sẽ làm mất dấu `--jobs` nên giá trị `4` lọt sang
  // tiến trình con và bị coi là option lạ.)
  const argv = process.argv.slice(2);
  const cleanedArgs = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--jobs' || arg === '--report') { i += 1; continue; }
    if (/^--(jobs|report)=/.test(arg)) continue;
    cleanedArgs.push(arg);
  }

  const reportBase = options.report || path.join(options.cocosRoot, '.unity', 'port-report.csv');
  const children = [];
  for (let index = 0; index < jobs; index += 1) {
    const shardReport = reportBase.replace(/\.csv$/i, `.shard${index}.csv`);
    const args = [
      __filename,
      ...cleanedArgs,
      '--shard', `${index}/${jobs}`,
      '--quiet',
    ];
    if (!options.dryRun) args.push('--report', shardReport);
    children.push({ index, shardReport, args });
  }

  // spawnSync sẽ chạy TUẦN TỰ (nó block tới khi con xong) nên phải dùng spawn
  // bất đồng bộ rồi chờ tất cả. Vì hàm này đồng bộ, dùng Atomics.wait để nhường
  // CPU trong lúc chờ thay vì quay vòng đốt CPU.
  const running = children.map((child) => {
    const proc = spawn(process.execPath, child.args, {
      cwd: options.cocosRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const state = { done: false, status: null, stdout: '', stderr: '' };
    proc.stdout.on('data', (d) => { state.stdout += d.toString(); });
    proc.stderr.on('data', (d) => { state.stderr += d.toString(); });
    proc.on('close', (code) => { state.done = true; state.status = code; });
    proc.on('error', (err) => { state.done = true; state.status = 1; state.stderr += String(err.message); });
    return state;
  });

  // Bơm event loop cho tới khi mọi shard kết thúc.
  const waitAll = () => new Promise((resolve) => {
    const tick = () => {
      if (running.every((r) => r.done)) return resolve();
      setTimeout(tick, 200);
    };
    tick();
  });
  const doneSignal = waitAll();

  await doneSignal;

  const totals = { high: 0, medium: 0, low: 0 };
  let failedShards = 0;
  const mergedLines = [];
  for (let i = 0; i < children.length; i += 1) {
    const proc = running[i];
    const out = `${proc.stdout || ''}${proc.stderr || ''}`;
    const summary = (out.match(/Batch complete: .*/) || [''])[0];
    if (proc.status !== 0) {
      failedShards += 1;
      console.error(`[unity-cocos-port] shard ${i} thoát với mã ${proc.status}`);
      console.error(out.split(/\r?\n/).slice(-12).join('\n'));
    }
    log(`  shard ${i}: ${summary || 'không có tổng kết'}`);
    const m = /high=(\d+), medium=(\d+), low=(\d+)/.exec(summary || '');
    if (m) { totals.high += +m[1]; totals.medium += +m[2]; totals.low += +m[3]; }

    // Dry-run is strictly non-mutating: do not read/delete a stale shard report
    // and never synthesize a merged report from a previous run.
    if (!options.dryRun) {
      try {
        const text = fs.readFileSync(children[i].shardReport, 'utf8').split(/\r?\n/).filter(Boolean);
        if (text.length) mergedLines.push(...(mergedLines.length ? text.slice(1) : text));
        fs.unlinkSync(children[i].shardReport);
      } catch (_) { /* shard không tạo được report — đã báo ở trên */ }
    }
  }

  if (mergedLines.length) {
    ensureDir(path.dirname(reportBase));
    fs.writeFileSync(reportBase, mergedLines.join('\n') + '\n', 'utf8');
    log(`Report gộp: ${toPosix(path.relative(options.cocosRoot, reportBase))}`);
  }

  log(`Batch complete: ${plan.length} prefab(s) qua ${jobs} tiến trình, shard lỗi=${failedShards}, high=${totals.high}, medium=${totals.medium}, low=${totals.low}`);
  if (failedShards) process.exitCode = 1;
  return [];
}

function buildLayerResolver(options, cocosDb, reporter) {
  const unityLayerNames = getUnityLayerNames(options);

  return (unityLayer, source) => {
    const numericLayer = Number(unityLayer);
    if (!Number.isFinite(numericLayer) || numericLayer === 0) return COCOS_DEFAULT_LAYER_VALUE;

    const explicitMapping = getConfiguredLayerMapping(options.layerMap, numericLayer);
    const mapped = explicitMapping != null ? explicitMapping : unityLayerNames.get(numericLayer);
    if (mapped == null || String(mapped).trim() === '') {
      // Layer sai làm hỏng raycast + culling ở runtime -> `high`, không phải ghi chú.
      reporter.high('LAYER_UNMAPPED', source, '', `Unity layer ${numericLayer} has no Cocos mapping; using Cocos Default layer - raycast/culling co the sai. Khai bao anh xa bang --layer-map '{"${numericLayer}":"UI_2D"}'`);
      return COCOS_DEFAULT_LAYER_VALUE;
    }

    if (typeof mapped === 'number') return mapped || COCOS_DEFAULT_LAYER_VALUE;

    const syncedValue = ensureCocosCustomLayer(options, cocosDb, reporter, mapped, numericLayer, source);
    if (Number.isFinite(syncedValue)) return syncedValue;

    const existingValue = cocosDb.layerValue(mapped, NaN);
    if (Number.isFinite(existingValue)) return existingValue;

    reporter.medium(
      'LAYER_MISSING_IN_COCOS',
      source,
      String(mapped),
      `Cocos custom layer "${mapped}" could not be assigned because all custom layer bits 0..19 are already used; using Cocos Default layer`,
    );
    return COCOS_DEFAULT_LAYER_VALUE;
  };
}

function emitNodeRecursive(transform, parentNodeId, model, builder, layerResolver, reporter, options, unityDb, cocosDb, emissionContext = null) {
  const gameObject = model.gameObjects.get(transform.gameObjectId);
  if (!gameObject) {
    reporter.medium('TRANSFORM_WITHOUT_GAMEOBJECT', model.file, '', `Transform ${transform.fileId} has no GameObject; skipped`);
    return;
  }

  const parentTransform = transform.parentId ? model.transforms.get(transform.parentId) : null;
  const canvasRenderMode = unityCanvasRenderMode(gameObject, model);
  let resolvedTransform = resolveTransformLayout(transform, parentTransform, {
    preserveLocalPosition: canvasRenderMode === 2,
  });
  if (canvasRenderMode === 2) resolvedTransform.preserveWorldSpaceCanvasLocalZ = true;
  if (emissionContext?.rebaseNestedModelMountedChild) {
    resolvedTransform = rebaseNestedModelMountedChildTransform(resolvedTransform);
    reporter.low(
      'NESTED_MODEL_MOUNTED_CHILD_BASIS_REBASED',
      model.file,
      gameObject.name,
      'Immediate child mounted onto a linked Cocos model was rebased by the inverse FBX forward-axis basis so its authored world transform is preserved',
    );
  }
  if (transform.isRect) {
    if (!parentTransform) {
      const designResolution = getCocosDesignResolution(options);
      const anchorMin = transform.anchorMin || {};
      const anchorMax = transform.anchorMax || {};
      if (
        designResolution
        && Math.abs(finiteNumber(anchorMin.x, 0.5)) < 1e-6
        && Math.abs(finiteNumber(anchorMax.x, 0.5) - 1) < 1e-6
        && Math.abs(finiteNumber(transform.sizeDelta?.x, 0)) < 1e-6
      ) {
        resolvedTransform.sizeDelta.x = designResolution.x;
      }
      if (
        designResolution
        && Math.abs(finiteNumber(anchorMin.y, 0.5)) < 1e-6
        && Math.abs(finiteNumber(anchorMax.y, 0.5) - 1) < 1e-6
        && Math.abs(finiteNumber(transform.sizeDelta?.y, 0)) < 1e-6
      ) {
        resolvedTransform.sizeDelta.y = designResolution.y;
      }
    }
    const inferredSize = inferRectSizeFromHierarchy(transform, model);
    if (inferredSize) {
      if (finiteNumber(resolvedTransform.sizeDelta?.x, 0) <= 0 && inferredSize.x > 0) {
        resolvedTransform.sizeDelta.x = inferredSize.x;
      }
      if (finiteNumber(resolvedTransform.sizeDelta?.y, 0) <= 0 && inferredSize.y > 0) {
        resolvedTransform.sizeDelta.y = inferredSize.y;
      }
    }
  }
  transform.resolvedLayout = {
    size: resolvedTransform.sizeDelta,
    anchor: resolvedTransform.anchor,
  };

  const layerValue = layerResolver(gameObject.layer, gameObject.name);
  const flattenParticleOverrides = nestedPrefabNeedsParticleOverrideFlattening(gameObject.nestedPrefab);
  if ((parentNodeId == null || flattenParticleOverrides) && gameObject.nestedPrefab?.model) {
    const nestedOptions = {
      ...options,
      src: gameObject.nestedPrefab.sourceAsset?.path || options.src,
      out: gameObject.nestedPrefab.outputFile || options.out,
    };
    const { builder: nestedBuilder } = buildCocosPrefabBuilder(
      gameObject.nestedPrefab.model,
      gameObject.nestedPrefab.outputFile || options.out,
      nestedOptions,
      reporter,
      unityDb,
      cocosDb,
    );
    if (flattenParticleOverrides) {
      applyNestedParticlePrefabOverrides(
        nestedBuilder,
        gameObject.nestedPrefab,
        reporter,
        nestedOptions,
        unityDb,
        cocosDb,
      );
    }
    const flattened = builder.clonePrefabTree(nestedBuilder.objects, parentNodeId);
    if (flattened?.rootId != null) {
      for (const [unityComponentId, nestedComponentId] of nestedBuilder.componentMap.entries()) {
        const componentId = flattened.idMap.get(nestedComponentId);
        if (Number.isInteger(componentId)) builder.componentMap.set(unityComponentId, componentId);
      }
      for (const [unityComponentId, componentDoc] of model.componentDocs.entries()) {
        if (!componentDoc?.stripped) continue;
        if (
          unityRefFileId(getField(componentDoc, 'm_PrefabInstance'))
          !== gameObject.nestedPrefab.overrideInfo?.fileId
        ) {
          continue;
        }
        const sourceComponentId = unityRefFileId(
          getField(componentDoc, 'm_CorrespondingSourceObject'),
        );
        const nestedComponentId = nestedBuilder.componentMap.get(sourceComponentId);
        const componentId = flattened.idMap.get(nestedComponentId);
        if (Number.isInteger(componentId)) builder.componentMap.set(unityComponentId, componentId);
      }
      const node = builder.objects[flattened.rootId];
      node._name = gameObject.name;
      node._active = gameObject.active;
      node._lpos = convertNodePosition(resolvedTransform);
      node._lrot = convertRotation(resolvedTransform.localRotation || transform?.localRotation);
      node._lscale = convertScale(resolvedTransform.localScale || transform?.localScale);
      node._layer = layerValue;
      node._euler = convertTransformEuler({
        localRotation: resolvedTransform.localRotation || transform?.localRotation,
        euler: resolvedTransform.euler || transform?.euler,
      });

      reporter.low(
        flattenParticleOverrides
          ? 'NESTED_PARTICLE_PREFAB_FLATTENED'
          : 'ROOT_NESTED_PREFAB_FLATTENED',
        model.file,
        gameObject.name,
        flattenParticleOverrides
          ? 'Nested Unity particle prefab was flattened so all authored component overrides and removals are preserved'
          : 'Top-level nested Unity prefab was flattened into local Cocos nodes so the full hierarchy stays visible in Creator',
        gameObject.nestedPrefab.sourceAsset?.relativePath || gameObject.nestedPrefab.outputFile || gameObject.nestedPrefab.rootName || ''
      );

      builder.nodeMapByGameObject.set(gameObject.fileId, flattened.rootId);
      builder.nodeMapByTransform.set(transform.fileId, flattened.rootId);
      for (const childId of transform.children) {
        const child = model.transforms.get(childId);
        if (!child) {
          reporter.medium('MISSING_CHILD_TRANSFORM', model.file, gameObject.name, `Child transform ${childId} is missing`);
          continue;
        }
        emitNodeRecursive(child, flattened.rootId, model, builder, layerResolver, reporter, options, unityDb, cocosDb);
      }
      return;
    }
  }

  if (gameObject.nestedPrefab?.prefabUuid && gameObject.nestedPrefab?.rootLocalId) {
    const nestedOverrides = buildNestedPrefabPropertyOverrides(gameObject, resolvedTransform, gameObject.nestedPrefab.model);
    const nodeId = builder.addNestedPrefabInstance(
      gameObject.name,
      parentNodeId,
      resolvedTransform,
      layerValue,
      gameObject.active,
      gameObject.nestedPrefab.prefabUuid,
      gameObject.nestedPrefab.rootLocalId,
      nestedOverrides,
    );
    builder.nodeMapByGameObject.set(gameObject.fileId, nodeId);
    builder.nodeMapByTransform.set(transform.fileId, nodeId);
    for (const childId of transform.children) {
      const child = model.transforms.get(childId);
      if (!child) {
        reporter.medium('MISSING_CHILD_TRANSFORM', model.file, gameObject.name, `Child transform ${childId} is missing`);
        continue;
      }
      emitNodeRecursive(child, nodeId, model, builder, layerResolver, reporter, options, unityDb, cocosDb);
    }
    return;
  }

  if (gameObject.syntheticModelAsset) {
    const modelPrefab = cocosDb.resolveModelPrefabByStem(
      gameObject.syntheticModelAsset.stem,
      gameObject.syntheticModelAsset.relativePath,
    );
    // A generated prefab cannot have a cc.PrefabInstance as its own root: its
    // `prefabRootNode` would have to point at itself, which Cocos reports as
    // "prefab instance root node has loop". Unity prefabs that are nothing but a
    // model instance (a rename plus a transform) therefore get the model flattened
    // into a plain root node instead of a linked instance.
    if (parentNodeId == null && modelPrefab?.prefabUuid) {
      reporter.low(
        'ROOT_MODEL_INSTANCE_FLATTENED',
        gameObject.syntheticModelAsset.relativePath,
        gameObject.name,
        'Unity prefab root is a bare model instance; the model was flattened into the prefab root because a Cocos prefab root cannot be a prefab instance',
      );
    }
    if (parentNodeId != null && modelPrefab?.prefabUuid && modelPrefab?.rootLocalId) {
      const sourceModelFile = gameObject.syntheticModelAsset.path;
      const linkedModelFile = modelPrefab.assetPath;
      if (
        options.copyAssets
        && !options.dryRun
        && sourceModelFile
        && linkedModelFile
        && path.resolve(sourceModelFile) !== path.resolve(linkedModelFile)
        && path.extname(sourceModelFile).toLowerCase() === path.extname(linkedModelFile).toLowerCase()
      ) {
        const sourceBytes = fs.readFileSync(sourceModelFile);
        const linkedBytes = fs.existsSync(linkedModelFile) ? fs.readFileSync(linkedModelFile) : null;
        if (!linkedBytes || !sourceBytes.equals(linkedBytes)) {
          fs.copyFileSync(sourceModelFile, linkedModelFile);
          reporter.low(
            'NESTED_MODEL_SOURCE_REFRESHED',
            gameObject.syntheticModelAsset.relativePath,
            gameObject.name,
            'Existing imported Cocos model source was refreshed in place so its stable UUID and prefab references are preserved',
            modelPrefab.source,
          );
        }
      }
      const materialOverrides = [];
      const remaps = gameObject.syntheticModelExternalMaterialRemaps || [];
      const explicitMaterialAssets = (gameObject.syntheticModelMaterialOverrideGroups || [])
        .flatMap((group) => group.materialAssets || [])
        .filter(Boolean);
      const shadowOverrideRenderers = new Set();
      for (const slot of modelPrefab.materialSlots || []) {
        if (!shadowOverrideRenderers.has(slot.rendererLocalId)) {
          shadowOverrideRenderers.add(slot.rendererLocalId);
          materialOverrides.push({
            localId: slot.rendererLocalId,
            propertyPath: '_shadowCastingMode',
            value: 1,
          }, {
            localId: slot.rendererLocalId,
            propertyPath: '_shadowReceivingMode',
            value: 1,
          });
        }
        const normalizedSlotName = normalizeKey(slot.materialName);
        const explicitMaterialAsset = explicitMaterialAssets[slot.slot]
          || (explicitMaterialAssets.length === 1 ? explicitMaterialAssets[0] : null);
        const remap = explicitMaterialAsset
          ? { materialAsset: explicitMaterialAsset }
          : remaps.find((entry) => normalizeKey(entry.name) === normalizedSlotName)
          || (remaps.length === 1 && modelPrefab.materialSlots.length === 1 ? remaps[0] : null);
        if (!remap) continue;
        const materialUuid = resolveUnityMaterialUuid(
          remap.materialAsset,
          options,
          unityDb,
          cocosDb,
          reporter,
          gameObject.name,
        );
        if (!materialUuid) continue;
        materialOverrides.push({
          localId: slot.rendererLocalId,
          propertyPath: ['_materials', String(slot.slot)],
          value: cocosUuid(materialUuid, 'cc.Material'),
        });
        reporter.low(
          'NESTED_MODEL_MATERIAL_OVERRIDE_WIRED',
          remap.materialAsset.relativePath,
          `${gameObject.name}/${slot.materialName || `material-${slot.slot}`}`,
          'Unity FBX external material remap was converted and wired to the imported Cocos model renderer',
          materialUuid,
        );
      }
      const nodeId = builder.addNestedPrefabInstance(
        gameObject.name,
        parentNodeId,
        correctNestedModelForwardAxis(resolvedTransform),
        layerValue,
        gameObject.active,
        modelPrefab.prefabUuid,
        modelPrefab.rootLocalId,
        materialOverrides,
      );
      builder.nodeMapByGameObject.set(gameObject.fileId, nodeId);
      builder.nodeMapByTransform.set(transform.fileId, nodeId);
      gameObject.syntheticModelPrefabLinked = true;
      reporter.low(
        'NESTED_MODEL_PREFAB_LINKED',
        gameObject.syntheticModelAsset.relativePath,
        gameObject.name,
        'Imported Cocos model prefab was linked so skeletal animation, skinned meshes, and the full rig hierarchy are preserved',
        modelPrefab.source,
      );
      reporter.low(
        'NESTED_MODEL_FORWARD_AXIS_CORRECTED',
        gameObject.syntheticModelAsset.relativePath,
        gameObject.name,
        'Linked model root received the Unity-to-Cocos FBX forward-axis basis; immediate mounted children are inversely rebased',
      );
      for (const childId of transform.children) {
        const child = model.transforms.get(childId);
        if (!child) {
          reporter.medium('MISSING_CHILD_TRANSFORM', model.file, gameObject.name, `Child transform ${childId} is missing`);
          continue;
        }
        emitNodeRecursive(child, nodeId, model, builder, layerResolver, reporter, options, unityDb, cocosDb, {
          rebaseNestedModelMountedChild: true,
        });
      }
      return;
    }
  }

  const nodeTransform = gameObjectHasWorldScaledParticleSystem(gameObject, model)
    ? compensateParentScale(transform, resolvedTransform, model)
    : resolvedTransform;
  if (nodeTransform !== resolvedTransform) {
    reporter.low(
      'PARTICLE_WORLD_SCALE_PARENT_COMPENSATED',
      model.file,
      gameObject.name,
      'Unity ParticleSystem scale is represented as Cocos Scale Space World; Cocos node scale was parent-compensated so world scale matches Unity without baking particle size or speed'
    );
  }

  const nodeId = builder.addNode(
    gameObject.name,
    parentNodeId,
    nodeTransform,
    layerValue,
    gameObject.active,
    `node-${sanitizeFileId(gameObject.name)}-${transform.fileId}`
  );
  builder.nodeMapByGameObject.set(gameObject.fileId, nodeId);
  builder.nodeMapByTransform.set(transform.fileId, nodeId);

  if (transform.isRect && !gameObjectHasParticleSystem(gameObject, model)) {
    builder.addUiTransform(
      nodeId,
      transform.fileId,
      Number(resolvedTransform.sizeDelta?.x ?? 100),
      Number(resolvedTransform.sizeDelta?.y ?? 100),
      resolvedTransform.anchor,
      `cmp-ui-transform-${transform.fileId}`
    );
    const anchorMin = transform.anchorMin || {};
    const anchorMax = transform.anchorMax || {};
    const anchoredPosition = transform.anchoredPosition || {};
    const sizeDelta = transform.sizeDelta || {};
    const isFullStretch = Math.abs(finiteNumber(anchorMin.x, 0.5)) < 1e-6
      && Math.abs(finiteNumber(anchorMin.y, 0.5)) < 1e-6
      && Math.abs(finiteNumber(anchorMax.x, 0.5) - 1) < 1e-6
      && Math.abs(finiteNumber(anchorMax.y, 0.5) - 1) < 1e-6
      && Math.abs(finiteNumber(anchoredPosition.x, 0)) < 1e-6
      && Math.abs(finiteNumber(anchoredPosition.y, 0)) < 1e-6
      && Math.abs(finiteNumber(sizeDelta.x, 0)) < 1e-6
      && Math.abs(finiteNumber(sizeDelta.y, 0)) < 1e-6;
    if (isFullStretch) builder.addFullStretchWidget(nodeId, `cmp-widget-${transform.fileId}`);
  }

  for (const childId of transform.children) {
    const child = model.transforms.get(childId);
    if (!child) {
      reporter.medium('MISSING_CHILD_TRANSFORM', model.file, gameObject.name, `Child transform ${childId} is missing`);
      continue;
    }
    emitNodeRecursive(child, nodeId, model, builder, layerResolver, reporter, options, unityDb, cocosDb);
  }
}

function gameObjectHasParticleSystem(gameObject, model) {
  return (gameObject.components || []).some((componentId) => {
    const doc = model.componentDocs.get(componentId);
    const classId = Number(doc?.classId || 0);
    return classId === 198 || classId === 223;
  });
}

function gameObjectHasWorldScaledParticleSystem(gameObject, model) {
  return (gameObject.components || []).some((componentId) => {
    const doc = model.componentDocs.get(componentId);
    const classId = Number(doc?.classId || 0);
    return (classId === 198 || classId === 223) && Number(getField(doc, 'scalingMode', 0) || 0) === 1;
  });
}

function transformParentWorldScale(transform, transforms) {
  const scale = { x: 1, y: 1, z: 1 };
  let parent = transform?.parentId ? transforms.get(transform.parentId) : null;
  const visited = new Set();
  while (parent && !visited.has(parent.fileId)) {
    visited.add(parent.fileId);
    const localScale = parent.localScale || { x: 1, y: 1, z: 1 };
    scale.x *= Number(localScale.x == null ? 1 : localScale.x);
    scale.y *= Number(localScale.y == null ? 1 : localScale.y);
    scale.z *= Number(localScale.z == null ? 1 : localScale.z);
    parent = parent.parentId ? transforms.get(parent.parentId) : null;
  }
  return scale;
}

function compensateParentScale(transform, resolvedTransform, model) {
  const parentScale = transformParentWorldScale(transform, model.transforms);
  if (
    Math.abs(parentScale.x - 1) <= 1e-6
    && Math.abs(parentScale.y - 1) <= 1e-6
    && Math.abs(parentScale.z - 1) <= 1e-6
  ) {
    return resolvedTransform;
  }

  const localScale = resolvedTransform.localScale || transform?.localScale || { x: 1, y: 1, z: 1 };
  const divide = (value, divisor) => {
    const n = Number(value == null ? 1 : value);
    const d = Number(divisor == null ? 1 : divisor);
    return Math.abs(d) > 1e-6 ? n / d : n;
  };

  return {
    ...resolvedTransform,
    localScale: {
      x: divide(localScale.x, parentScale.x),
      y: divide(localScale.y, parentScale.y),
      z: divide(localScale.z, parentScale.z),
    },
  };
}

function emitComponents(model, builder, reporter, options, unityDb, cocosDb) {
  return componentDispatcher.emitComponents(model, builder, reporter, options, unityDb, cocosDb);
}

function emitSyntheticModelRenderer(gameObject, nodeId, builder, reporter, options, unityDb, cocosDb) {
  return emitSyntheticModelRendererImpl(gameObject, nodeId, builder, reporter, options, unityDb, cocosDb);
}

function emitParticleSystem(nodeId, componentId, doc, gameObject, builder, reporter, options, unityDb, cocosDb, rendererDoc = null) {
  return emitParticleSystemImpl(nodeId, componentId, doc, gameObject, builder, reporter, options, unityDb, cocosDb, rendererDoc);
}

function emitMeshRenderer(gameObject, nodeId, componentId, doc, model, builder, reporter, options, unityDb, cocosDb) {
  return emitMeshRendererImpl(gameObject, nodeId, componentId, doc, model, builder, reporter, options, unityDb, cocosDb);
}

function emitMeshCollider(nodeId, componentId, doc, gameObject, model, builder, reporter, options, unityDb, cocosDb) {
  return emitMeshColliderImpl(nodeId, componentId, doc, gameObject, model, builder, reporter, options, unityDb, cocosDb);
}

function handleMissingModel(meshAsset, reporter, options, config = {}) {
  return handleMissingModelImpl(meshAsset, reporter, options, config);
}

function copyUnityAssetToCocos(unityAsset, options, reporter, kind, severity = 'medium', config = {}) {
  return copyUnityAssetToCocosImpl(unityAsset, options, reporter, kind, severity, config);
}

function importedUnityAssetPath(unityAsset, options) {
  return importedUnityAssetPathImpl(unityAsset, options);
}

function convertFbxToGlb(unityAsset, converter, options, reporter, severity = 'medium') {
  return convertFbxToGlbImpl(unityAsset, converter, options, reporter, severity);
}

function ensureAssetMeta(assetFile, kind, config = {}) {
  return ensureAssetMetaImpl(assetFile, kind, config);
}

function findCommand(names) {
  return findCommandImpl(names);
}

function emitSpriteRenderer(nodeId, componentId, doc, builder, reporter, options, unityDb, cocosDb) {
  emitSpriteRendererImpl(nodeId, componentId, doc, builder, reporter, options, unityDb, cocosDb);
  const spriteRendererId = builder.componentMap.get(componentId);
  if (spriteRendererId != null) {
    const materialRef = getNestedList(doc, 'm_Materials')[0] || null;
    const materialAsset = unityDb.get(unityRefGuid(materialRef));
    const spriteAsset = unityDb.get(unityRefGuid(getField(doc, 'm_Sprite')));
    const opaque = /opaque/i.test(materialAsset?.stem || '');
    const glow = /glow/i.test(spriteAsset?.stem || '');
    runtimeComponentPorter.attachUnitySpriteRendererColorAdapter(
      nodeId,
      componentId,
      spriteRendererId,
      builder,
      reporter,
      opaque,
      glow,
    );
  }
  return spriteRendererId;
}

function emitLight(nodeId, componentId, doc, builder, reporter) {
  return emitLightImpl(nodeId, componentId, doc, builder, reporter);
}

function emitCanvas(nodeId, componentId, doc, gameObject, model, builder, reporter) {
  const renderMode = Number(getField(doc, 'm_RenderMode', 0) || 0);
  if (renderMode === 2) {
    const result = builder.addRenderRoot2D(nodeId, componentId, `cmp-render-root-2d-${componentId}`);
    reporter.low(
      'WORLD_SPACE_CANVAS_PORTED',
      model.file,
      gameObject.name,
      'Unity World Space Canvas was mapped to cc.RenderRoot2D, keeping its authored 3D transform and local UI-plane depth',
    );
    return result;
  }
  reporter.medium(
    'CANVAS_NOT_PORTED',
    model.file,
    gameObject.name,
    `Unity Canvas render mode ${renderMode} needs an explicit Cocos UI camera/alignment decision`,
    'Use a project Canvas for screen-space UI; only Unity World Space Canvas is mapped automatically to cc.RenderRoot2D.',
  );
  return null;
}

function unityRigidBody2DTypeToCocosType(unityBodyType) {
  const value = Number(unityBodyType || 0);
  if (value === 2) return 2; // STATIC
  if (value === 1) return 4; // KINEMATIC
  return 1; // DYNAMIC
}

function emitRigidbody2D(nodeId, componentId, doc, gameObject, model, builder, reporter) {
  return emitRigidbody2DImpl(nodeId, componentId, doc, gameObject, model, builder, reporter);
}

function emitCircleCollider2D(nodeId, componentId, doc, gameObject, model, builder, reporter) {
  return emitCircleCollider2DImpl(nodeId, componentId, doc, gameObject, model, builder, reporter);
}

function emitCapsuleCollider2D(nodeId, componentId, doc, gameObject, model, builder, reporter) {
  return emitCapsuleCollider2DImpl(nodeId, componentId, doc, gameObject, model, builder, reporter);
}

function emitEdgeCollider2D(nodeId, componentId, doc, gameObject, model, builder, reporter) {
  return emitEdgeCollider2DImpl(nodeId, componentId, doc, gameObject, model, builder, reporter);
}

function emitBoxCollider2D(nodeId, componentId, doc, gameObject, model, builder, reporter) {
  return emitBoxCollider2DImpl(nodeId, componentId, doc, gameObject, model, builder, reporter);
}

function emitBoxCollider(nodeId, componentId, doc, gameObject, model, builder, reporter, options, unityDb) {
  return emitBoxColliderImpl(nodeId, componentId, doc, gameObject, model, builder, reporter, options, unityDb);
}

function emitRigidbody(nodeId, componentId, doc, builder) {
  return emitRigidbodyImpl(nodeId, componentId, doc, builder);
}

function emitCharacterController(nodeId, componentId, doc, gameObject, model, builder) {
  return emitCharacterControllerImpl(nodeId, componentId, doc, gameObject, model, builder);
}

function emitSphereCollider(nodeId, componentId, doc, gameObject, model, builder, reporter, options, unityDb) {
  return emitSphereColliderImpl(nodeId, componentId, doc, gameObject, model, builder, reporter, options, unityDb);
}

function emitCapsuleCollider(nodeId, componentId, doc, gameObject, model, builder, reporter, options, unityDb) {
  return emitCapsuleColliderImpl(nodeId, componentId, doc, gameObject, model, builder, reporter, options, unityDb);
}

function emitPolygonCollider2D(nodeId, componentId, doc, gameObject, model, builder, reporter) {
  return emitPolygonCollider2DImpl(nodeId, componentId, doc, gameObject, model, builder, reporter);
}

function emitHingeJoint(nodeId, componentId, doc, gameObject, model, builder) {
  return emitHingeJointImpl(nodeId, componentId, doc, gameObject, model, builder);
}

function emitFixedJoint(nodeId, componentId, doc, gameObject, model, builder) {
  return emitFixedJointImpl(nodeId, componentId, doc, gameObject, model, builder);
}

function emitSpringJoint(nodeId, componentId, doc, gameObject, model, builder) {
  return emitSpringJointImpl(nodeId, componentId, doc, gameObject, model, builder);
}

function unityNumber(value, fallback = 0) {
  const text = String(value ?? '').trim();
  if (/^-?Infinity$/i.test(text)) return text.startsWith('-') ? -Infinity : Infinity;
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getIndentedBlock(doc, key) {
  const pattern = new RegExp(`^(\\s*)${escapeRegex(key)}\\s*:\\s*(.*)$`);
  for (let i = 0; i < doc.lines.length; i++) {
    const match = pattern.exec(doc.lines[i]);
    if (!match) continue;
    if (match[2].trim() === '[]') return [];
    const baseIndent = match[1].length;
    const block = [];
    for (let j = i + 1; j < doc.lines.length; j++) {
      const line = doc.lines[j];
      if (!line.trim()) continue;
      const indent = line.match(/^\s*/)[0].length;
      const trimmed = line.trim();
      if (indent < baseIndent) break;
      if (indent === baseIndent && !trimmed.startsWith('- ')) break;
      block.push(line);
    }
    return block;
  }
  return [];
}

function readUnityFieldFromLines(lines, key, fallback = '') {
  const pattern = new RegExp(`^\\s*(?:-\\s*)?${escapeRegex(key)}\\s*:\\s*(.*)$`);
  const line = lines.find((item) => pattern.test(item));
  if (!line) return fallback;
  const match = pattern.exec(line);
  return match ? parseUnityScalar(match[1]) : fallback;
}

function splitUnityListEntries(lines) {
  const firstItem = lines.find((line) => /^\s*-\s+/.test(line));
  if (!firstItem) return [];
  const itemIndent = firstItem.match(/^\s*/)[0].length;
  const entries = [];
  let current = null;
  for (const line of lines) {
    if (new RegExp(`^\\s{${itemIndent}}-\\s+`).test(line)) {
      if (current) entries.push(current);
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) entries.push(current);
  return entries;
}

function parseUnityCurveKeyframes(entryLines) {
  const keyframes = [];
  for (let i = 0; i < entryLines.length; i++) {
    const timeMatch = /^\s*time:\s*(.*)$/.exec(entryLines[i]);
    if (!timeMatch) continue;
    let value = null;
    for (let j = i + 1; j < entryLines.length; j++) {
      if (/^\s*time:\s*/.test(entryLines[j])) break;
      const valueMatch = /^\s*value:\s*(.*)$/.exec(entryLines[j]);
      if (valueMatch) {
        value = parseUnityScalar(valueMatch[1]);
        break;
      }
    }
    if (value != null) keyframes.push({ time: unityNumber(timeMatch[1]), value });
  }
  return keyframes;
}

function parseUnityVectorCurveEntries(doc, key) {
  const entries = [];
  for (const entryLines of splitUnityListEntries(getIndentedBlock(doc, key))) {
    const pathValue = String(readUnityFieldFromLines(entryLines, 'path', ''));
    const keyframes = parseUnityCurveKeyframes(entryLines)
      .filter((keyframe) => keyframe.value && typeof keyframe.value === 'object');
    if (keyframes.length) entries.push({ path: pathValue, keyframes });
  }
  return entries;
}

function parseUnityFloatCurveEntries(doc, key) {
  const entries = [];
  for (const entryLines of splitUnityListEntries(getIndentedBlock(doc, key))) {
    const attribute = String(readUnityFieldFromLines(entryLines, 'attribute', ''));
    const pathValue = String(readUnityFieldFromLines(entryLines, 'path', ''));
    const classId = Number(readUnityFieldFromLines(entryLines, 'classID', 0) || 0);
    const keyframes = parseUnityCurveKeyframes(entryLines)
      .filter((keyframe) => typeof keyframe.value === 'number');
    if (keyframes.length) entries.push({ attribute, path: pathValue, classId, keyframes });
  }
  return entries;
}

function unityClipSettingsValue(doc, key, fallback = 0) {
  const settings = getIndentedBlock(doc, 'm_AnimationClipSettings');
  for (const line of settings) {
    const match = new RegExp(`^\\s*${escapeRegex(key)}\\s*:\\s*(.*)$`).exec(line);
    if (match) return parseUnityScalar(match[1]);
  }
  return fallback;
}

function cocosRealKeyframeValue(value) {
  return { __type__: 'cc.RealKeyframeValue', value: finiteNumber(value) };
}

function cocosRealCurve(times, values) {
  return {
    __type__: 'cc.RealCurve',
    _times: times.map((time) => finiteNumber(time)),
    _values: values.map(cocosRealKeyframeValue),
    preExtrapolation: 1,
    postExtrapolation: 1,
  };
}

function cocosChannel(times, values) {
  return {
    __type__: 'cc.animation.Channel',
    _curve: cocosRealCurve(times, values),
  };
}

function cocosTrackPathForUnityPath(unityPath, property, component = '') {
  const paths = [];
  for (const segment of String(unityPath || '').split('/').filter(Boolean)) {
    paths.push({ __type__: 'cc.animation.HierarchyPath', path: segment });
  }
  if (component) paths.push({ __type__: 'cc.animation.ComponentPath', component });
  paths.push(property);
  return { __type__: 'cc.animation.TrackPath', _paths: paths };
}

function convertUnityAnimationVectorValue(property, value) {
  const x = finiteNumber(value?.x);
  const y = finiteNumber(value?.y);
  const z = finiteNumber(value?.z);
  if (property === 'position') return { x, y, z: -z };
  if (property === 'eulerAngles') return { x: -x, y, z };
  return { x, y, z };
}

function cocosVectorTrack(unityPath, property, keyframes) {
  const times = keyframes.map((keyframe) => keyframe.time);
  const values = keyframes.map((keyframe) => convertUnityAnimationVectorValue(property, keyframe.value));
  return {
    __type__: 'cc.animation.VectorTrack',
    _binding: {
      __type__: 'cc.animation.TrackBinding',
      path: cocosTrackPathForUnityPath(unityPath, property),
    },
    _channels: [
      cocosChannel(times, values.map((value) => value.x)),
      cocosChannel(times, values.map((value) => value.y)),
      cocosChannel(times, values.map((value) => value.z)),
      cocosChannel([], []),
    ],
    _nComponents: 3,
  };
}

function cocosColorTrack(unityPath, component, property, keyedChannels) {
  const colorChannelValue = (value) => Math.max(0, Math.min(255, Math.round(finiteNumber(value) * 255)));
  const channel = (name) => {
    const keyframes = keyedChannels[name] || [];
    return cocosChannel(
      keyframes.map((keyframe) => keyframe.time),
      keyframes.map((keyframe) => colorChannelValue(keyframe.value))
    );
  };
  return {
    __type__: 'cc.animation.ColorTrack',
    _binding: {
      __type__: 'cc.animation.TrackBinding',
      path: cocosTrackPathForUnityPath(unityPath, property, component),
    },
    _channels: [
      channel('r'),
      channel('g'),
      channel('b'),
      channel('a'),
    ],
  };
}

function unityRendererComponentForColorCurve(classId) {
  if (Number(classId) === 212) return 'cc.SpriteRenderer';
  return '';
}

function unityColorCurveChannel(attribute) {
  const match = /^m_Color\.([rgba])$/.exec(String(attribute || ''));
  return match ? match[1] : '';
}

function parseUnityAnimationClip(file, reporter) {
  const docs = parseUnityYaml(file);
  const doc = docs.find((item) => item.classId === 74) || docs[0];
  if (!doc) return null;
  const name = String(getField(doc, 'm_Name', path.basename(file, '.anim')) || path.basename(file, '.anim'));
  const sample = Number(getField(doc, 'm_SampleRate', 60) || 60);
  const stopTime = Number(unityClipSettingsValue(doc, 'm_StopTime', 0) || 0);
  const loopTime = Number(unityClipSettingsValue(doc, 'm_LoopTime', 0) || 0);
  const tracks = [];

  for (const entry of parseUnityVectorCurveEntries(doc, 'm_PositionCurves')) {
    tracks.push(cocosVectorTrack(entry.path, 'position', entry.keyframes));
  }
  for (const entry of parseUnityVectorCurveEntries(doc, 'm_ScaleCurves')) {
    tracks.push(cocosVectorTrack(entry.path, 'scale', entry.keyframes));
  }
  for (const entry of parseUnityVectorCurveEntries(doc, 'm_EulerCurves')) {
    tracks.push(cocosVectorTrack(entry.path, 'eulerAngles', entry.keyframes));
  }

  const colorCurveGroups = new Map();
  for (const entry of parseUnityFloatCurveEntries(doc, 'm_FloatCurves')) {
    const channel = unityColorCurveChannel(entry.attribute);
    const component = unityRendererComponentForColorCurve(entry.classId);
    if (!channel || !component) {
      reporter.low('ANIMATION_FLOAT_CURVE_SKIPPED', file, entry.path, `Unity float curve "${entry.attribute}" is not mapped to a Cocos track yet`);
      continue;
    }
    const key = `${entry.path}\0${component}\0_color`;
    if (!colorCurveGroups.has(key)) {
      colorCurveGroups.set(key, { path: entry.path, component, property: '_color', channels: {} });
    }
    colorCurveGroups.get(key).channels[channel] = entry.keyframes;
  }
  for (const group of colorCurveGroups.values()) {
    tracks.push(cocosColorTrack(group.path, group.component, group.property, group.channels));
  }

  const rotationCurves = getIndentedBlock(doc, 'm_RotationCurves');
  if (rotationCurves.length) {
    reporter.low('ANIMATION_ROTATION_CURVE_SKIPPED', file, name, 'Unity quaternion rotation curves are not mapped yet');
  }

  let duration = stopTime;
  for (const track of tracks) {
    for (const channel of track._channels || []) {
      for (const time of channel._curve?._times || []) duration = Math.max(duration, Number(time) || 0);
    }
  }

  return {
    __type__: 'cc.AnimationClip',
    _name: name,
    _objFlags: 0,
    _native: '',
    sample,
    speed: 1,
    wrapMode: loopTime ? 2 : 1,
    enableTrsBlending: false,
    _duration: duration,
    _hash: 0,
    _tracks: tracks,
    _events: [],
  };
}

function ensureAnimationClipMeta(file, name, uuid) {
  const metaFile = `${file}.meta`;
  const existing = readJsonIfExists(metaFile) || {};
  const meta = {
    ver: existing.ver || '2.0.4',
    importer: 'animation-clip',
    imported: true,
    uuid: existing.uuid || uuid || stableUuid(`animation-clip:${file}`),
    files: Array.isArray(existing.files) && existing.files.length ? existing.files : ['.bin'],
    subMetas: existing.subMetas || {},
    userData: { ...(existing.userData || {}), name },
  };
  fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return meta;
}

function ensureAnimationGraphMeta(file, uuid) {
  const metaFile = `${file}.meta`;
  const existing = readJsonIfExists(metaFile) || {};
  const meta = {
    ver: existing.ver || '1.2.0',
    importer: 'animation-graph',
    imported: true,
    uuid: existing.uuid || uuid || stableUuid(`animation-graph:${file}`),
    files: Array.isArray(existing.files) && existing.files.length ? existing.files : ['.json'],
    subMetas: existing.subMetas || {},
    userData: existing.userData || {},
  };
  fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return meta;
}

function animationOutputDirForController(options, controllerAsset) {
  return path.join(options.cocosRoot, 'assets', 'animations', sanitizeFileId(controllerAsset.stem).toLowerCase());
}

function writeConvertedAnimationClip(clipAsset, outDir, options, reporter) {
  const clip = parseUnityAnimationClip(clipAsset.path, reporter);
  if (!clip) {
    reporter.medium('ANIMATION_CLIP_PARSE_FAILED', clipAsset.relativePath, '', 'Unity animation clip could not be parsed');
    return '';
  }

  const fileName = `${sanitizeAssetDisplayName(clip._name, clipAsset.stem)}.anim`;
  const outFile = path.join(outDir, fileName);
  let uuid = stableUuid(`unity-animation-clip:${clipAsset.guid}`);
  if (!options.dryRun) {
    fs.writeFileSync(outFile, `${JSON.stringify(clip, null, 2)}\n`, 'utf8');
    uuid = ensureAnimationClipMeta(outFile, clip._name, uuid).uuid;
  }
  reporter.low('ANIMATION_CLIP_CONVERTED', clipAsset.relativePath, toPosix(path.relative(options.cocosRoot, outFile)), 'Unity AnimationClip converted to Cocos AnimationClip');
  return { uuid, name: clip._name };
}

function parseAnimatorParameters(doc) {
  const entries = splitUnityListEntries(getIndentedBlock(doc, 'm_AnimatorParameters'));
  return entries.map((lines) => {
    return {
      name: String(readUnityFieldFromLines(lines, 'm_Name', '')),
      type: Number(readUnityFieldFromLines(lines, 'm_Type', 9) || 9),
      defaultBool: Number(readUnityFieldFromLines(lines, 'm_DefaultBool', 0) || 0),
      defaultFloat: Number(readUnityFieldFromLines(lines, 'm_DefaultFloat', 0) || 0),
      defaultInt: Number(readUnityFieldFromLines(lines, 'm_DefaultInt', 0) || 0),
    };
  }).filter((param) => param.name);
}

function parseAnimatorTransitionConditions(doc) {
  return splitUnityListEntries(getIndentedBlock(doc, 'm_Conditions')).map((lines) => {
    return {
      event: String(readUnityFieldFromLines(lines, 'm_ConditionEvent', '')),
      mode: Number(readUnityFieldFromLines(lines, 'm_ConditionMode', 0) || 0),
      threshold: Number(readUnityFieldFromLines(lines, 'm_EventTreshold', 0) || 0),
    };
  }).filter((condition) => condition.event);
}

function parseUnityAnimatorController(file, unityDb, reporter, options) {
  const docs = parseUnityYaml(file);
  const controllerDoc = docs.find((doc) => doc.classId === 91);
  const stateMachineDoc = docs.find((doc) => doc.classId === 1107);
  const controllerName = String(getField(controllerDoc || { lines: [] }, 'm_Name', path.basename(file, '.controller')));
  const states = new Map();
  const transitions = new Map();

  for (const doc of docs) {
    if (doc.classId === 1102) {
      const motionRef = getField(doc, 'm_Motion');
      states.set(doc.fileId, {
        fileId: doc.fileId,
        name: String(getField(doc, 'm_Name', 'State')),
        motionGuid: unityRefGuid(motionRef),
        transitionIds: getNestedList(doc, 'm_Transitions').map(unityRefFileId).filter(Boolean),
      });
    } else if (doc.classId === 1101) {
      transitions.set(doc.fileId, {
        fileId: doc.fileId,
        dstStateId: unityRefFileId(getField(doc, 'm_DstState')),
        dstStateMachineId: unityRefFileId(getField(doc, 'm_DstStateMachine')),
        duration: finiteNumber(getField(doc, 'm_TransitionDuration', 0), 0),
        exitTime: finiteNumber(getField(doc, 'm_ExitTime', 1), 1),
        hasExitTime: Number(getField(doc, 'm_HasExitTime', 0) || 0) !== 0,
        conditions: parseAnimatorTransitionConditions(doc),
      });
    }
  }

  const childStateIds = stateMachineDoc
    ? splitUnityListEntries(getIndentedBlock(stateMachineDoc, 'm_ChildStates'))
      .map((lines) => {
        return unityRefFileId(readUnityFieldFromLines(lines, 'm_State', null));
      })
      .filter(Boolean)
    : [...states.keys()];

  const anyStateTransitionIds = stateMachineDoc
    ? getNestedList(stateMachineDoc, 'm_AnyStateTransitions').map(unityRefFileId).filter(Boolean)
    : [];
  const defaultStateId = stateMachineDoc ? unityRefFileId(getField(stateMachineDoc, 'm_DefaultState')) : childStateIds[0] || '';
  const parameters = controllerDoc ? parseAnimatorParameters(controllerDoc) : [];
  return { name: controllerName, parameters, states, transitions, childStateIds, anyStateTransitionIds, defaultStateId };
}

function cocosConditionFromUnity(condition) {
  return {
    __type__: 'cc.animation.TriggerCondition',
    trigger: condition.event,
  };
}

function buildCocosAnimationGraph(controller, clipInfoByState) {
  const objects = [];
  const add = (object) => {
    objects.push(object);
    return objects.length - 1;
  };

  const variables = {};
  for (const param of controller.parameters) {
    variables[param.name] = { __type__: 'cc.animation.TriggerVariable', _flags: 0 };
  }

  add({
    __type__: 'cc.animation.AnimationGraph',
    _name: controller.name,
    _objFlags: 0,
    _native: '',
    _layers: [{ __id__: 1 }],
    _variables: variables,
  });
  add({
    __type__: 'cc.animation.Layer',
    _stateMachine: { __id__: 2 },
    name: 'Base Layer',
    weight: 1,
    mask: null,
    additive: false,
  });
  const stateMachineId = add({
    __type__: 'cc.animation.StateMachine',
    _states: [],
    _transitions: [],
    _entryState: { __id__: 3 },
    _exitState: { __id__: 4 },
    _anyState: { __id__: 5 },
  });
  add({ __type__: 'cc.animation.State', name: 'Entry' });
  add({ __type__: 'cc.animation.State', name: 'Exit' });
  add({ __type__: 'cc.animation.State', name: 'Any' });

  const motionIdByState = new Map();
  for (const stateId of controller.childStateIds) {
    const state = controller.states.get(stateId);
    if (!state) continue;
    const clipInfo = clipInfoByState.get(stateId);
    const clipUuid = clipInfo?.uuid || '';
    const motionName = clipInfo?.name || state.name;
    const motionId = add({
      __type__: 'cc.animation.Motion',
      name: motionName,
      motion: clipUuid
        ? {
          __type__: 'cc.animation.ClipMotion',
          clip: { __expectedType__: 'cc.AnimationClip', __uuid__: clipUuid },
        }
        : null,
    });
    motionIdByState.set(stateId, motionId);
  }

  const stateMachine = objects[stateMachineId];
  stateMachine._states = [3, 4, 5, ...motionIdByState.values()].map(cocosRef);

  const addTransition = (transitionObject) => {
    const id = add(transitionObject);
    stateMachine._transitions.push(cocosRef(id));
    return id;
  };

  const defaultMotionId = motionIdByState.get(controller.defaultStateId);
  if (defaultMotionId != null) {
    addTransition({
      __type__: 'cc.animation.Transition',
      from: cocosRef(3),
      to: cocosRef(defaultMotionId),
      conditions: [],
    });
  }

  const emitUnityTransition = (fromId, transition) => {
    if (!transition) return;
    const toId = motionIdByState.get(transition.dstStateId);
    if (fromId == null || toId == null) return;
    addTransition({
      __type__: 'cc.animation.AnimationTransition',
      from: cocosRef(fromId),
      to: cocosRef(toId),
      conditions: transition.conditions.map(cocosConditionFromUnity),
      destinationStart: 0,
      relativeDestinationStart: false,
      duration: transition.duration,
      relativeDuration: false,
      exitConditionEnabled: transition.hasExitTime,
      _exitCondition: transition.exitTime,
    });
  };

  for (const transitionId of controller.anyStateTransitionIds) {
    emitUnityTransition(5, controller.transitions.get(transitionId));
  }

  for (const [stateId, motionId] of motionIdByState.entries()) {
    const state = controller.states.get(stateId);
    for (const transitionId of state?.transitionIds || []) {
      emitUnityTransition(motionId, controller.transitions.get(transitionId));
    }
  }

  return objects;
}

function convertAnimatorControllerAsset(controllerAsset, options, reporter, unityDb) {
  if (!controllerAsset?.path || !fs.existsSync(controllerAsset.path)) return '';
  const outDir = animationOutputDirForController(options, controllerAsset);
  const graphFile = path.join(outDir, `${sanitizeAssetDisplayName(controllerAsset.stem, 'Animator')}.animgraph`);
  const graphUuid = stableUuid(`unity-animation-graph:${controllerAsset.guid}`);
  if (options.dryRun) return graphUuid;

  ensureDir(outDir);
  ensureDirectoryMetas(outDir, path.join(options.cocosRoot, 'assets'));

  const controller = parseUnityAnimatorController(controllerAsset.path, unityDb, reporter, options);
  const clipInfoByState = new Map();
  const convertedClipGuids = new Set();
  for (const [stateId, state] of controller.states.entries()) {
    if (!state.motionGuid) continue;
    const clipAsset = unityDb.get(state.motionGuid);
    if (!clipAsset) {
      reporter.medium('ANIMATION_CLIP_GUID_UNRESOLVED', controllerAsset.relativePath, state.name, 'Animator state motion guid was not found in Unity meta database', state.motionGuid);
      continue;
    }
    const clipInfo = writeConvertedAnimationClip(clipAsset, outDir, options, reporter);
    if (clipInfo?.uuid) {
      clipInfoByState.set(stateId, clipInfo);
      convertedClipGuids.add(clipAsset.guid);
    }
  }

  const graph = buildCocosAnimationGraph(controller, clipInfoByState);
  fs.writeFileSync(graphFile, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  const graphMeta = ensureAnimationGraphMeta(graphFile, graphUuid);
  reporter.low(
    'ANIMATOR_CONTROLLER_CONVERTED',
    controllerAsset.relativePath,
    toPosix(path.relative(options.cocosRoot, graphFile)),
    `Unity AnimatorController converted to Cocos AnimationGraph with ${convertedClipGuids.size} clip(s)`
  );
  return graphMeta.uuid;
}

function emitAnimator(nodeId, componentId, doc, builder, reporter, options, unityDb, cocosDb, gameObject, model) {
  return emitAnimatorImpl(nodeId, componentId, doc, builder, reporter, options, unityDb, cocosDb, gameObject, model);
}

function emitMonoBehaviour(nodeId, componentId, doc, model, builder, reporter, options, unityDb, cocosDb, gameObject) {
  return emitMonoBehaviourImpl(nodeId, componentId, doc, model, builder, reporter, options, unityDb, cocosDb, gameObject);
}

function translateUnitySerializedValue(value, builder, reporter, source, fieldName) {
  return translateUnitySerializedValueImpl(value, builder, reporter, source, fieldName);
}

function sanitizeFileId(value) {
  return String(value || 'node')
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'node';
}

function ensurePrefabMeta(prefabFile, syncNodeName) {
  const metaFile = `${prefabFile}.meta`;
  const existing = readJsonIfExists(metaFile);
  if (existing?.uuid) return existing;
  const meta = {
    ver: '1.1.50',
    importer: 'prefab',
    imported: true,
    uuid: randomUuid(),
    files: ['.json'],
    subMetas: {},
    userData: { syncNodeName },
  };
  fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return meta;
}

function ensureDirectoryMetas(dir, assetsRoot) {
  const resolvedAssetsRoot = path.resolve(assetsRoot);
  let current = path.resolve(dir);
  const dirs = [];
  while (current.startsWith(resolvedAssetsRoot) && current !== resolvedAssetsRoot) {
    dirs.push(current);
    current = path.dirname(current);
  }
  dirs.reverse();
  for (const folder of dirs) {
    const metaFile = `${folder}.meta`;
    if (fs.existsSync(metaFile)) continue;
    const meta = {
      ver: '1.2.0',
      importer: 'directory',
      imported: true,
      uuid: randomUuid(),
      files: [],
      subMetas: {},
      userData: {},
    };
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }
}

function doctor(options) {
  const reporter = new Reporter();
  const unityRoot = options.unityRoot || inferUnityRoot(options.src || process.cwd());
  const unityDb = new UnityAssetDatabase(unityRoot, unityPackageAssetRoots(unityRoot));
  unityDb.scan();
  const cocosDb = new CocosAssetDatabase(options.cocosRoot);
  // Doctor only observes project health. It must never repair importer metadata
  // as a side effect of inspection, even when the caller did not pass --dry-run.
  cocosDb.scan({ readOnly: true });
  log(`Unity root: ${unityRoot}`);
  log(`Unity meta records: ${unityDb.byGuid.size}`);
  log(`Cocos root: ${options.cocosRoot}`);
  log(`Cocos asset records: ${cocosDb.records.length}`);
  log(`Cocos script classes: ${cocosDb.scriptsByClass.size}`);
  log(`Cocos layers: ${[...cocosDb.layersByName.entries()].map(([name, value]) => `${name}=${value}`).join(', ')}`);
  const actualReport = options.reportExplicit && !options.dryRun ? reporter.writeCsv(options.report, 'doctor') : '';
  if (actualReport) log(`Report: ${toPosix(path.relative(options.cocosRoot, actualReport))}`);
  else log('Doctor is read-only; no report was written.');
}

function runScriptScaffold(options) {
  if (!options.src) {
    fail('Missing --src <csharp_file_or_directory>');
  }

  const srcPath = path.resolve(options.src);
  if (!fs.existsSync(srcPath)) {
    fail(`Source path not found: ${srcPath}`);
  }
  if (options.dryRun) {
    log('Dry-run: script scaffold output is not written.');
    return [];
  }

  const outDir = options.out ? path.resolve(options.out) : path.join(ROOT_DIR, 'assets', 'script');
  const stat = fs.statSync(srcPath);

  if (stat.isFile()) {
    const res = scaffoldFile(srcPath, path.join(outDir, `${path.basename(srcPath, path.extname(srcPath))}.ts`));
    log(`Scaffolded C# -> TS: ${toPosix(path.relative(ROOT_DIR, res.outputPath))} (${res.fieldCount} properties)`);
    return [res];
  }

  const results = [];
  const sourceFiles = walkContainedFiles(srcPath, (file) => file.endsWith('.cs'));
  for (const full of sourceFiles) {
    try {
      const res = scaffoldFile(full, path.join(outDir, `${path.basename(full, '.cs')}.ts`));
      log(`Scaffolded C# -> TS: ${toPosix(path.relative(ROOT_DIR, res.outputPath))} (${res.fieldCount} properties)`);
      results.push(res);
    } catch (err) {
      log(`[warn] Failed to scaffold ${full}: ${err.message}`);
    }
  }
  log(`Total scripts scaffolded: ${results.length}`);
  return results;
}

async function finalizeEngineFeatures(options) {
  if (options.dryRun || options.shard || options.engineFeatureRepair === false) return null;
  log('==> [Engine Features] Auditing Cocos Feature Cropping and physics backend...');
  const receipt = await ensureCocosEngineFeatures(options.cocosRoot, {
    sourceEngine: 'unity-physx',
    physicsBackend: options.physicsBackend || undefined,
    forceBackend: !!options.forcePhysicsBackend,
    restart: options.engineFeatureRestart !== false,
    maxMcpAttempts: 2,
  });
  const decision = receipt.finalAudit?.physicsDecision;
  const backend = decision?.backend ? `${decision.label} (${decision.backend})` : 'none';
  log(`  [${receipt.complete ? 'ok' : 'warn'}] backend=${backend}; profile=${receipt.finalAudit?.profile?.complete ? 'ready' : 'missing'}; preview=${receipt.finalAudit?.appliedPreview?.complete ? 'ready' : 'pending'}; fallback=${receipt.fallbackUsed ? 'yes' : 'no'}`);
  if (!receipt.complete) {
    const error = new Error('Engine Feature Cropping remains pending after MCP/profile repair and guarded fallback. See .unity/engine-feature-report.json.');
    error.code = 'ENGINE_FEATURE_APPLY_INCOMPLETE';
    throw error;
  }
  return receipt;
}

function findPendingImporterStates(root, limit = 64) {
  if (!root || !fs.existsSync(root)) return [];
  const pending = [];
  const stack = [root];
  while (stack.length && pending.length < limit) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { stack.push(full); continue; }
      if (!entry.name.endsWith('.meta')) continue;
      let meta;
      try { meta = JSON.parse(fs.readFileSync(full, 'utf8')); } catch (_) { continue; }
      for (const failure of collectImportFailures(meta).failures) {
        pending.push({
          asset: toPosix(path.relative(root, full.slice(0, -5))),
          subPath: failure.subPath.join('/'),
          importer: failure.meta?.importer || 'unknown',
          uuid: failure.meta?.uuid || null,
        });
        if (pending.length >= limit) break;
      }
      if (pending.length >= limit) break;
    }
  }
  return pending;
}

async function finalizeImportedAssets(options) {
  if (options.dryRun || options.shard || options.modelImportWaitMs === 0) return null;
  const importedRoot = path.join(options.cocosRoot, 'assets', 'unity_imported');
  if (!fs.existsSync(importedRoot)) return null;
  log('==> [Asset Import] Refreshing copied Unity dependencies through Cocos-MCP...');
  let client = null;
  try {
    client = await createMcpClient(options.cocosRoot, {
      timeoutMs: Math.max(10_000, Number(options.modelImportWaitMs) || DEFAULT_MODEL_IMPORT_WAIT_MS),
    });
    const response = unwrapToolResult(await client.call('project_refresh_assets', {
      folder: 'db://assets/unity_imported',
    }));
    if (response?.success === false) throw new Error(response.error || response.message || 'Cocos AssetDB refresh failed');
    const timeoutMs = Math.max(1_000, Number(options.modelImportWaitMs) || DEFAULT_MODEL_IMPORT_WAIT_MS);
    const deadline = Date.now() + timeoutMs;
    let pending = findPendingImporterStates(importedRoot);
    while (pending.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      pending = findPendingImporterStates(importedRoot);
    }
    if (pending.length) {
      const error = new Error(`Cocos AssetDB still has ${pending.length} pending importer state(s) after refresh; first=${pending[0].asset}${pending[0].subPath ? `#${pending[0].subPath}` : ''}`);
      error.code = 'COCOS_ASSET_IMPORT_INCOMPLETE';
      error.pending = pending;
      throw error;
    }
    log('  [ok] copied Unity dependencies are imported, including nested subMetas.');
    return { attempted: true, complete: true, pending: [] };
  } catch (error) {
    const pending = findPendingImporterStates(importedRoot);
    if (!pending.length) {
      log(`  [info] Cocos-MCP refresh unavailable, but no pending importer state is recorded: ${error.message}`);
      return { attempted: true, complete: true, mcpUnavailable: true, warning: error.message };
    }
    if (!error.code) error.code = 'COCOS_ASSET_IMPORT_REFRESH_FAILED';
    throw error;
  } finally {
    if (client) await client.close();
  }
}

async function runSmartPort(options) {
  log(`==> [Smart Port] Starting automated porting pipeline for: ${options.src}`);
  const srcPath = path.resolve(options.src);
  if (!fs.existsSync(srcPath)) {
    fail(`Source path not found: ${srcPath}`);
  }

  // 1. Port Prefabs if any
  try {
    await portPrefabBatch(options);
    log(`  [ok] Prefab batch porting completed.`);
  } catch (err) {
    log(`  [warn] Prefab porting: ${err.message}`);
  }

  // 2. Scaffold C# Scripts if present
  try {
    const scriptResults = runScriptScaffold(options);
    log(`  [ok] Scaffolded ${scriptResults.length} C# scripts to TypeScript.`);
  } catch (err) {
    log(`  [info] Script scaffolding note: ${err.message}`);
  }

  // 3. Feature Cropping is part of the port result: emitted Graphics/physics
  // components are unusable until both the profile and active preview import
  // map contain their modules. The helper is a no-op when already synchronized.
  await finalizeImportedAssets(options);
  await finalizeEngineFeatures(options);

  // 4. Automated Post-Port Verification
  try {
    const { runVerificationSuite } = require('./headless-verifier.cjs');
    log(`==> [Verification] Running post-porting automated checks...`);
    const report = runVerificationSuite();
    log(`  [${report.status === 'PASS' ? 'ok' : 'warn'}] Post-Port Verification: ${report.status} (${report.passedChecks}/${report.totalChecks} checks passed).`);
    if (report.totalErrors > 0) {
      log(`  [error] ${report.totalErrors} error(s) found. Run 'npm run ai:verify' for details.`);
    }
  } catch (err) {
    log(`  [info] Post-port verification note: ${err.message}`);
  }

  log(`==> [Smart Port] Automated port pipeline finished.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'help') {
    printHelp();
    return;
  }
  if (options.command === 'doctor') {
    if (options.reportExplicit && !options.dryRun) {
      const doctorRoot = options.unityRoot || inferUnityRoot(options.src || process.cwd());
      assertUnityPortPreflight(doctorRoot, { projectRoot: doctorRoot, requireProject: true });
    }
    doctor(options);
    return;
  }
  if (!options.dryRun) {
    assertUnityPortPreflight(options.src || options.unityRoot, {
      projectRoot: options.unityRoot || undefined,
      requireProject: true,
    });
  }
  if (options.command === 'scaffold-script' || options.command === 'port-script') {
    runScriptScaffold(options);
    return;
  }
  if (options.command === 'smart-port' || options.command === 'auto') {
    await runSmartPort(options);
    return;
  }
  await portPrefabBatch(options);
  await finalizeImportedAssets(options);
  await finalizeEngineFeatures(options);
}

if (require.main === module) {
  Promise.resolve()
    .then(main)
    .catch((error) => {
      const message = error?.message || String(error);
      console.error(`[unity-cocos-port] ${error?.code || 'ERROR'}: ${message}`);
      process.exit(1);
    });
}

module.exports = {
  CocosAssetDatabase,
  portPrefab,
  portPrefabBatch,
  findFiles,
  runScriptScaffold,
  runSmartPort,
  finalizeEngineFeatures,
  finalizeImportedAssets,
  findPendingImporterStates,
  convertUnityPhysicsMaterialToCocos,
  resolveUnityPhysicsMaterialUuid,
  emitCanvas,
  resolveTransformLayout,
  unityCanvasRenderMode,
  convertNodePosition,
  multiplyQuaternion,
  correctNestedModelForwardAxis,
  buildNestedPrefabPropertyOverrides,
  rebaseNestedModelMountedChildTransform,
  hasExplicitNestedModelForwardBasisRotation,
  cocosQuaternionToEuler,
  convertRotation,
  parseArgs,
  main,
};
