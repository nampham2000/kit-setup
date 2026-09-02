#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { isPathInside } = require('./lib/path-boundary.cjs');
const { digest: digestPortReport } = require('./report-digest.cjs');
const {
  DEFAULT_CONFIG: DEFAULT_REGRESSION_REGISTRY,
  initRegistry,
  mergeRegistryRequiredRisks,
} = require('./port-regression-gate.cjs');
const { runUnityPortPreflight, assertUnityPortPreflight } = require('./unity-intel/preflight.cjs');
const { FIDELITY_CHECKPOINTS } = require('./unity-intel/core-gameplay-scope.cjs');
const {
  PHYSICS_BACKENDS,
  PHYSICS_2D_BACKENDS,
  SPINE_BACKENDS,
  ensureCocosEngineFeatures,
} = require('./cocos-engine-feature-audit.cjs');

const MANIFEST_SCHEMA_VERSION = 3;
const MANIFEST_KIND = 'cc-playable-core-port-manifest';
const EVIDENCE_SCHEMA_VERSION = 1;
const EVIDENCE_KIND = 'cc-playable-core-checkpoint-evidence';
const DEFAULT_MANIFEST = '.ai/port/core-gameplay.json';
const RESUME_PACKET_SCHEMA_VERSION = 1;
const RESUME_PACKET_KIND = 'cc-playable-port-resume-packet';
const DEFAULT_WIRING = '.ai/port/static-scaffold.wiring.json';
const DEFAULT_STATIC_SCAFFOLD_RECEIPT = '.ai/port/static-scaffold.receipt.json';
const DEFAULT_RESUME_PACKET = '.ai/port/resume-packet.json';
const STATIC_SCAFFOLD_RECEIPT_KIND = 'cc-playable-static-scaffold-receipt';
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_EVIDENCE_BYTES = 256 * 1024;
const MAX_WIRING_BYTES = 2 * 1024 * 1024;
const MAX_PORT_REPORT_BYTES = 32 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 256 * 1024;
const MAX_EVIDENCE_PATHS = 8;
const MAX_PATH_CHARS = 512;
const MAX_OBSERVATION_CHARS = 1200;
const GATE_TIMEOUT_MS = 10 * 60 * 1000;
const GATE_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const EVIDENCE_METHODS = Object.freeze(['runtime', 'visual', 'runtime-visual']);
const VISUAL_ONLY_ALLOWED = new Set(['camera-layout', 'animation-vfx-feedback']);
const ENGINE_FEATURE_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const REQUIRED_SCRIPTS = Object.freeze([
  Object.freeze({ id: 'verify.all', script: 'ai:verify' }),
  Object.freeze({ id: 'verify.gc', script: 'ai:lint' }),
  Object.freeze({ id: 'verify.assets', script: 'ai:verify:assets' }),
  // Core acceptance consumes the hash-bound regression receipt. The full
  // registry is intentionally run by the implementation workflow after each
  // watched change; rerunning it here can duplicate long campaign playthroughs
  // and hit the generic child timeout even though the current receipt is valid.
  Object.freeze({ id: 'verify.regressions', script: 'ai:verify:regressions:check' }),
  Object.freeze({ id: 'build.playable', script: 'build' }),
  Object.freeze({ id: 'verify.runtime', script: 'ai:verify:runtime' }),
]);
const PREVIEW_REQUIRED_SCRIPTS = Object.freeze(REQUIRED_SCRIPTS.filter(item => item.id !== 'build.playable'));
const DEFAULT_PREVIEW_URL = 'http://127.0.0.1:7456/';

const USAGE = `Core Gameplay Port

Usage:
  node playable-shared-kit/tools/core-gameplay-port.cjs init --unity-project <root> [--cocos-project <root>] [options]
  node playable-shared-kit/tools/core-gameplay-port.cjs scaffold --unity-project <root> [--cocos-project <root>] [options]
  node playable-shared-kit/tools/core-gameplay-port.cjs resume --unity-project <root> [--cocos-project <root>] [options]
  node playable-shared-kit/tools/core-gameplay-port.cjs verify --unity-project <root> [--cocos-project <root>] [options]

Commands:
  init     Run mandatory playable-core preflight and write a compact evidence manifest.
  scaffold Run static-first init + scene skeleton/wiring, then persist a bounded resume packet.
  resume   Rebuild a bounded handoff/status packet without reading raw Unity source.
  verify   Run evidence-backed fidelity gates; --preview-only never builds or claims build acceptance.

Options:
  --unity-project <dir>  Complete Unity project root (required).
  --cocos-project <dir>  Cocos playable root. Default: current directory.
  --manifest <file>      Relative path inside Cocos project. Default: ${DEFAULT_MANIFEST}.
  --wiring <file>        Static scene wiring path. Default: ${DEFAULT_WIRING}.
  --packet <file>        Resume packet path. Default: ${DEFAULT_RESUME_PACKET}.
  --target-scene <file>  Relative Cocos .scene output. Default: assets/<UnitySceneName>.scene.
  --provider <mode>      auto | static | unity-mcp. Default: auto.
  --dispositions <file>  Hash-bound source-high disposition JSON used by the live preflight.
  --cache-dir <dir>      Relocate the incremental Unity index cache only.
  --no-cache             Re-scan Unity records without reading/writing the incremental index.
  --refresh-cache        Ignore the current index cache and replace it with fresh records.
  --bootstrap            Allow Unity-MCP package setup/reload during init.
  --force                Replace an existing manifest during init.
  --dry-run              Init without creating a directory or file.
  --write                Persist the refreshed packet when running resume.
  --no-run-gates         Verify manifest only; result cannot be accepted as runnable.
  --preview-only         Skip build and verify the active Cocos editor preview; never claims build acceptance.
  --preview-url <url>    Loopback editor preview URL. Default: ${DEFAULT_PREVIEW_URL}.
  --json                 Compact JSON output.
  --help                 Show help.

The command never claims gameplay fidelity from compiler confidence. A checkpoint
counts only when source, current Cocos target hashes, and schema-validated runtime/visual
evidence are bound to the current Unity preflight receipt.`;

function corePortError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function parseArgs(argv) {
  const options = { command: null, cocosProject: process.cwd(), provider: 'auto', runGates: true };
  let index = 0;
  if (argv[0] && !argv[0].startsWith('-')) {
    options.command = argv[0];
    index = 1;
  }
  if (!['init', 'scaffold', 'resume', 'verify'].includes(options.command)) {
    if (argv.includes('--help') || argv.includes('-h')) return { ...options, help: true };
    throw corePortError('CORE_PORT_COMMAND_INVALID', 'Command phai la init, scaffold, resume hoac verify.');
  }
  if (options.command === 'scaffold') options.provider = 'static';
  for (; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    if (argument === '--json') { options.json = true; continue; }
    if (argument === '--bootstrap') { options.bootstrap = true; continue; }
    if (argument === '--force') { options.force = true; continue; }
    if (argument === '--dry-run') { options.dryRun = true; continue; }
    if (argument === '--write') { options.write = true; continue; }
    if (argument === '--no-run-gates') { options.runGates = false; continue; }
    if (argument === '--preview-only') { options.previewOnly = true; continue; }
    if (argument === '--no-cache') { options.cache = false; continue; }
    if (argument === '--refresh-cache') { options.refreshCache = true; continue; }
    const equal = /^--([a-z-]+)=(.*)$/.exec(argument);
    const name = equal ? equal[1] : argument.startsWith('--') ? argument.slice(2) : null;
    if (!['unity-project', 'cocos-project', 'manifest', 'wiring', 'packet', 'target-scene', 'provider', 'dispositions', 'cache-dir', 'preview-url'].includes(name)) {
      throw corePortError('CORE_PORT_OPTION_INVALID', `Option khong ho tro: ${argument}`);
    }
    const value = equal ? equal[2] : argv[++index];
    if (!value || value.startsWith('--')) throw corePortError('CORE_PORT_OPTION_VALUE_REQUIRED', `--${name} can gia tri.`);
    options[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (!options.unityProject && !options.help) throw corePortError('CORE_PORT_UNITY_REQUIRED', 'Thieu --unity-project.');
  if (!['auto', 'static', 'unity-mcp'].includes(options.provider)) {
    throw corePortError('CORE_PORT_PROVIDER_INVALID', '--provider phai la auto, static hoac unity-mcp.');
  }
  if ((options.previewOnly || options.previewUrl) && options.command !== 'verify') {
    throw corePortError('CORE_PORT_PREVIEW_MODE_INVALID', '--preview-only/--preview-url chi dung voi verify.');
  }
  if (options.previewUrl && !options.previewOnly) {
    throw corePortError('CORE_PORT_PREVIEW_MODE_INVALID', '--preview-url can --preview-only.');
  }
  if (options.previewOnly) options.previewUrl = normalizePreviewUrl(options.previewUrl || DEFAULT_PREVIEW_URL);
  return options;
}

function normalizePreviewUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch (_) {
    throw corePortError('CORE_PORT_PREVIEW_URL_INVALID', '--preview-url phai la loopback http(s) URL.');
  }
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]';
  if (!loopback || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
      || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw corePortError('CORE_PORT_PREVIEW_URL_INVALID', '--preview-url chi nhan loopback http(s) origin khong credentials/query/hash/path.');
  }
  return parsed.href;
}

function validateUnityRoot(value) {
  const candidate = path.resolve(String(value || ''));
  if (!fs.existsSync(candidate)) {
    throw corePortError('CORE_PORT_UNITY_INVALID', 'Unity project root khong hop le.');
  }
  const root = fs.realpathSync.native(candidate);
  try {
    const assets = resolveContained(root, 'Assets', { mustExist: true });
    const version = resolveContained(root, 'ProjectSettings/ProjectVersion.txt', { mustExist: true });
    if (!fs.statSync(assets).isDirectory() || !fs.statSync(version).isFile()) throw new Error('shape');
  } catch (_) {
    throw corePortError('CORE_PORT_UNITY_INVALID', 'Unity project root khong hop le hoac chua path redirect.');
  }
  return root;
}

function validateCocosRoot(value) {
  const candidate = path.resolve(String(value || ''));
  if (!fs.existsSync(candidate)) {
    throw corePortError('CORE_PORT_COCOS_INVALID', 'Cocos project root can package.json va assets/.');
  }
  const root = fs.realpathSync.native(candidate);
  try {
    const packageFile = resolveContained(root, 'package.json', { mustExist: true });
    const assets = resolveContained(root, 'assets', { mustExist: true });
    if (!fs.statSync(packageFile).isFile() || !fs.statSync(assets).isDirectory()) throw new Error('shape');
  } catch (_) {
    throw corePortError('CORE_PORT_COCOS_INVALID', 'Cocos project root can package.json va assets/ khong redirect.');
  }
  return root;
}

function resolveContained(root, relativeOrAbsolute, options = {}) {
  const resolvedRoot = path.resolve(root);
  const candidate = path.isAbsolute(relativeOrAbsolute)
    ? path.resolve(relativeOrAbsolute)
    : path.resolve(resolvedRoot, relativeOrAbsolute || DEFAULT_MANIFEST);
  if (!isPathInside(resolvedRoot, candidate)) {
    throw corePortError('CORE_PORT_PATH_ESCAPE', 'Manifest/evidence path phai nam trong Cocos project.');
  }
  const relative = path.relative(resolvedRoot, candidate);
  let cursor = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw corePortError('CORE_PORT_PATH_ESCAPE', 'Symlink/junction khong duoc phep trong manifest/evidence path.');
    const real = fs.realpathSync.native(cursor);
    if (!isPathInside(fs.realpathSync.native(resolvedRoot), real)) {
      throw corePortError('CORE_PORT_PATH_ESCAPE', 'Manifest/evidence realpath thoat khoi Cocos project.');
    }
  }
  if (options.mustExist && !fs.existsSync(candidate)) {
    throw corePortError('CORE_PORT_EVIDENCE_MISSING', `Khong tim thay evidence: ${relative.replace(/\\/g, '/')}`);
  }
  return candidate;
}

function relativeSlash(root, value) {
  return path.relative(root, value).replace(/\\/g, '/');
}

function manifestPath(cocosRoot, value) {
  return resolveContained(cocosRoot, value || DEFAULT_MANIFEST);
}

function hashBytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function atomicWriteJson(root, file, value, options = {}) {
  const parent = path.dirname(file);
  fs.mkdirSync(parent, { recursive: true });
  resolveContained(root, parent, { mustExist: true });
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(payload) > MAX_MANIFEST_BYTES) {
    throw corePortError('CORE_PORT_MANIFEST_TOO_LARGE', `Manifest vuot ${MAX_MANIFEST_BYTES} bytes.`);
  }
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const lock = `${file}.lock`;
  let lockDescriptor;
  try {
    try {
      lockDescriptor = fs.openSync(lock, 'wx', 0o600);
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        throw corePortError('CORE_PORT_MANIFEST_LOCKED', 'Manifest dang duoc mot core:init khac cap nhat.');
      }
      throw error;
    }
    const existed = fs.existsSync(file);
    const currentHash = existed ? hashFile(file) : null;
    if (!options.force && existed) {
      throw corePortError('CORE_PORT_MANIFEST_EXISTS', `Manifest da ton tai: ${relativeSlash(root, file)}. Dung --force neu muon tao lai.`);
    }
    if (options.force && currentHash !== (options.expectedHash || null)) {
      throw corePortError('CORE_PORT_MANIFEST_CONCURRENT', 'Manifest thay doi sau khi init bat dau; khong overwrite thay doi moi.');
    }
    fs.writeFileSync(temp, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const latestHash = fs.existsSync(file) ? hashFile(file) : null;
    if (latestHash !== currentHash) {
      throw corePortError('CORE_PORT_MANIFEST_CONCURRENT', 'Manifest thay doi trong luc tao generation moi.');
    }
    if (existed) {
      fs.renameSync(temp, file);
    } else {
      try {
        fs.linkSync(temp, file);
        try { fs.unlinkSync(temp); } catch (_) { /* linked target is already complete */ }
      } catch (error) {
        // exFAT on Windows has no hard links. File.Move is an atomic, same-volume
        // publish that refuses an existing destination; renameSync would clobber it.
        if (process.platform !== 'win32' || !['EISDIR', 'ENOTSUP', 'EPERM', 'ENOSYS'].includes(error.code)) throw error;
        const moved = spawnSync('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command',
          '$ErrorActionPreference = "Stop"; [System.IO.File]::Move($env:CORE_PORT_PUBLISH_SOURCE, $env:CORE_PORT_PUBLISH_TARGET)',
        ], {
          env: { ...process.env, CORE_PORT_PUBLISH_SOURCE: temp, CORE_PORT_PUBLISH_TARGET: file },
          windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 16384,
        });
        if (moved.error || moved.status !== 0) {
          if (fs.existsSync(file)) throw corePortError('CORE_PORT_MANIFEST_CONCURRENT', 'Manifest thay doi trong luc publish; khong overwrite thay doi moi.');
          throw moved.error || error;
        }
      }
    }
    return hashBytes(payload);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    if (lockDescriptor !== undefined) {
      fs.closeSync(lockDescriptor);
      try { fs.unlinkSync(lock); } catch (_) { /* best effort */ }
    }
  }
}

function targetScenePath(entryScene) {
  const base = path.posix.basename(String(entryScene || '').replace(/\\/g, '/'), '.unity');
  const safe = base.replace(/[^a-z0-9_. -]+/gi, '-').trim() || 'CoreGameplay';
  return `assets/${safe}.scene`;
}

function createManifest(brief, options = {}) {
  const core = brief.coreGameplay;
  const targetEntryScene = options.targetScene
    ? String(options.targetScene).replace(/\\/g, '/')
    : targetScenePath(core.entry.primary);
  validateLogicalPath(targetEntryScene, 'target scene');
  if (!targetEntryScene.endsWith('.scene')) {
    throw corePortError('CORE_PORT_TARGET_SCENE_INVALID', '--target-scene phải là Cocos .scene path bên trong project.');
  }
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kind: MANIFEST_KIND,
    profile: 'playable-core',
    source: {
      briefId: brief.briefId,
      receiptId: brief.receiptId,
      projectFingerprint: brief.project.projectFingerprint,
      stateFingerprint: brief.project.stateFingerprint,
      entryScene: core.entry.primary,
    },
    delivery: {
      minimumFidelity: core.acceptance.minimumFidelity,
      targetFidelity: core.acceptance.targetFidelity,
      targetEntryScene,
      evidenceContract: {
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        kind: EVIDENCE_KIND,
        methods: EVIDENCE_METHODS,
        binds: ['briefId', 'stateFingerprint', 'checkpoint', 'targetHashes'],
      },
      requiredArtifacts: [
        targetEntryScene,
        'assets/script/**/*.ts',
        'assets/resources/playable-config.json',
        'build/common/**/*.html',
      ],
      requiredGates: REQUIRED_SCRIPTS.map(item => item.id),
    },
    engineFeatures: brief.engineFeatureClosure || {
      schemaVersion: 1,
      status: 'not-required',
      requiredModules: [],
      disabledModules: [],
      selectors: { physicsBackend: null, physics2dBackend: null, spineBackend: null },
      evidence: [],
      blockers: [],
    },
    checkpoints: core.acceptance.weights.map(([id, weight]) => {
      const projected = (core.acceptance.mandatory || []).includes(id);
      const detailed = brief.coreGameplayCheckpointEvidence && brief.coreGameplayCheckpointEvidence[id] ||
        core.acceptance.sourceEvidence && core.acceptance.sourceEvidence[id];
      return {
        id,
        weight,
        mandatory: projected,
        status: 'pending',
        sourceEvidence: detailed || [],
        targetEvidence: [],
        verificationEvidence: [],
      };
    }),
    exclusions: {
      adapters: core.adapters.map(item => ({ id: item.id, disposition: item.disposition, count: item.count })),
      deferred: core.excluded.map(item => ({ id: item.id, disposition: item.disposition, count: item.count })),
    },
  };
}

function checkpointSourcesFromBrief(brief) {
  const evidence = {};
  const core = brief.coreGameplay;
  const byFeature = new Map((brief.features || []).map(feature => [feature.id, feature.evidence || []]));
  const weights = core.acceptance.weights.map(item => item[0]);
  for (const id of weights) evidence[id] = [];
  const add = (id, paths) => {
    for (const item of paths || []) {
      if (typeof item === 'string' && !evidence[id].includes(item)) evidence[id].push(item);
    }
    evidence[id] = evidence[id].slice(0, 3);
  };
  for (const [id, values] of Object.entries(core.acceptance.sourceEvidence || {})) add(id, values);
  add('input-response', byFeature.get('input'));
  add('interaction-motion', [...(byFeature.get('physics-2d') || []), ...(byFeature.get('physics-3d') || []), ...(byFeature.get('input') || [])]);
  add('spawn-timing', [...(byFeature.get('spawning-pooling') || []), ...(byFeature.get('timing-coroutines') || []), ...(byFeature.get('tweening') || [])]);
  add('camera-layout', [...(byFeature.get('camera') || []), ...(byFeature.get('ui') || [])]);
  add('animation-vfx-feedback', [...(byFeature.get('animation') || []), ...(byFeature.get('particles-vfx') || []), ...(byFeature.get('rendering-shaders') || [])]);
  add('audio-feedback', byFeature.get('audio'));
  add('playable-lifecycle-cta', byFeature.get('analytics-monetization'));
  add('core-rules-state', core.coreScripts);
  add('win-lose-restart', core.coreScripts);
  return evidence;
}

function regressionRisksFromBrief(brief) {
  const features = new Set((brief.features || []).map(feature => feature.id));
  const risks = new Set(['input-response', 'level-lifecycle']);
  if (features.has('camera')) risks.add('camera-transform');
  if (features.has('ui')) risks.add('font-ui-layout');
  if (features.has('animation') || features.has('particles-vfx') || features.has('tweening') || features.has('timing-coroutines')) {
    risks.add('animation-callback-flow');
  }
  if (features.has('rendering-shaders')) risks.add('material-color-lighting');
  return [...risks];
}

function ensureRegressionRegistry(cocosRoot, brief, dependencies = {}) {
  const relative = DEFAULT_REGRESSION_REGISTRY;
  const file = resolveContained(cocosRoot, relative);
  const risks = regressionRisksFromBrief(brief);
  if (fs.existsSync(file)) {
    const merge = dependencies.mergeRegressionRisks || mergeRegistryRequiredRisks;
    const result = merge({ project: cocosRoot, config: relative, risks });
    return { status: result.status, path: result.registry, requiredRisks: result.requiredRisks };
  }
  const create = dependencies.initRegistry || initRegistry;
  const result = create({ project: cocosRoot, config: relative, risks });
  return { status: 'created', path: result.registry, requiredRisks: result.requiredRisks };
}

async function enforceEngineFeatureClosure(cocosRoot, closure, options = {}, dependencies = {}) {
  const requiredModules = [...new Set(closure && closure.requiredModules || [])];
  const disabledModules = [...new Set(closure && closure.disabledModules || [])];
  const blockers = closure && closure.blockers || [];
  if (blockers.length || closure && closure.status === 'blocked') {
    throw corePortError('CORE_PORT_ENGINE_FEATURE_SOURCE_BLOCKED', 'Unity engine feature closure còn thiếu exact source evidence.', {
      blockers: blockers.slice(0, 8),
    });
  }
  if (!requiredModules.length && !disabledModules.length) {
    return { required: false, complete: true, status: 'not-required', requiredModules: [], disabledModules: [] };
  }
  if (options.dryRun) {
    return {
      required: true,
      complete: false,
      status: 'planned',
      requiredModules,
      disabledModules,
      selectors: closure.selectors || {},
    };
  }
  const ensure = dependencies.ensureEngineFeatures || ensureCocosEngineFeatures;
  const result = await ensure(cocosRoot, {
    requiredModules,
    disabledModules,
    physicsBackend: closure.selectors && closure.selectors.physicsBackend || undefined,
    physics2dBackend: closure.selectors && closure.selectors.physics2dBackend || undefined,
    spineBackend: closure.selectors && closure.selectors.spineBackend || undefined,
  });
  if (!result || result.complete !== true) {
    throw corePortError('CORE_PORT_ENGINE_FEATURES_PENDING', 'Cocos Feature Cropping chưa được apply vào active preview; dừng trước gameplay implementation.', {
      requiredModules,
      disabledModules,
      selectors: closure.selectors || {},
      status: result && (result.status || result.finalAudit && result.finalAudit.pendingEditorApply ? 'pending-editor-apply' : null),
    });
  }
  return {
    required: true,
    complete: true,
    status: 'verified',
    requiredModules,
    disabledModules,
    selectors: closure.selectors || {},
  };
}

async function initCorePort(options, dependencies = {}) {
  const unityRoot = validateUnityRoot(options.unityProject);
  const cocosRoot = validateCocosRoot(options.cocosProject);
  const runPreflight = dependencies.runPreflight || runUnityPortPreflight;
  const progress = dependencies.onProgress || (() => {});
  progress({ stage: 'preflight', status: 'start' });
  const result = await runPreflight({
    project: unityRoot,
    provider: options.provider || 'auto',
    bootstrap: options.bootstrap === true,
    sourceDispositions: options.dispositions,
    cache: options.cache !== false,
    indexCacheDir: options.cacheDir,
    refreshCache: options.refreshCache === true,
    profile: 'playable-core',
    intent: 'project',
  });
  progress({ stage: 'preflight', status: 'complete' });
  const brief = result.brief;
  if (!brief.decision.implementationAllowed) {
    throw corePortError('CORE_PORT_PREFLIGHT_BLOCKED', 'Unity preflight dang co hard blocker.', {
      hardBlockerCount: brief.decision.hardBlockerCount,
    });
  }
  if (!brief.decision.coreEntryReady || !brief.coreGameplay || !brief.coreGameplay.entry.primary) {
    throw corePortError('CORE_PORT_ENTRY_REQUIRED', 'Khong chon duoc duy nhat gameplay entry scene; can bounded scene decision.');
  }
  progress({ stage: 'engine-features', status: 'start' });
  const engineFeatures = await enforceEngineFeatureClosure(
    cocosRoot,
    brief.engineFeatureClosure || { status: 'not-required', requiredModules: [], disabledModules: [], selectors: {}, blockers: [] },
    options,
    dependencies,
  );
  progress({ stage: 'engine-features', status: 'complete' });
  const file = manifestPath(cocosRoot, options.manifest);
  const existed = fs.existsSync(file);
  const expectedHash = existed ? hashFile(file) : null;
  if (existed && !options.force) {
    throw corePortError('CORE_PORT_MANIFEST_EXISTS', `Manifest da ton tai: ${relativeSlash(cocosRoot, file)}. Dung --force neu muon tao lai.`);
  }
  brief.coreGameplayCheckpointEvidence = checkpointSourcesFromBrief(brief);
  const manifest = createManifest(brief, options);
  let regressions = { status: 'planned', path: DEFAULT_REGRESSION_REGISTRY, requiredRisks: regressionRisksFromBrief(brief) };
  if (!options.dryRun) {
    progress({ stage: 'manifest', status: 'start' });
    atomicWriteJson(cocosRoot, file, manifest, { force: !!options.force, expectedHash });
    progress({ stage: 'manifest', status: 'complete' });
    progress({ stage: 'regressions', status: 'start' });
    regressions = ensureRegressionRegistry(cocosRoot, brief, dependencies);
    progress({ stage: 'regressions', status: 'complete' });
  }
  return {
    ok: true,
    command: 'init',
    dryRun: !!options.dryRun,
    manifest: relativeSlash(cocosRoot, file),
    source: manifest.source,
    core: {
      closure: brief.coreGameplay.closure,
      features: brief.features.map(feature => feature.id),
      adapters: brief.coreGameplay.adapters.map(item => [item.id, item.count]),
      deferred: brief.coreGameplay.excluded.map(item => [item.id, item.count]),
    },
    acceptance: brief.coreGameplay.acceptance,
    engineFeatures,
    regressions,
    next: options.dryRun
      ? 'Run init without --dry-run.'
      : `Implement only this manifest, then run core verify; do not claim fidelity before score >=${manifest.delivery.minimumFidelity}.`,
  };
}

function summarizeWiring(cocosRoot, relative = DEFAULT_WIRING) {
  let file;
  try { file = resolveContained(cocosRoot, relative, { mustExist: true }); } catch (_) {
    return { found: false, path: relative, stats: null, unresolved: {}, todo: [] };
  }
  let payload;
  try { payload = readJsonBounded(file, MAX_WIRING_BYTES, 'CORE_PORT_WIRING_INVALID'); } catch (error) {
    return { found: true, path: relative, invalid: true, code: error.code || 'CORE_PORT_WIRING_INVALID', stats: null, unresolved: {}, todo: [] };
  }
  const unresolved = {};
  for (const [key, value] of Object.entries(payload.unresolved || {})) {
    unresolved[key] = Array.isArray(value) ? value.length : 0;
  }
  const todo = (Array.isArray(payload.todo) ? payload.todo : []).slice(0, 8).map(item => ({
    kind: String(item && item.kind || 'unknown').slice(0, 80),
    label: String(item && item.label || item && item.key || 'Resolve static wiring').slice(0, 240),
    nodeCount: Number.isFinite(item && item.nodeCount) ? item.nodeCount : 0,
  }));
  return {
    found: true,
    path: relative,
    invalid: false,
    stats: payload.stats && typeof payload.stats === 'object' ? {
      nodes: Number(payload.stats.nodes || 0),
      unresolvedTotal: Number(payload.stats.unresolvedTotal || 0),
      distinctTasks: Number(payload.stats.distinctTasks || todo.length),
    } : null,
    unresolved,
    todo,
    todoTruncated: Math.max(0, Number(payload.stats && payload.stats.distinctTasks || todo.length) - todo.length),
  };
}

function summarizePortReport(cocosRoot) {
  const relative = '.unity/port-report.csv';
  let file;
  try { file = resolveContained(cocosRoot, relative, { mustExist: true }); } catch (_) {
    return { found: false, path: relative, counts: { high: 0, medium: 0, low: 0 }, codes: [] };
  }
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_PORT_REPORT_BYTES) {
    return { found: true, path: relative, invalid: true, code: 'CORE_PORT_REPORT_TOO_LARGE', counts: { high: 0, medium: 0, low: 0 }, codes: [] };
  }
  let result;
  try { result = digestPortReport(fs.readFileSync(file, 'utf8'), {}); } catch (_) {
    return { found: true, path: relative, invalid: true, code: 'CORE_PORT_REPORT_INVALID', counts: { high: 0, medium: 0, low: 0 }, codes: [] };
  }
  return {
    found: true,
    path: relative,
    invalid: false,
    rows: result.total,
    prefabs: result.prefabs,
    counts: result.counts,
    codes: result.byCode.filter(item => item.severity !== 'low').slice(0, 8).map(item => ({
      code: item.code,
      severity: item.severity,
      count: item.count,
      action: String(item.action || '').slice(0, 320),
    })),
    codesTruncated: Math.max(0, result.byCode.filter(item => item.severity !== 'low').length - 8),
  };
}

function inspectStaticScaffoldReceipt(cocosRoot, manifest, options = {}) {
  const relative = options.scaffoldReceipt || DEFAULT_STATIC_SCAFFOLD_RECEIPT;
  let file;
  try { file = resolveContained(cocosRoot, relative, { mustExist: true }); } catch (_) {
    return { found: false, valid: false, path: relative, code: 'CORE_PORT_STATIC_RECEIPT_MISSING' };
  }
  let receipt;
  try { receipt = readJsonBounded(file, MAX_MANIFEST_BYTES, 'CORE_PORT_STATIC_RECEIPT_INVALID'); } catch (error) {
    return { found: true, valid: false, path: relative, code: error.code || 'CORE_PORT_STATIC_RECEIPT_INVALID' };
  }
  const expected = {
    briefId: manifest.source.briefId,
    stateFingerprint: manifest.source.stateFingerprint,
    entryScene: manifest.source.entryScene,
    targetScene: manifest.delivery.targetEntryScene,
    wiring: options.wiring || DEFAULT_WIRING,
  };
  if (receipt.schemaVersion !== 1 || receipt.kind !== STATIC_SCAFFOLD_RECEIPT_KIND ||
      !receipt.source || !receipt.outputs || Object.entries(expected).some(([key, value]) =>
        key === 'targetScene' || key === 'wiring' ? receipt.outputs[key] !== value : receipt.source[key] !== value)) {
    return { found: true, valid: false, path: relative, code: 'CORE_PORT_STATIC_RECEIPT_STALE' };
  }
  for (const key of ['targetScene', 'wiring']) {
    let output;
    try { output = resolveContained(cocosRoot, receipt.outputs[key], { mustExist: true }); } catch (_) {
      return { found: true, valid: false, path: relative, code: 'CORE_PORT_STATIC_OUTPUT_MISSING' };
    }
    const expectedHash = receipt.hashes && receipt.hashes[key];
    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash) || hashFile(output) !== expectedHash) {
      return { found: true, valid: false, path: relative, code: 'CORE_PORT_STATIC_OUTPUT_CHANGED' };
    }
  }
  return { found: true, valid: true, path: relative, code: null, hashes: receipt.hashes };
}

function persistStaticScaffoldReceipt(cocosRoot, manifest, options = {}) {
  const targetFile = resolveContained(cocosRoot, manifest.delivery.targetEntryScene, { mustExist: true });
  const wiringRelative = options.wiring || DEFAULT_WIRING;
  const wiringFile = resolveContained(cocosRoot, wiringRelative, { mustExist: true });
  const relative = options.scaffoldReceipt || DEFAULT_STATIC_SCAFFOLD_RECEIPT;
  const file = resolveContained(cocosRoot, relative);
  if (fs.existsSync(file)) {
    throw corePortError('CORE_PORT_STATIC_RECEIPT_EXISTS', 'Static scaffold receipt đã tồn tại; không overwrite provenance ngoài ý muốn.');
  }
  atomicWriteJson(cocosRoot, file, {
    schemaVersion: 1,
    kind: STATIC_SCAFFOLD_RECEIPT_KIND,
    source: {
      briefId: manifest.source.briefId,
      stateFingerprint: manifest.source.stateFingerprint,
      entryScene: manifest.source.entryScene,
    },
    outputs: { targetScene: manifest.delivery.targetEntryScene, wiring: wiringRelative },
    hashes: { targetScene: hashFile(targetFile), wiring: hashFile(wiringFile) },
  });
  return relative;
}

function inspectSourceFreshness(unityRoot, manifest, dependencies = {}) {
  const gate = dependencies.assertPreflight || assertUnityPortPreflight;
  try {
    const result = gate(path.join(unityRoot, 'Assets'), { projectRoot: unityRoot });
    const receipt = result && result.receipt || {};
    const fresh = receipt.receiptId === manifest.source.receiptId &&
      receipt.briefId === manifest.source.briefId &&
      receipt.stateFingerprint === manifest.source.stateFingerprint;
    return { fresh, code: fresh ? null : 'CORE_PORT_MANIFEST_STALE' };
  } catch (error) {
    return { fresh: false, code: error.code || 'CORE_PORT_PREFLIGHT_RECEIPT_MISSING' };
  }
}

function checkpointSummary(manifest) {
  const summary = { total: manifest.checkpoints.length, pending: 0, pass: 0, fail: 0, outOfScope: 0, targetBound: 0, verificationBound: 0 };
  for (const checkpoint of manifest.checkpoints) {
    if (checkpoint.status === 'out-of-scope') summary.outOfScope += 1;
    else if (checkpoint.status in summary) summary[checkpoint.status] += 1;
    if (checkpoint.targetEvidence.length > 0) summary.targetBound += 1;
    if (checkpoint.verificationEvidence.length > 0) summary.verificationBound += 1;
  }
  return summary;
}

function buildResumePacket(options, dependencies = {}) {
  const unityRoot = validateUnityRoot(options.unityProject);
  const cocosRoot = validateCocosRoot(options.cocosProject);
  const file = manifestPath(cocosRoot, options.manifest);
  resolveContained(cocosRoot, file, { mustExist: true });
  const manifest = validateManifest(cocosRoot, file);
  const freshness = inspectSourceFreshness(unityRoot, manifest, dependencies);
  const wiringRelative = options.wiring || DEFAULT_WIRING;
  const wiring = summarizeWiring(cocosRoot, wiringRelative);
  const scaffoldReceipt = inspectStaticScaffoldReceipt(cocosRoot, manifest, options);
  const report = summarizePortReport(cocosRoot);
  const targetScene = existingContainedFile(cocosRoot, manifest.delivery.targetEntryScene);
  const config = existingContainedFile(cocosRoot, 'assets/resources/playable-config.json');
  const scripts = hasArtifact(path.join(cocosRoot, 'assets', 'script'), item => /\.(?:ts|js)$/i.test(item));
  const checkpoints = checkpointSummary(manifest);
  const staticScaffold = targetScene && wiring.found && !wiring.invalid && scaffoldReceipt.valid
    ? 'complete'
    : targetScene || wiring.found ? 'partial' : 'pending';
  let phase = 'implement-core';
  if (!freshness.fresh) phase = 'stale-source';
  else if (staticScaffold !== 'complete') phase = 'static-scaffold';
  else if (report.invalid || report.counts.high > 0) phase = 'repair-static-output';
  else if (checkpoints.targetBound === checkpoints.total && checkpoints.verificationBound < checkpoints.total) phase = 'collect-evidence';
  else if (checkpoints.verificationBound === checkpoints.total && checkpoints.pass === checkpoints.total) phase = 'ready-for-acceptance';

  const nextActions = [];
  const addAction = value => {
    if (value && nextActions.length < 8 && !nextActions.includes(value)) nextActions.push(value);
  };
  if (!freshness.fresh) {
    addAction('Unity source/receipt đã đổi: chạy lại ai:port:core:scaffold với --force trước khi tiếp tục implementation.');
  } else if (targetScene && wiring.found && !scaffoldReceipt.valid) {
    addAction(`Scene/wiring không có provenance hợp lệ (${scaffoldReceipt.code}); không reuse mù. Đối chiếu output rồi regenerate trên target sạch.`);
  } else if (!targetScene && !wiring.found) {
    addAction('Chạy ai:port:core:scaffold để sinh scene khung và wiring report bằng static parser.');
  } else if (targetScene && !wiring.found) {
    addAction('Target scene đã có nhưng thiếu wiring; không overwrite mù. Đối chiếu scene rồi chạy port.scene với manifest riêng hoặc khởi tạo lại trên target sạch.');
  } else if (!targetScene && wiring.found) {
    addAction('Wiring tồn tại nhưng target scene thiếu; kiểm tra thay đổi ngoài luồng trước khi scaffold lại.');
  }
  for (const item of wiring.todo) addAction(`Wiring ${item.kind} (${item.nodeCount} node): ${item.label}`);
  for (const item of report.codes.filter(entry => entry.severity === 'high')) addAction(`${item.code} (${item.count}x): ${item.action}`);
  for (const item of report.codes.filter(entry => entry.severity === 'medium')) addAction(`${item.code} (${item.count}x): ${item.action}`);
  if (!config) addAction('Tạo assets/resources/playable-config.json và chuyển toàn bộ tuning/gameplay/CTA vào config.');
  if (!scripts) addAction('Chạy port.closure + port.compile trên closure gameplay; chỉ dùng port.script khi compile không thể tạo first pass.');
  if (freshness.fresh && staticScaffold === 'complete' && report.counts.high === 0 && checkpoints.targetBound < checkpoints.total) {
    addAction('Refine static output, bind targetEvidence cho checkpoint, rồi chạy verify visual/runtime theo oracle nguồn.');
  }
  if (freshness.fresh && checkpoints.targetBound === checkpoints.total && checkpoints.verificationBound < checkpoints.total) {
    addAction('Thu runtime/visual evidence schema v1; mandatory input/rules/win-lose phải dùng runtime evidence.');
  }
  if (phase === 'ready-for-acceptance') addAction('Chạy ai:port:core:verify; chỉ kết luận runnable/fidelity khi acceptance pass.');

  return {
    schemaVersion: RESUME_PACKET_SCHEMA_VERSION,
    kind: RESUME_PACKET_KIND,
    generatedAt: new Date().toISOString(),
    sessionId: `port:${hashBytes(`${manifest.source.briefId}\n${manifest.source.stateFingerprint}\n${manifest.delivery.targetEntryScene}`).slice(0, 24)}`,
    phase,
    sourceFresh: freshness,
    manifest: { path: relativeSlash(cocosRoot, file), sha256: hashFile(file) },
    source: {
      briefId: manifest.source.briefId,
      stateFingerprint: manifest.source.stateFingerprint,
      entryScene: manifest.source.entryScene,
    },
    staticFirst: {
      status: staticScaffold,
      targetScene: { path: manifest.delivery.targetEntryScene, exists: targetScene },
      wiring,
      receipt: scaffoldReceipt,
    },
    implementation: { scriptsPresent: scripts, configPresent: config, checkpoints },
    reports: { port: report },
    nextActions,
    tokenBudgetHints: {
      consumeFirst: [options.packet || DEFAULT_RESUME_PACKET, wiringRelative, '.unity/port-report.csv via ai:port:report'],
      avoid: ['full Unity YAML/C# dumps', 'whole-project recursive reads', 'raw port-report.csv in chat'],
      boundedSlices: { wiringTodo: 8, reportCodes: 8, nextActions: 8 },
      queryRawSourceOnlyWhen: 'preflight evidenceQueries hoặc một wiring/report action cần semantic refinement',
    },
  };
}

function persistResumePacket(cocosRoot, relative, packet) {
  const file = resolveContained(cocosRoot, relative || DEFAULT_RESUME_PACKET);
  const existed = fs.existsSync(file);
  const expectedHash = existed ? hashFile(file) : null;
  atomicWriteJson(cocosRoot, file, packet, { force: existed, expectedHash });
  return relativeSlash(cocosRoot, file);
}

function runStaticScenePort(unityRoot, cocosRoot, manifest, options = {}, dependencies = {}) {
  const sceneFile = resolveContained(unityRoot, manifest.source.entryScene, { mustExist: true });
  const outFile = resolveContained(cocosRoot, manifest.delivery.targetEntryScene);
  const wiringFile = resolveContained(cocosRoot, options.wiring || DEFAULT_WIRING);
  const targetExists = fs.existsSync(outFile);
  const wiringExists = fs.existsSync(wiringFile);
  if (targetExists || wiringExists) {
    const receipt = inspectStaticScaffoldReceipt(cocosRoot, manifest, options);
    return {
      ok: targetExists && wiringExists && receipt.valid,
      status: targetExists && wiringExists && receipt.valid ? 'reused' : 'partial-existing-output',
      targetScene: manifest.delivery.targetEntryScene,
      wiring: relativeSlash(cocosRoot, wiringFile),
      receipt,
    };
  }
  const run = dependencies.runStaticScene || ((request) => {
    const child = spawnSync(process.execPath, [
      path.join(__dirname, 'unity-scene-port.cjs'),
      '--scene', request.sceneFile,
      '--unity-root', request.unityAssets,
      '--out', request.outFile,
      '--manifest', request.wiringFile,
      '--json',
    ], {
      cwd: request.cocosRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: GATE_TIMEOUT_MS,
      maxBuffer: GATE_MAX_BUFFER_BYTES,
      shell: false,
    });
    return { ok: child.status === 0 && !child.error, child };
  });
  const result = run({ sceneFile, unityAssets: path.join(unityRoot, 'Assets'), outFile, wiringFile, cocosRoot });
  if (!result || result.ok !== true || !fs.existsSync(outFile) || !fs.existsSync(wiringFile)) {
    const child = result && result.child || {};
    throw corePortError('CORE_PORT_STATIC_SCAFFOLD_FAILED', 'Static scene scaffold không sinh đủ scene + wiring.', {
      output: redactOutput(`${child.stdout || ''}\n${child.stderr || ''}\n${child.error || ''}`, [unityRoot, cocosRoot]),
    });
  }
  const receipt = persistStaticScaffoldReceipt(cocosRoot, manifest, options);
  return { ok: true, status: 'created', targetScene: manifest.delivery.targetEntryScene, wiring: relativeSlash(cocosRoot, wiringFile), receipt: { valid: true, path: receipt } };
}

async function scaffoldCorePort(options, dependencies = {}) {
  const unityRoot = validateUnityRoot(options.unityProject);
  const cocosRoot = validateCocosRoot(options.cocosProject);
  const file = manifestPath(cocosRoot, options.manifest);
  if (options.dryRun) {
    const initialized = await initCorePort({ ...options, provider: options.provider || 'static', dryRun: true }, dependencies);
    return {
      ...initialized,
      command: 'scaffold',
      staticFirst: { status: 'planned', targetScene: options.targetScene || targetScenePath(initialized.source.entryScene), wiring: options.wiring || DEFAULT_WIRING },
      packet: { written: false, path: options.packet || DEFAULT_RESUME_PACKET },
    };
  }
  if (!fs.existsSync(file) || options.force) {
    await initCorePort({ ...options, provider: options.provider || 'static', force: !!options.force }, dependencies);
  } else {
    const existing = validateManifest(cocosRoot, file);
    const freshness = inspectSourceFreshness(unityRoot, existing, dependencies);
    if (!freshness.fresh) {
      throw corePortError('CORE_PORT_MANIFEST_STALE', 'Manifest/receipt cũ; chạy scaffold --force để tái tạo từ static preflight mới.', freshness);
    }
  }
  const manifest = validateManifest(cocosRoot, file);
  const staticFirst = runStaticScenePort(unityRoot, cocosRoot, manifest, options, dependencies);
  const packet = buildResumePacket({ ...options, unityProject: unityRoot, cocosProject: cocosRoot }, dependencies);
  const packetPath = persistResumePacket(cocosRoot, options.packet || DEFAULT_RESUME_PACKET, packet);
  return { ok: staticFirst.ok, command: 'scaffold', manifest: relativeSlash(cocosRoot, file), staticFirst, packet: { written: true, path: packetPath, phase: packet.phase }, nextActions: packet.nextActions };
}

function resumeCorePort(options, dependencies = {}) {
  const cocosRoot = validateCocosRoot(options.cocosProject);
  const packet = buildResumePacket(options, dependencies);
  const packetPath = options.packet || DEFAULT_RESUME_PACKET;
  const written = options.write === true && options.dryRun !== true;
  if (written) persistResumePacket(cocosRoot, packetPath, packet);
  return { ok: packet.sourceFresh.fresh && packet.staticFirst.status === 'complete' && !(packet.reports.port.invalid || packet.reports.port.counts.high > 0), command: 'resume', packet: { ...packet, persisted: written, path: packetPath } };
}

function readJsonBounded(file, maxBytes, code) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > maxBytes) throw corePortError(code, `JSON evidence khong hop le hoac vuot ${maxBytes} bytes.`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {
    throw corePortError(code, 'JSON evidence khong doc duoc.');
  }
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateLogicalPath(value, kind) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_PATH_CHARS ||
      value.includes('\\') || /[\0-\x1f]/.test(value) || path.posix.isAbsolute(value) ||
      path.win32.isAbsolute(value) || path.posix.normalize(value) !== value || value.split('/').includes('..')) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', `${kind} evidence path khong an toan.`);
  }
  if (kind === 'source' && !/^(?:Assets|Packages)\//.test(value)) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', 'Source evidence chi duoc nam trong Assets/ hoac Packages/.');
  }
  if (kind === 'target' && !/^assets\//.test(value)) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', 'Target evidence chi duoc nam trong assets/.');
  }
  if (kind === 'verification' && !/^\.ai\/port\/evidence\/.+\.json$/i.test(value)) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', 'Verification evidence chi duoc nam trong .ai/port/evidence/*.json.');
  }
  return value;
}

function validatePathArray(value, kind, checkpointId) {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_PATHS || new Set(value).size !== value.length) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', `${checkpointId}: ${kind} evidence phai unique va <=${MAX_EVIDENCE_PATHS}.`);
  }
  for (const item of value) validateLogicalPath(item, kind);
}

function validateEngineFeatureClosure(value) {
  // Schema-v3 manifests written before this gate remain readable. Every new
  // manifest contains this field, and if present it is validated as source
  // evidence rather than trusted as an arbitrary list of profile keys.
  if (value === undefined) return;
  if (!value || value.schemaVersion !== 1 || !['required', 'not-required'].includes(value.status) ||
      !Array.isArray(value.requiredModules) || value.requiredModules.length > 64 ||
      new Set(value.requiredModules).size !== value.requiredModules.length ||
      value.disabledModules !== undefined && (!Array.isArray(value.disabledModules) || value.disabledModules.length > 64 ||
        new Set(value.disabledModules).size !== value.disabledModules.length) ||
      !value.selectors || typeof value.selectors !== 'object' ||
      !Array.isArray(value.evidence) || !Array.isArray(value.blockers) || value.blockers.length !== 0) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', 'Unity-derived engine feature closure khong hop le.');
  }
  const disabledModules = value.disabledModules || [];
  for (const moduleName of [...value.requiredModules, ...disabledModules]) {
    if (typeof moduleName !== 'string' || moduleName.length > 96 || !ENGINE_FEATURE_ID.test(moduleName)) {
      throw corePortError('CORE_PORT_MANIFEST_INVALID', `Engine feature id khong an toan: ${String(moduleName)}`);
    }
  }
  if (disabledModules.some(moduleName => value.requiredModules.includes(moduleName))) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', 'Engine feature khong the vua required vua disabled.');
  }
  if ((value.status === 'not-required') !== (value.requiredModules.length === 0 && disabledModules.length === 0)) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', 'Engine feature closure status khong khop requiredModules.');
  }
  const selectors = value.selectors;
  const selectorContract = [
    ['physicsBackend', PHYSICS_BACKENDS, null],
    ['physics2dBackend', PHYSICS_2D_BACKENDS, null],
    ['spineBackend', SPINE_BACKENDS, null],
  ];
  for (const [key, allowed, empty] of selectorContract) {
    if (selectors[key] !== empty && !allowed.includes(selectors[key])) {
      throw corePortError('CORE_PORT_MANIFEST_INVALID', `Engine feature selector ${key} khong hop le.`);
    }
  }
  const required = new Set(value.requiredModules);
  const selectorPairs = [
    ['physicsBackend', null, PHYSICS_BACKENDS],
    ['physics2dBackend', 'physics-2d', PHYSICS_2D_BACKENDS],
    ['spineBackend', 'spine', SPINE_BACKENDS],
  ];
  for (const [key, parent, alternatives] of selectorPairs) {
    const selected = selectors[key];
    const requiredAlternatives = alternatives.filter(item => required.has(item));
    if (!selected && requiredAlternatives.length !== 0) {
      throw corePortError('CORE_PORT_MANIFEST_INVALID', `Engine feature selector ${key} bi thieu.`);
    }
    if (selected && (!required.has(selected) || requiredAlternatives.length !== 1 ||
        (parent && !required.has(parent)))) {
      throw corePortError('CORE_PORT_MANIFEST_INVALID', `Engine feature selector ${key} khong nam trong requiredModules.`);
    }
  }
  if (value.evidence.length !== value.requiredModules.length ||
      new Set(value.evidence.map(item => item && item.module)).size !== value.evidence.length) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', 'Engine feature evidence phai co dung mot record cho moi module.');
  }
  for (const item of value.evidence) {
    if (!item || !required.has(item.module) || !Array.isArray(item.sources) || item.sources.length > 3 ||
        !Array.isArray(item.signals) || item.signals.length > 4 ||
        new Set(item.sources).size !== item.sources.length || new Set(item.signals).size !== item.signals.length) {
      throw corePortError('CORE_PORT_MANIFEST_INVALID', 'Engine feature evidence record khong hop le.');
    }
    for (const source of item.sources) validateLogicalPath(source, 'source');
    for (const signal of item.signals) {
      if (typeof signal !== 'string' || !signal || signal.length > 160 || /[\0-\x1f]/.test(signal)) {
        throw corePortError('CORE_PORT_MANIFEST_INVALID', 'Engine feature evidence signal khong hop le.');
      }
    }
  }
}

function validateManifest(cocosRoot, file) {
  const manifest = readJsonBounded(file, MAX_MANIFEST_BYTES, 'CORE_PORT_MANIFEST_INVALID');
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION || manifest.kind !== MANIFEST_KIND ||
      manifest.profile !== 'playable-core' || !manifest.source || !manifest.delivery || !Array.isArray(manifest.checkpoints)) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', 'Manifest sai schema/kind/profile.');
  }
  for (const key of ['briefId', 'receiptId', 'projectFingerprint', 'stateFingerprint', 'entryScene']) {
    if (typeof manifest.source[key] !== 'string' || !manifest.source[key] || manifest.source[key].length > MAX_PATH_CHARS) {
      throw corePortError('CORE_PORT_MANIFEST_INVALID', `Manifest source.${key} khong hop le.`);
    }
  }
  validateLogicalPath(manifest.source.entryScene, 'source');
  if (manifest.delivery.minimumFidelity !== 80 || manifest.delivery.targetFidelity !== 90) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', 'Fidelity threshold bi thay doi; minimum/target bat buoc la 80/90.');
  }
  const evidenceContract = manifest.delivery.evidenceContract;
  if (!evidenceContract || evidenceContract.schemaVersion !== EVIDENCE_SCHEMA_VERSION ||
      evidenceContract.kind !== EVIDENCE_KIND || !arraysEqual(evidenceContract.methods || [], EVIDENCE_METHODS) ||
      !arraysEqual(evidenceContract.binds || [], ['briefId', 'stateFingerprint', 'checkpoint', 'targetHashes'])) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', 'Checkpoint evidence contract bi thay doi.');
  }
  validateLogicalPath(manifest.delivery.targetEntryScene, 'target');
  if (!manifest.delivery.targetEntryScene.endsWith('.scene')) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', 'delivery.targetEntryScene phai la Cocos .scene.');
  }
  const expectedArtifacts = [
    manifest.delivery.targetEntryScene,
    'assets/script/**/*.ts',
    'assets/resources/playable-config.json',
    'build/common/**/*.html',
  ];
  const expectedGates = REQUIRED_SCRIPTS.map(item => item.id);
  if (!Array.isArray(manifest.delivery.requiredArtifacts) ||
      !arraysEqual(manifest.delivery.requiredArtifacts, expectedArtifacts) ||
      !Array.isArray(manifest.delivery.requiredGates) ||
      !arraysEqual(manifest.delivery.requiredGates, expectedGates)) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', 'Runnable artifact/gate contract bi thay doi.');
  }
  validateEngineFeatureClosure(manifest.engineFeatures);
  if (manifest.checkpoints.length !== FIDELITY_CHECKPOINTS.length ||
      new Set(manifest.checkpoints.map(item => item.id)).size !== FIDELITY_CHECKPOINTS.length) {
    throw corePortError('CORE_PORT_MANIFEST_INVALID', `Manifest phai co dung ${FIDELITY_CHECKPOINTS.length} fidelity checkpoints.`);
  }
  for (let index = 0; index < FIDELITY_CHECKPOINTS.length; index += 1) {
    const expected = FIDELITY_CHECKPOINTS[index];
    const checkpoint = manifest.checkpoints[index];
    if (checkpoint.id !== expected.id || checkpoint.weight !== expected.weight ||
        checkpoint.mandatory !== expected.mandatory ||
        !['pending', 'pass', 'fail', 'out-of-scope'].includes(checkpoint.status) ||
        !Array.isArray(checkpoint.sourceEvidence) || !Array.isArray(checkpoint.targetEvidence) ||
        !Array.isArray(checkpoint.verificationEvidence)) {
      throw corePortError('CORE_PORT_MANIFEST_INVALID', `Checkpoint khong hop le: ${checkpoint.id}`);
    }
    validatePathArray(checkpoint.sourceEvidence, 'source', checkpoint.id);
    validatePathArray(checkpoint.targetEvidence, 'target', checkpoint.id);
    validatePathArray(checkpoint.verificationEvidence, 'verification', checkpoint.id);
  }
  return manifest;
}

function safeUnityEvidence(unityRoot, logical) {
  const normalized = String(logical || '').replace(/\\/g, '/');
  if (!/^(?:Assets|Packages)\//.test(normalized) || normalized.includes('../')) return false;
  try {
    const candidate = resolveContained(unityRoot, normalized, { mustExist: true });
    return fs.statSync(candidate).isFile();
  } catch (_) { return false; }
}

function currentTargetHashes(cocosRoot, targetEvidence) {
  const hashes = [];
  for (const relative of [...targetEvidence].sort()) {
    let file;
    try { file = resolveContained(cocosRoot, relative, { mustExist: true }); } catch (_) { return null; }
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    hashes.push({ path: relative, sha256: hashFile(file) });
  }
  return hashes;
}

function boundedObservation(value) {
  return typeof value === 'string' && value.trim().length >= 8 && value.length <= MAX_OBSERVATION_CHARS &&
    !/[\0-\x08\x0b\x0c\x0e-\x1f]/.test(value);
}

function checkpointEvidencePasses(cocosRoot, relative, checkpoint, manifest) {
  let file;
  try { file = resolveContained(cocosRoot, relative, { mustExist: true }); } catch (_) { return false; }
  let payload;
  try { payload = readJsonBounded(file, MAX_EVIDENCE_BYTES, 'CORE_PORT_EVIDENCE_INVALID'); } catch (_) { return false; }
  if (payload.schemaVersion !== EVIDENCE_SCHEMA_VERSION || payload.kind !== EVIDENCE_KIND || payload.ok !== true ||
      payload.checkpoint !== checkpoint.id || payload.briefId !== manifest.source.briefId ||
      payload.stateFingerprint !== manifest.source.stateFingerprint || !EVIDENCE_METHODS.includes(payload.method) ||
      !payload.observations || !boundedObservation(payload.observations.source) ||
      !boundedObservation(payload.observations.target) || !Array.isArray(payload.targetHashes)) return false;
  if (payload.method === 'visual' && !VISUAL_ONLY_ALLOWED.has(checkpoint.id)) return false;
  if (checkpoint.mandatory && payload.method === 'visual') return false;
  const current = currentTargetHashes(cocosRoot, checkpoint.targetEvidence);
  if (!current || payload.targetHashes.length !== current.length) return false;
  if (payload.targetHashes.some(item => !item || typeof item !== 'object')) return false;
  const projected = payload.targetHashes
    .map(item => ({ path: item.path, sha256: item.sha256 }))
    // Match currentTargetHashes' locale-independent UTF-16 ordering exactly.
    // localeCompare can order `assets/.../core/*` before `assets/.../Harvest*`
    // on one machine while Array#sort orders the uppercase segment first,
    // producing a false stale-evidence failure with identical hashes.
    .sort((left, right) => String(left.path) < String(right.path) ? -1
      : String(left.path) > String(right.path) ? 1 : 0);
  return projected.every((item, index) => item.path === current[index].path &&
    typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256) && item.sha256 === current[index].sha256);
}

function evaluateFidelity(manifest, unityRoot, cocosRoot) {
  const items = [];
  let score = 0;
  for (const checkpoint of manifest.checkpoints) {
    const sourceRequired = checkpoint.id !== 'playable-lifecycle-cta';
    const source = !sourceRequired || checkpoint.sourceEvidence.length > 0 &&
      checkpoint.sourceEvidence.every(item => safeUnityEvidence(unityRoot, item));
    const target = checkpoint.targetEvidence.length > 0 && checkpoint.targetEvidence.every(item => {
      try {
        const file = resolveContained(cocosRoot, item, { mustExist: true });
        return fs.statSync(file).isFile();
      } catch (_) { return false; }
    });
    const verification = checkpoint.verificationEvidence.length > 0 &&
      checkpoint.verificationEvidence.some(item => checkpointEvidencePasses(cocosRoot, item, checkpoint, manifest));
    const grounded = checkpoint.status === 'pass' && source && target && verification;
    if (grounded) score += checkpoint.weight;
    items.push({
      id: checkpoint.id,
      weight: checkpoint.weight,
      mandatory: !!checkpoint.mandatory,
      grounded,
      missing: [!source && 'source', !target && 'target', !verification && 'runtime-or-visual'].filter(Boolean),
    });
  }
  const mandatoryPassed = items.filter(item => item.mandatory).every(item => item.grounded);
  return { score, target: manifest.delivery.targetFidelity, minimum: manifest.delivery.minimumFidelity, mandatoryPassed, items };
}

function redactOutput(value, roots) {
  let output = String(value || '').replace(/\x1b\[[0-9;]*m/g, '');
  for (const root of roots) {
    if (!root) continue;
    output = output.split(root).join('<project>');
    output = output.split(root.replace(/\\/g, '/')).join('<project>');
  }
  output = output
    .replace(/(["']?authorization["']?\s*:\s*["']?(?:bearer\s+)?)[^\s"',}]+/gi, '$1<redacted>')
    .replace(/(["']?(?:api[_-]?key|token|secret|password)["']?\s*[=:]\s*["']?)[^\s"',}]+/gi, '$1<redacted>');
  return output.trim().split(/\r?\n/).slice(-8).join('\n').slice(-2000);
}

function runRequiredGates(cocosRoot, options = {}) {
  const packageFile = resolveContained(cocosRoot, 'package.json', { mustExist: true });
  const packageJson = readJsonBounded(packageFile, MAX_PACKAGE_BYTES, 'CORE_PORT_PACKAGE_INVALID');
  const scripts = packageJson.scripts || {};
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    throw corePortError('CORE_PORT_PACKAGE_INVALID', 'package.json scripts khong hop le.');
  }
  const platform = options.platform || process.platform;
  // Node cannot execute Windows .cmd shims directly with shell:false on every
  // supported runtime (Node 22 returns EINVAL). Invoke npm.cmd through the
  // platform command processor while keeping the fixed gate/script arguments
  // separate and shell:false. Gate names come only from REQUIRED_SCRIPTS.
  const executable = platform === 'win32'
    ? (options.comspec || process.env.ComSpec || 'cmd.exe')
    : 'npm';
  const prefixArgs = platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd'] : [];
  const requiredScripts = options.previewOnly ? PREVIEW_REQUIRED_SCRIPTS : REQUIRED_SCRIPTS;
  const results = [];
  for (const gate of requiredScripts) {
    if (typeof scripts[gate.script] !== 'string' || !scripts[gate.script].trim()) {
      results.push({ id: gate.id, ok: false, code: 'script-missing', script: gate.script });
      break;
    }
    const gateArgs = options.previewOnly && gate.id === 'verify.all'
      ? ['--', '--skip-build-size']
      : options.previewOnly && gate.id === 'verify.runtime'
        ? ['--', '--url', normalizePreviewUrl(options.previewUrl || DEFAULT_PREVIEW_URL)]
        : [];
    const child = (options.spawnSync || spawnSync)(executable, [...prefixArgs, 'run', gate.script, ...gateArgs], {
      cwd: cocosRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: options.timeoutMs || GATE_TIMEOUT_MS,
      maxBuffer: GATE_MAX_BUFFER_BYTES,
      shell: false,
    });
    const ok = child.status === 0 && !child.error;
    const timedOut = !!(child.error && child.error.code === 'ETIMEDOUT');
    results.push({
      id: gate.id,
      script: gate.script,
      ok,
      exitCode: Number.isInteger(child.status) ? child.status : null,
      signal: child.signal || undefined,
      timedOut: timedOut || undefined,
      code: child.error && child.error.code || undefined,
      output: ok ? undefined : redactOutput(
        `${child.stdout || ''}\n${child.stderr || ''}\n${child.error || ''}`,
        [cocosRoot, ...(options.redactRoots || [])],
      ),
    });
    if (!ok) break;
  }
  return results;
}

function hasArtifact(root, predicate) {
  if (!fs.existsSync(root)) return false;
  const boundary = fs.realpathSync.native(root);
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      let stat;
      try { stat = fs.lstatSync(full); } catch (_) { continue; }
      if (stat.isSymbolicLink()) continue;
      let real;
      try { real = fs.realpathSync.native(full); } catch (_) { continue; }
      if (!isPathInside(boundary, real)) continue;
      if (entry.isDirectory()) { stack.push(full); continue; }
      if (predicate(full)) return true;
    }
  }
  return false;
}

function existingContainedFile(root, relative) {
  try {
    const file = resolveContained(root, relative, { mustExist: true });
    return fs.statSync(file).isFile();
  } catch (_) { return false; }
}

function inspectRequiredArtifacts(cocosRoot, manifest, options = {}) {
  const assets = path.join(cocosRoot, 'assets');
  const mandatoryTargets = manifest.checkpoints
    .filter(item => item.mandatory)
    .flatMap(item => item.targetEvidence)
    .filter(item => /^assets\/script\/.+\.ts$/i.test(item));
  const artifacts = {
    scene: existingContainedFile(cocosRoot, manifest.delivery.targetEntryScene),
    gameplayScript: mandatoryTargets.length > 0 && mandatoryTargets.every(item => existingContainedFile(cocosRoot, item)),
    config: existingContainedFile(cocosRoot, 'assets/resources/playable-config.json'),
  };
  if (!options.previewOnly) {
    artifacts.builtHtml = hasArtifact(path.join(cocosRoot, 'build', 'common'), file => /\.html?$/i.test(file));
  }
  return artifacts;
}

function verifyCorePort(options, dependencies = {}) {
  const unityRoot = validateUnityRoot(options.unityProject);
  const cocosRoot = validateCocosRoot(options.cocosProject);
  const file = manifestPath(cocosRoot, options.manifest);
  resolveContained(cocosRoot, file, { mustExist: true });
  const manifest = validateManifest(cocosRoot, file);
  const gate = dependencies.assertPreflight || assertUnityPortPreflight;
  const receipt = gate(path.join(unityRoot, 'Assets'), { projectRoot: unityRoot });
  if (receipt.receipt.receiptId !== manifest.source.receiptId || receipt.receipt.briefId !== manifest.source.briefId ||
      receipt.receipt.stateFingerprint !== manifest.source.stateFingerprint) {
    throw corePortError('CORE_PORT_MANIFEST_STALE', 'Manifest khong khop preflight receipt/source hien tai; chay init --force lai.');
  }
  const fidelity = evaluateFidelity(manifest, unityRoot, cocosRoot);
  const previewOnly = options.previewOnly === true;
  const requiredScripts = previewOnly ? PREVIEW_REQUIRED_SCRIPTS : REQUIRED_SCRIPTS;
  const gateResults = options.runGates === false
    ? []
    : (dependencies.runGates || runRequiredGates)(cocosRoot, {
      ...(dependencies.gateOptions || {}),
      previewOnly,
      previewUrl: previewOnly ? normalizePreviewUrl(options.previewUrl || DEFAULT_PREVIEW_URL) : undefined,
      redactRoots: [unityRoot, ...((dependencies.gateOptions && dependencies.gateOptions.redactRoots) || [])],
    });
  const gatesPassed = gateResults.length === requiredScripts.length && gateResults.every(item => item.ok);
  const artifacts = inspectRequiredArtifacts(cocosRoot, manifest, { previewOnly });
  const artifactKeys = previewOnly ? ['scene', 'gameplayScript', 'config'] : Object.keys(artifacts);
  const artifactsPassed = artifactKeys.every(key => artifacts[key]);
  const evidenceAccepted = gatesPassed && artifactsPassed && fidelity.mandatoryPassed && fidelity.score >= fidelity.minimum;
  const accepted = !previewOnly && evidenceAccepted;
  const previewAccepted = previewOnly && evidenceAccepted;
  const previewRunnable = previewOnly && gatesPassed && artifactsPassed;
  return {
    ok: previewOnly ? previewAccepted : accepted,
    command: 'verify',
    mode: previewOnly ? 'preview-only' : 'build',
    status: previewOnly
      ? (previewAccepted ? 'preview-accepted' : 'preview-blocked')
      : (accepted ? 'accepted' : 'blocked'),
    accepted,
    previewAccepted,
    runnable: {
      passed: previewOnly ? false : gatesPassed && artifactsPassed,
      gatesRun: options.runGates !== false,
      gates: gateResults,
      artifacts,
      ...(previewOnly ? { reason: 'preview-only mode does not establish build runnable status' } : {}),
    },
    previewRunnable: {
      passed: previewRunnable,
      status: previewRunnable ? 'preview-runnable' : 'preview-not-runnable',
      url: previewOnly ? normalizePreviewUrl(options.previewUrl || DEFAULT_PREVIEW_URL) : null,
      gatesRun: previewOnly && options.runGates !== false,
      artifacts: Object.fromEntries(artifactKeys.map(key => [key, artifacts[key]])),
    },
    fidelity,
    evidenceContract: manifest.delivery.evidenceContract,
    claim: previewOnly
      ? previewAccepted
        ? `Core gameplay preview-accepted at ${fidelity.score}/100 and preview-runnable; build acceptance was not run and is not claimed.`
        : 'Do not claim preview acceptance or preview-runnable delivery until every reported preview gate passes; build acceptance was not run.'
      : accepted
        ? `Core gameplay accepted at ${fidelity.score}/100 (target ${fidelity.target}).`
        : 'Do not claim 80-90% fidelity or runnable delivery until every reported gate passes.',
    nextActions: [
      ...fidelity.items.filter(item => !item.grounded).slice(0, 5).map(item =>
        `Add schema-v${EVIDENCE_SCHEMA_VERSION} ${item.mandatory ? 'runtime' : 'runtime/visual'} evidence for ${item.id}: ${item.missing.join(', ')}`),
      ...gateResults.filter(item => !item.ok).map(item => `Fix ${item.id}`),
      ...artifactKeys.filter(id => !artifacts[id]).map(id => `Create/import ${id}`),
    ].slice(0, 8),
  };
}

async function execute(options, dependencies = {}) {
  if (options.command === 'init') return initCorePort(options, dependencies);
  if (options.command === 'scaffold') return scaffoldCorePort(options, dependencies);
  if (options.command === 'resume') return resumeCorePort(options, dependencies);
  return verifyCorePort(options, dependencies);
}

async function main() {
  require('./lib/auto-strip-ansi.cjs');
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { console.log(USAGE); return; }
    const startedAt = Date.now();
    const result = await execute(options, {
      onProgress(event) {
        console.error(`[core-port] ${event.stage}:${event.status} ${Date.now() - startedAt}ms`);
      },
    });
    console.log(JSON.stringify(result, null, options.json ? 0 : 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const payload = { ok: false, code: error.code || 'CORE_PORT_FAILED', message: error.message, details: error.details || undefined };
    console.error(JSON.stringify(payload));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_KIND,
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_KIND,
  DEFAULT_MANIFEST,
  RESUME_PACKET_SCHEMA_VERSION,
  RESUME_PACKET_KIND,
  DEFAULT_WIRING,
  DEFAULT_STATIC_SCAFFOLD_RECEIPT,
  DEFAULT_RESUME_PACKET,
  STATIC_SCAFFOLD_RECEIPT_KIND,
  MAX_MANIFEST_BYTES,
  MAX_EVIDENCE_BYTES,
  REQUIRED_SCRIPTS,
  PREVIEW_REQUIRED_SCRIPTS,
  DEFAULT_PREVIEW_URL,
  parseArgs,
  normalizePreviewUrl,
  validateUnityRoot,
  validateCocosRoot,
  resolveContained,
  hashFile,
  atomicWriteJson,
  targetScenePath,
  createManifest,
  checkpointSourcesFromBrief,
  regressionRisksFromBrief,
  ensureRegressionRegistry,
  enforceEngineFeatureClosure,
  initCorePort,
  summarizeWiring,
  summarizePortReport,
  inspectStaticScaffoldReceipt,
  persistStaticScaffoldReceipt,
  inspectSourceFreshness,
  checkpointSummary,
  buildResumePacket,
  persistResumePacket,
  runStaticScenePort,
  scaffoldCorePort,
  resumeCorePort,
  validateManifest,
  currentTargetHashes,
  checkpointEvidencePasses,
  evaluateFidelity,
  runRequiredGates,
  inspectRequiredArtifacts,
  verifyCorePort,
  execute,
};
