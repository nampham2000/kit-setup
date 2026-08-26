#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { isPathInside } = require('./lib/path-boundary.cjs');
const { runUnityPortPreflight, assertUnityPortPreflight } = require('./unity-intel/preflight.cjs');
const { FIDELITY_CHECKPOINTS } = require('./unity-intel/core-gameplay-scope.cjs');

const MANIFEST_SCHEMA_VERSION = 2;
const MANIFEST_KIND = 'cc-playable-core-port-manifest';
const EVIDENCE_SCHEMA_VERSION = 1;
const EVIDENCE_KIND = 'cc-playable-core-checkpoint-evidence';
const DEFAULT_MANIFEST = '.ai/port/core-gameplay.json';
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_EVIDENCE_BYTES = 256 * 1024;
const MAX_PACKAGE_BYTES = 256 * 1024;
const MAX_EVIDENCE_PATHS = 8;
const MAX_PATH_CHARS = 512;
const MAX_OBSERVATION_CHARS = 1200;
const GATE_TIMEOUT_MS = 10 * 60 * 1000;
const GATE_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const EVIDENCE_METHODS = Object.freeze(['runtime', 'visual', 'runtime-visual']);
const VISUAL_ONLY_ALLOWED = new Set(['camera-layout', 'animation-vfx-feedback']);
const REQUIRED_SCRIPTS = Object.freeze([
  Object.freeze({ id: 'verify.all', script: 'ai:verify' }),
  Object.freeze({ id: 'verify.gc', script: 'ai:lint' }),
  Object.freeze({ id: 'verify.assets', script: 'ai:verify:assets' }),
  Object.freeze({ id: 'build.playable', script: 'build' }),
  Object.freeze({ id: 'verify.runtime', script: 'ai:verify:runtime' }),
]);

const USAGE = `Core Gameplay Port

Usage:
  node playable-shared-kit/tools/core-gameplay-port.cjs init --unity-project <root> [--cocos-project <root>] [options]
  node playable-shared-kit/tools/core-gameplay-port.cjs verify --unity-project <root> [--cocos-project <root>] [options]

Commands:
  init     Run mandatory playable-core preflight and write a compact evidence manifest.
  verify   Run verify/lint/assets/build/runtime gates and accept only evidence-backed fidelity >=80.

Options:
  --unity-project <dir>  Complete Unity project root (required).
  --cocos-project <dir>  Cocos playable root. Default: current directory.
  --manifest <file>      Relative path inside Cocos project. Default: ${DEFAULT_MANIFEST}.
  --provider <mode>      auto | static | unity-mcp. Default: auto.
  --bootstrap            Allow Unity-MCP package setup/reload during init.
  --force                Replace an existing manifest during init.
  --dry-run              Init without creating a directory or file.
  --no-run-gates         Verify manifest only; result cannot be accepted as runnable.
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
  if (!['init', 'verify'].includes(options.command)) {
    if (argv.includes('--help') || argv.includes('-h')) return { ...options, help: true };
    throw corePortError('CORE_PORT_COMMAND_INVALID', 'Command phai la init hoac verify.');
  }
  for (; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    if (argument === '--json') { options.json = true; continue; }
    if (argument === '--bootstrap') { options.bootstrap = true; continue; }
    if (argument === '--force') { options.force = true; continue; }
    if (argument === '--dry-run') { options.dryRun = true; continue; }
    if (argument === '--no-run-gates') { options.runGates = false; continue; }
    const equal = /^--([a-z-]+)=(.*)$/.exec(argument);
    const name = equal ? equal[1] : argument.startsWith('--') ? argument.slice(2) : null;
    if (!['unity-project', 'cocos-project', 'manifest', 'provider'].includes(name)) {
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
  return options;
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
      fs.linkSync(temp, file);
      try { fs.unlinkSync(temp); } catch (_) { /* linked target is already complete */ }
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

function createManifest(brief) {
  const core = brief.coreGameplay;
  const targetEntryScene = targetScenePath(core.entry.primary);
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
  const file = manifestPath(cocosRoot, options.manifest);
  const existed = fs.existsSync(file);
  const expectedHash = existed ? hashFile(file) : null;
  if (existed && !options.force) {
    throw corePortError('CORE_PORT_MANIFEST_EXISTS', `Manifest da ton tai: ${relativeSlash(cocosRoot, file)}. Dung --force neu muon tao lai.`);
  }
  brief.coreGameplayCheckpointEvidence = checkpointSourcesFromBrief(brief);
  const manifest = createManifest(brief);
  if (!options.dryRun) {
    progress({ stage: 'manifest', status: 'start' });
    atomicWriteJson(cocosRoot, file, manifest, { force: !!options.force, expectedHash });
    progress({ stage: 'manifest', status: 'complete' });
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
    next: options.dryRun
      ? 'Run init without --dry-run.'
      : `Implement only this manifest, then run core verify; do not claim fidelity before score >=${manifest.delivery.minimumFidelity}.`,
  };
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
    .sort((left, right) => String(left.path).localeCompare(String(right.path)));
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
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const results = [];
  for (const gate of REQUIRED_SCRIPTS) {
    if (typeof scripts[gate.script] !== 'string' || !scripts[gate.script].trim()) {
      results.push({ id: gate.id, ok: false, code: 'script-missing', script: gate.script });
      break;
    }
    const child = (options.spawnSync || spawnSync)(executable, ['run', gate.script], {
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

function inspectRequiredArtifacts(cocosRoot, manifest) {
  const assets = path.join(cocosRoot, 'assets');
  const mandatoryTargets = manifest.checkpoints
    .filter(item => item.mandatory)
    .flatMap(item => item.targetEvidence)
    .filter(item => /^assets\/script\/.+\.ts$/i.test(item));
  return {
    scene: existingContainedFile(cocosRoot, manifest.delivery.targetEntryScene),
    gameplayScript: mandatoryTargets.length > 0 && mandatoryTargets.every(item => existingContainedFile(cocosRoot, item)),
    config: existingContainedFile(cocosRoot, 'assets/resources/playable-config.json'),
    builtHtml: hasArtifact(path.join(cocosRoot, 'build', 'common'), file => /\.html?$/i.test(file)),
  };
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
  const gateResults = options.runGates === false
    ? []
    : (dependencies.runGates || runRequiredGates)(cocosRoot, {
      ...(dependencies.gateOptions || {}),
      redactRoots: [unityRoot, ...((dependencies.gateOptions && dependencies.gateOptions.redactRoots) || [])],
    });
  const gatesPassed = gateResults.length === REQUIRED_SCRIPTS.length && gateResults.every(item => item.ok);
  const artifacts = inspectRequiredArtifacts(cocosRoot, manifest);
  const artifactsPassed = Object.values(artifacts).every(Boolean);
  const accepted = gatesPassed && artifactsPassed && fidelity.mandatoryPassed && fidelity.score >= fidelity.minimum;
  return {
    ok: accepted,
    command: 'verify',
    accepted,
    runnable: { passed: gatesPassed && artifactsPassed, gatesRun: options.runGates !== false, gates: gateResults, artifacts },
    fidelity,
    evidenceContract: manifest.delivery.evidenceContract,
    claim: accepted
      ? `Core gameplay accepted at ${fidelity.score}/100 (target ${fidelity.target}).`
      : 'Do not claim 80-90% fidelity or runnable delivery until every reported gate passes.',
    nextActions: [
      ...fidelity.items.filter(item => !item.grounded).slice(0, 5).map(item =>
        `Add schema-v${EVIDENCE_SCHEMA_VERSION} ${item.mandatory ? 'runtime' : 'runtime/visual'} evidence for ${item.id}: ${item.missing.join(', ')}`),
      ...gateResults.filter(item => !item.ok).map(item => `Fix ${item.id}`),
      ...Object.entries(artifacts).filter(([, ok]) => !ok).map(([id]) => `Create/import ${id}`),
    ].slice(0, 8),
  };
}

async function execute(options, dependencies = {}) {
  if (options.command === 'init') return initCorePort(options, dependencies);
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
  MAX_MANIFEST_BYTES,
  MAX_EVIDENCE_BYTES,
  REQUIRED_SCRIPTS,
  parseArgs,
  validateUnityRoot,
  validateCocosRoot,
  resolveContained,
  hashFile,
  atomicWriteJson,
  targetScenePath,
  createManifest,
  checkpointSourcesFromBrief,
  initCorePort,
  validateManifest,
  currentTargetHashes,
  checkpointEvidencePasses,
  evaluateFidelity,
  runRequiredGates,
  inspectRequiredArtifacts,
  verifyCorePort,
  execute,
};
