#!/usr/bin/env node
'use strict';

/**
 * Portable Port Regression Gate
 * =============================
 *
 * A project-owned registry declares the Unity -> Cocos regressions that must
 * stay covered. The shared kit validates the oracle contract for each risk,
 * refreshes the Cocos preview, executes every mandatory matrix, and writes a
 * receipt bound to the exact bytes of the registry, matrices, and watched
 * target files. A later code/config/asset change therefore invalidates the
 * receipt instead of silently reusing an old PASS.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createMcpClient, unwrapToolResult } = require('./cocos-engine-feature-audit.cjs');

const REGISTRY_SCHEMA_VERSION = 1;
const REGISTRY_KIND = 'cc-playable-port-regression-registry';
const RECEIPT_SCHEMA_VERSION = 1;
const RECEIPT_KIND = 'cc-playable-port-regression-receipt';
const DEFAULT_CONFIG = 'tools/port-regressions.json';
const DEFAULT_RECEIPT = '.ai/port/regression-receipt.json';
const DEFAULT_OUTPUT = '.unity/port-regressions';
const MAX_REGISTRY_BYTES = 256 * 1024;
const MAX_MATRIX_BYTES = 512 * 1024;
const MAX_SUITES = 64;
const MAX_WATCH_FILES = 64;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const RUN_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

const RISKS = Object.freeze([
  'input-response',
  'input-concurrency',
  'hold-drag-composition',
  'raycast-occlusion',
  'camera-transform',
  'material-color-lighting',
  'transparent-hold-state',
  'animation-callback-flow',
  'animation-curve-fidelity',
  'runtime-mesh-animation',
  'attachment-layout',
  'font-ui-layout',
  'progress-ui-state',
  'responsive-layout',
  'level-lifecycle',
]);
const RISK_SET = new Set(RISKS);
const VISUAL_REFERENCE_RISKS = new Set([
  'camera-transform',
  'material-color-lighting',
  'transparent-hold-state',
  'animation-curve-fidelity',
  'runtime-mesh-animation',
  'attachment-layout',
  'font-ui-layout',
  'progress-ui-state',
]);
const SEMANTIC_RISKS = new Set([
  'input-response',
  'input-concurrency',
  'hold-drag-composition',
  'raycast-occlusion',
  'camera-transform',
  'attachment-layout',
  'transparent-hold-state',
  'runtime-mesh-animation',
  'progress-ui-state',
  'responsive-layout',
  'level-lifecycle',
]);

const USAGE = `Portable Port Regression Gate

Usage:
  node playable-shared-kit/tools/port-regression-gate.cjs init [options]
  node playable-shared-kit/tools/port-regression-gate.cjs run [options]
  node playable-shared-kit/tools/port-regression-gate.cjs check [options]

Options:
  --project <dir>       Cocos project root. Default: shared-kit host project.
  --config <file>       Tracked registry path. Default: ${DEFAULT_CONFIG}.
  --receipt <file>      Machine receipt path. Default: ${DEFAULT_RECEIPT}.
  --output <dir>        Matrix evidence root. Default: ${DEFAULT_OUTPUT}.
  --risk <id>           Required risk for init; repeatable.
  --suite <id>          Re-run one suite and merge it into a current hash-bound receipt; repeatable.
  --force               Replace an existing registry during init.
  --no-refresh          Intentionally skip Cocos AssetDB/preview refresh.
  --json                Emit compact JSON.
  --help                Show this help.

The tracked registry owns risk coverage; the ignored receipt owns one machine's
current run. run fails closed when a mandatory suite lacks the oracle required by
its risk. check never opens a browser: it only proves that an existing PASS still
matches the current registry, matrices, and watched target bytes.`;

function regressionError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function parseArgs(argv) {
  const options = { command: null, risks: [], suites: [], refresh: true, json: false };
  let index = 0;
  if (argv[0] && !argv[0].startsWith('-')) {
    options.command = argv[0];
    index = 1;
  }
  if (!options.command && (argv.includes('--help') || argv.includes('-h'))) return { ...options, help: true };
  if (!['init', 'run', 'check'].includes(options.command)) {
    throw regressionError('REGRESSION_COMMAND_INVALID', 'Command phải là init, run hoặc check.');
  }
  for (; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    if (argument === '--json') { options.json = true; continue; }
    if (argument === '--force') { options.force = true; continue; }
    if (argument === '--no-refresh') { options.refresh = false; continue; }
    const equal = /^--([a-z-]+)=(.*)$/.exec(argument);
    const name = equal ? equal[1] : argument.startsWith('--') ? argument.slice(2) : null;
    if (!['project', 'config', 'receipt', 'output', 'risk', 'suite'].includes(name)) {
      throw regressionError('REGRESSION_OPTION_INVALID', `Option không hỗ trợ: ${argument}`);
    }
    const value = equal ? equal[2] : argv[++index];
    if (!value || value.startsWith('--')) {
      throw regressionError('REGRESSION_OPTION_VALUE_REQUIRED', `--${name} cần giá trị.`);
    }
    if (name === 'risk') options.risks.push(value);
    else if (name === 'suite') options.suites.push(value);
    else options[name] = value;
  }
  return options;
}

function findHostProject(start = __dirname) {
  let cursor = path.resolve(start);
  while (cursor !== path.dirname(cursor)) {
    if (fs.existsSync(path.join(cursor, 'package.json')) && fs.existsSync(path.join(cursor, 'assets'))) return cursor;
    cursor = path.dirname(cursor);
  }
  throw regressionError('REGRESSION_PROJECT_INVALID', 'Không tìm thấy Cocos project chứa package.json và assets/.');
}

function validateProjectRoot(value) {
  const candidate = path.resolve(value || findHostProject());
  if (!fs.existsSync(candidate)) throw regressionError('REGRESSION_PROJECT_INVALID', 'Cocos project không tồn tại.');
  const root = fs.realpathSync.native(candidate);
  if (!fs.statSync(path.join(root, 'package.json')).isFile() || !fs.statSync(path.join(root, 'assets')).isDirectory()) {
    throw regressionError('REGRESSION_PROJECT_INVALID', 'Cocos project cần package.json và assets/.');
  }
  return root;
}

function resolveContained(root, value, label, options = {}) {
  const text = String(value || '');
  if (!text || path.isAbsolute(text) || path.win32.isAbsolute(text) || /[\0-\x1f]/.test(text)) {
    throw regressionError('REGRESSION_PATH_INVALID', `${label} phải là relative path trong project: ${text}`);
  }
  const resolved = path.resolve(root, text);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw regressionError('REGRESSION_PATH_ESCAPE', `${label} thoát khỏi project: ${text}`);
  }
  const rootReal = fs.realpathSync.native(root);
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      throw regressionError('REGRESSION_PATH_REDIRECT', `${label} không được đi qua symlink/junction: ${text}`);
    }
    const real = fs.realpathSync.native(cursor);
    const realRelative = path.relative(rootReal, real);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw regressionError('REGRESSION_PATH_REDIRECT', `${label} realpath thoát khỏi project: ${text}`);
    }
  }
  if (options.mustExist && !fs.existsSync(resolved)) {
    throw regressionError('REGRESSION_PATH_MISSING', `Không tìm thấy ${label}: ${text}`);
  }
  return resolved;
}

function readJsonBounded(file, maxBytes, code) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > maxBytes) throw regressionError(code, `JSON vượt giới hạn ${maxBytes} bytes.`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (error) {
    throw regressionError(code, `JSON không đọc được: ${error.message}`);
  }
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function normalizeRiskList(values, label) {
  if (!Array.isArray(values) || values.length < 1 || values.length > RISKS.length) {
    throw regressionError('REGRESSION_RISKS_INVALID', `${label} phải có 1-${RISKS.length} risk.`);
  }
  const normalized = values.map(value => String(value || '').trim());
  if (normalized.some(value => !RISK_SET.has(value))) {
    throw regressionError('REGRESSION_RISK_UNKNOWN', `${label} có risk không hỗ trợ: ${normalized.filter(value => !RISK_SET.has(value)).join(', ')}`);
  }
  if (new Set(normalized).size !== normalized.length) {
    throw regressionError('REGRESSION_RISKS_INVALID', `${label} không được trùng risk.`);
  }
  return normalized;
}

function caseHasEval(entry) {
  return entry.requireEvalOk === true && !!(entry.eval || entry.evalFile);
}

function caseHasInputGesture(entry) {
  return !!entry.gesture
    || (Array.isArray(entry.gestures) && entry.gestures.length > 0)
    || !!entry.gestureFromEvalBefore
    || (Array.isArray(entry.gesturesFromEvalBefore) && entry.gesturesFromEvalBefore.length > 0);
}

function metricBoundAtLeast(contract, metric, bound) {
  const value = Number(contract?.[metric]?.min);
  return Number.isFinite(value) && value >= bound;
}

function metricBoundAtMost(contract, metric, bound) {
  const value = Number(contract?.[metric]?.max);
  return Number.isFinite(value) && value <= bound;
}

function caseHasRuntimeMeshOracle(entry) {
  return caseHasInputGesture(entry) && caseHasEval(entry) && !!entry.referenceImage
    && entry.requireEvalBeforeOk === true && !!(entry.evalBefore || entry.evalBeforeFile)
    && Array.isArray(entry.requiredTrace) && entry.requiredTrace.length >= 2
    && metricBoundAtLeast(entry.requiredEvalBeforeMetrics, 'actionStarted', 0)
    && metricBoundAtMost(entry.requiredEvalBeforeMetrics, 'actionStarted', 0)
    && metricBoundAtLeast(entry.requiredEvalMetrics, 'actionStarted', 1)
    && metricBoundAtLeast(entry.requiredEvalMetrics, 'longitudinalUvSpan', 0.85)
    && metricBoundAtMost(entry.requiredEvalMetrics, 'longitudinalUvMaxError', 0.001)
    && metricBoundAtMost(entry.requiredEvalMetrics, 'positionError', 0.05)
    && metricBoundAtLeast(entry.requiredEvalMetrics, 'directionDot', 0.9)
    && metricBoundAtMost(entry.requiredEvalMetrics, 'rootScaleError', 0.02)
    && metricBoundAtMost(entry.requiredEvalMetrics, 'thicknessError', 0.02);
}

function caseHasInputConcurrencyOracle(entry) {
  const gestureCount = Array.isArray(entry.gestures) ? entry.gestures.length
    : (Array.isArray(entry.gesturesFromEvalBefore) ? entry.gesturesFromEvalBefore.length : 0);
  return gestureCount >= 2 && caseHasEval(entry)
    && entry.requireEvalBeforeOk === true && !!(entry.evalBefore || entry.evalBeforeFile)
    && metricBoundAtLeast(entry.requiredEvalBeforeMetrics, 'actionStarted', 0)
    && metricBoundAtMost(entry.requiredEvalBeforeMetrics, 'actionStarted', 0)
    && metricBoundAtLeast(entry.requiredEvalMetrics, 'actionStarted', 2)
    && metricBoundAtLeast(entry.requiredEvalMetrics, 'concurrentActions', 2)
    && metricBoundAtLeast(entry.requiredEvalMetrics, 'secondStartsBeforeFirstCompletes', 1)
    && metricBoundAtLeast(entry.requiredEvalMetrics, 'uniqueReservedDestinationCount', 2)
    && metricBoundAtMost(entry.requiredEvalMetrics, 'reservationCollisionCount', 0);
}

function caseHasResponsiveLayoutMetrics(entry) {
  return caseHasEval(entry)
    && metricBoundAtMost(entry.requiredEvalMetrics, 'layoutOverlapMax', 0.01)
    && metricBoundAtMost(entry.requiredEvalMetrics, 'slicedBorderInsetError', 0.001);
}

function validateResponsiveLayoutOracle(suite, matrix) {
  const sourceCase = matrix.cases.find(entry =>
    (entry.regressionTags || []).includes('source-viewport')
    && !!entry.referenceImage
    && entry.requiredReferenceMetrics
    && Object.keys(entry.requiredReferenceMetrics).length > 0
    && caseHasResponsiveLayoutMetrics(entry));
  const shortCase = matrix.cases.find(entry =>
    (entry.regressionTags || []).includes('short-wide-viewport')
    && typeof entry.windowSize === 'string'
    && entry.windowSize.trim()
    && caseHasResponsiveLayoutMetrics(entry));
  if (!sourceCase || !shortCase || String(sourceCase.windowSize || matrix.windowSize || '') === String(shortCase.windowSize || matrix.windowSize || '')) {
    throw regressionError('REGRESSION_RESPONSIVE_LAYOUT_ORACLE_MISSING',
      `${suite.id}: responsive-layout cần source-viewport có Unity reference + reference metrics và `
      + 'short-wide-viewport khác windowSize; cả hai case phải có semantic eval cùng bounds '
      + 'layoutOverlapMax<=0.01 và slicedBorderInsetError<=0.001.');
  }
}

function validateAnimationCurveOracle(file, label) {
  const oracle = readJsonBounded(file, MAX_MATRIX_BYTES, 'REGRESSION_ANIMATION_ORACLE_INVALID');
  if (!oracle || oracle.schemaVersion !== 1 || oracle.kind !== 'unity-animation-curve-oracle'
      || oracle.completeness !== 'complete'
      || !Array.isArray(oracle.clips) || oracle.clips.length < 1
      || Number(oracle.clipCount ?? oracle.clips.length) !== oracle.clips.length
      || (oracle.diagnostics || []).some(item => item?.severity === 'high')) {
    throw regressionError('REGRESSION_ANIMATION_ORACLE_INVALID',
      `${label}: animationOracle phải complete, không có high diagnostic và có clipCount khớp clips.`);
  }
  for (const [index, clip] of oracle.clips.entries()) {
    const source = String(clip?.source || '');
    if (!/^(Assets|Packages)\//.test(source) || source.split('/').includes('..')
        || path.isAbsolute(source) || path.win32.isAbsolute(source)
        || !/^[a-f0-9]{64}$/.test(String(clip?.sha256 || ''))
        || !Number.isFinite(Number(clip?.duration)) || Number(clip.duration) <= 0
        || typeof clip?.loop !== 'boolean' || clip?.completeness !== 'complete'
        || !Array.isArray(clip?.tracks) || clip.tracks.length < 1) {
      throw regressionError('REGRESSION_ANIMATION_ORACLE_INVALID',
        `${label}: clips[${index}] cần source portable, sha256, duration, loop và tracks.`);
    }
  }
  return oracle;
}

function caseHasAnimationCurveOracle(entry, validatedCases) {
  return validatedCases.has(entry) && caseHasEval(entry) && !!entry.referenceImage
    && Array.isArray(entry.requiredTrace) && entry.requiredTrace.length >= 2
    && metricBoundAtMost(entry.requiredEvalMetrics, 'crossAxisMaxError', 0.02)
    && metricBoundAtMost(entry.requiredEvalMetrics, 'curveExtremaMaxError', 0.1)
    && metricBoundAtMost(entry.requiredEvalMetrics, 'singleShotPhaseCountError', 0)
    && metricBoundAtMost(entry.requiredEvalMetrics, 'timingMaxErrorMs', 100)
    && metricBoundAtLeast(entry.requiredEvalMetrics, 'oracleClipCount', 1);
}

function validateMatrixPolicy(projectRoot, suite, matrix, matrixFile) {
  if (!matrix || typeof matrix !== 'object' || !Array.isArray(matrix.cases) || matrix.cases.length < 1) {
    throw regressionError('REGRESSION_MATRIX_INVALID', `${suite.id}: matrix cần ít nhất một case.`);
  }
  if (!/^https?:\/\//i.test(String(matrix.url || ''))) {
    throw regressionError('REGRESSION_MATRIX_INVALID', `${suite.id}: matrix chỉ được dùng Cocos preview URL http(s).`);
  }
  const names = new Set();
  const tags = new Set();
  const animationOracleCases = new Set();
  const dependencyMap = new Map();
  const addDependency = (value, label) => {
    const file = resolveContained(projectRoot, value, label, { mustExist: true });
    const relative = path.relative(projectRoot, file).replace(/\\/g, '/');
    dependencyMap.set(relative, { relative, file });
  };
  for (const [index, entry] of matrix.cases.entries()) {
    if (!entry || typeof entry !== 'object' || !String(entry.name || '').trim()) {
      throw regressionError('REGRESSION_MATRIX_INVALID', `${suite.id}: cases[${index}] thiếu name.`);
    }
    const name = String(entry.name).trim();
    if (names.has(name)) throw regressionError('REGRESSION_MATRIX_INVALID', `${suite.id}: case name bị trùng: ${name}`);
    names.add(name);
    if (caseHasInputGesture(entry) && !caseHasEval(entry)) {
      throw regressionError('REGRESSION_ORACLE_REQUIRED', `${suite.id}/${name}: gesture cần eval/evalFile + requireEvalOk=true.`);
    }
    if ((entry.gestureFromEvalBefore || entry.gesturesFromEvalBefore)
      && !(entry.evalBefore || entry.evalBeforeFile)) {
      throw regressionError('REGRESSION_ORACLE_REQUIRED',
        `${suite.id}/${name}: gestureFromEvalBefore cần evalBefore/evalBeforeFile runtime evidence.`);
    }
    if (entry.requiredTrace && (!Array.isArray(entry.requiredTrace) || entry.requiredTrace.length < 2 || !caseHasEval(entry))) {
      throw regressionError('REGRESSION_TRACE_REQUIRED', `${suite.id}/${name}: requiredTrace cần >=2 phase và semantic eval.`);
    }
    if (entry.evalFile) addDependency(entry.evalFile, `${suite.id}.evalFile`);
    if (entry.evalBeforeFile) addDependency(entry.evalBeforeFile, `${suite.id}.evalBeforeFile`);
    if (entry.referenceImage) addDependency(entry.referenceImage, `${suite.id}.referenceImage`);
    if (entry.animationOracle) {
      const oracleFile = resolveContained(projectRoot, entry.animationOracle,
        `${suite.id}.animationOracle`, { mustExist: true });
      validateAnimationCurveOracle(oracleFile, `${suite.id}/${name}`);
      addDependency(entry.animationOracle, `${suite.id}.animationOracle`);
      animationOracleCases.add(entry);
    }
    if (entry.regressionTags !== undefined && (!Array.isArray(entry.regressionTags) ||
        entry.regressionTags.some(tag => typeof tag !== 'string' || !tag.trim()))) {
      throw regressionError('REGRESSION_MATRIX_INVALID', `${suite.id}/${name}: regressionTags phải là string array.`);
    }
    for (const tag of entry.regressionTags || []) tags.add(tag.trim());
  }
  for (const risk of suite.risks) {
    if (SEMANTIC_RISKS.has(risk) && !matrix.cases.some(caseHasEval)) {
      throw regressionError('REGRESSION_SEMANTIC_ORACLE_MISSING', `${suite.id}: risk ${risk} cần ít nhất một semantic eval.`);
    }
    if (VISUAL_REFERENCE_RISKS.has(risk) && !matrix.cases.some(entry => !!entry.referenceImage)) {
      throw regressionError('REGRESSION_REFERENCE_MISSING', `${suite.id}: risk ${risk} cần ảnh Unity reference.`);
    }
    if (risk === 'input-response' && !matrix.cases.some(entry => caseHasInputGesture(entry) && caseHasEval(entry))) {
      throw regressionError('REGRESSION_INPUT_GESTURE_MISSING', `${suite.id}: input-response cần real gesture và semantic eval.`);
    }
    if (risk === 'input-concurrency' && !matrix.cases.some(caseHasInputConcurrencyOracle)) {
      throw regressionError('REGRESSION_INPUT_CONCURRENCY_ORACLE_MISSING',
        `${suite.id}: input-concurrency cần >=2 real gestures, pre-action proof và bounded metrics `
        + 'cho concurrent action, ordering và destination reservation uniqueness.');
    }
    if (risk === 'hold-drag-composition' && !matrix.cases.some(entry =>
      caseHasInputGesture(entry) && Number(entry.gestureHoldBeforeMoveMs) > 0 && caseHasEval(entry))) {
      throw regressionError('REGRESSION_HOLD_DRAG_ORACLE_MISSING', `${suite.id}: hold-drag cần gestureHoldBeforeMoveMs > 0 và semantic eval.`);
    }
    if (risk === 'raycast-occlusion' && !['positive', 'negative'].every(tag => matrix.cases.some(entry =>
      (entry.regressionTags || []).includes(tag) && caseHasInputGesture(entry) && caseHasEval(entry)))) {
      throw regressionError('REGRESSION_RAYCAST_POLARITY_MISSING', `${suite.id}: raycast cần case tag positive và negative.`);
    }
    if (risk === 'transparent-hold-state' && !matrix.cases.some(entry =>
      caseHasInputGesture(entry) && entry.gestureKeepPressed === true && caseHasEval(entry))) {
      throw regressionError('REGRESSION_TRANSPARENT_HOLD_MISSING', `${suite.id}: transparent hold cần gestureKeepPressed=true và semantic eval.`);
    }
    if (risk === 'animation-callback-flow' && !matrix.cases.some(entry =>
      Array.isArray(entry.requiredTrace) && entry.requiredTrace.length >= 2 && caseHasEval(entry))) {
      throw regressionError('REGRESSION_ANIMATION_TRACE_MISSING', `${suite.id}: animation flow cần requiredTrace có thứ tự.`);
    }
    if (risk === 'animation-curve-fidelity' && !matrix.cases.some(entry =>
      caseHasAnimationCurveOracle(entry, animationOracleCases))) {
      throw regressionError('REGRESSION_ANIMATION_CURVE_ORACLE_MISSING',
        `${suite.id}: animation-curve-fidelity cần animationOracle + Unity reference + ordered trace và metric bounds `
        + 'cho cross-axis, curve extrema, one-shot phase count, timing và oracle clip count.');
    }
    if (risk === 'runtime-mesh-animation') {
      const missingPathCases = ['linear-path', 'curved-path'].filter(tag => !matrix.cases.some(entry =>
        (entry.regressionTags || []).includes(tag) && caseHasRuntimeMeshOracle(entry)));
      if (missingPathCases.length) {
        throw regressionError('REGRESSION_RUNTIME_MESH_ORACLE_MISSING',
          `${suite.id}: runtime-mesh-animation cần real-gesture linear-path + curved-path, Unity reference, `
          + 'pre/post action proof, ordered trace và metric bounds cho UV span/error, position, direction, root scale, thickness.',
        { missingPathCases });
      }
      const watchedExtensions = new Set(suite.watchFiles.map(file => path.extname(file).toLowerCase()));
      const watchesCode = watchedExtensions.has('.ts') || watchedExtensions.has('.js');
      const watchesRenderAsset = ['.effect', '.prefab', '.fbx', '.mesh', '.mtl']
        .some(extension => watchedExtensions.has(extension));
      if (!watchesCode || !watchesRenderAsset) {
        throw regressionError('REGRESSION_RUNTIME_MESH_WATCH_MISSING',
          `${suite.id}: runtime-mesh-animation phải watch code và ít nhất một render asset/effect/prefab.`);
      }
    }
    if (risk === 'responsive-layout') {
      validateResponsiveLayoutOracle(suite, matrix);
    }
    if (risk === 'level-lifecycle' && suite.runs < 2) {
      throw regressionError('REGRESSION_ROUNDS_REQUIRED', `${suite.id}: level-lifecycle phải chạy ít nhất 2 rounds.`);
    }
    if (risk === 'level-lifecycle' && !matrix.cases.some(entry =>
      (entry.regressionTags || []).includes('win') && caseHasEval(entry))) {
      throw regressionError('REGRESSION_WIN_RECEIPT_MISSING', `${suite.id}: level-lifecycle cần case tag win với semantic receipt.`);
    }
  }
  return {
    file: matrixFile,
    value: matrix,
    hash: hashFile(matrixFile),
    caseCount: matrix.cases.length,
    dependencies: [...dependencyMap.values()],
  };
}

function validateRegistry(projectRoot, value, options = {}) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== REGISTRY_SCHEMA_VERSION || value.kind !== REGISTRY_KIND) {
    throw regressionError('REGRESSION_REGISTRY_INVALID', `Registry phải là ${REGISTRY_KIND} schema v${REGISTRY_SCHEMA_VERSION}.`);
  }
  const requiredRisks = normalizeRiskList(value.requiredRisks, 'requiredRisks');
  if (!Array.isArray(value.suites) || value.suites.length < 1 || value.suites.length > MAX_SUITES) {
    throw regressionError('REGRESSION_SUITES_INVALID', `Registry cần 1-${MAX_SUITES} suite.`);
  }
  const ids = new Set();
  const suites = value.suites.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw regressionError('REGRESSION_SUITE_INVALID', `suites[${index}] phải là object.`);
    const id = String(entry.id || '').trim();
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(id) || ids.has(id)) {
      throw regressionError('REGRESSION_SUITE_INVALID', `Suite id không hợp lệ hoặc trùng: ${id}`);
    }
    ids.add(id);
    const risks = normalizeRiskList(entry.risks, `${id}.risks`);
    const mandatory = entry.mandatory !== false;
    const runs = entry.runs === undefined ? 1 : Number(entry.runs);
    if (!Number.isInteger(runs) || runs < 1 || runs > 5) {
      throw regressionError('REGRESSION_RUNS_INVALID', `${id}.runs phải nằm trong 1-5.`);
    }
    if (!Array.isArray(entry.watchFiles) || entry.watchFiles.length < 1 || entry.watchFiles.length > MAX_WATCH_FILES) {
      throw regressionError('REGRESSION_WATCH_INVALID', `${id}.watchFiles phải có 1-${MAX_WATCH_FILES} file.`);
    }
    const watchFiles = [...new Set(entry.watchFiles.map(item => String(item || '').replace(/\\/g, '/')))];
    if (watchFiles.length !== entry.watchFiles.length) throw regressionError('REGRESSION_WATCH_INVALID', `${id}.watchFiles không được trùng.`);
    const watch = watchFiles.map(relative => {
      const file = resolveContained(projectRoot, relative, `${id}.watchFiles`, { mustExist: true });
      if (!fs.statSync(file).isFile()) throw regressionError('REGRESSION_WATCH_INVALID', `${id}.watchFiles chỉ nhận file: ${relative}`);
      return { relative, file, hash: hashFile(file) };
    });
    const matrixRelative = String(entry.matrix || '').replace(/\\/g, '/');
    const matrixFile = resolveContained(projectRoot, matrixRelative, `${id}.matrix`, { mustExist: true });
    const matrix = readJsonBounded(matrixFile, MAX_MATRIX_BYTES, 'REGRESSION_MATRIX_INVALID');
    const normalized = { id, risks, mandatory, runs, matrix: matrixRelative, watchFiles, watch };
    normalized.matrixEvidence = validateMatrixPolicy(projectRoot, normalized, matrix, matrixFile);
    return normalized;
  });
  const uncovered = requiredRisks.filter(risk => !suites.some(suite => suite.mandatory && suite.risks.includes(risk)));
  if (uncovered.length) {
    throw regressionError('REGRESSION_RISK_UNCOVERED', `Mandatory suite chưa cover: ${uncovered.join(', ')}`);
  }
  return { schemaVersion: REGISTRY_SCHEMA_VERSION, kind: REGISTRY_KIND, requiredRisks, suites, raw: value, configFile: options.configFile };
}

function registrySnapshot(projectRoot, registry) {
  const relative = file => path.relative(projectRoot, file).replace(/\\/g, '/');
  const snapshot = {
    registry: { path: relative(registry.configFile), hash: hashFile(registry.configFile) },
    suites: registry.suites.map(suite => ({
      id: suite.id,
      matrix: { path: suite.matrix, hash: hashFile(suite.matrixEvidence.file) },
      matrixDependencies: suite.matrixEvidence.dependencies.map(item => ({ path: item.relative, hash: hashFile(item.file) })),
      watchFiles: suite.watch.map(item => ({ path: item.relative, hash: hashFile(item.file) })),
    })),
  };
  return { ...snapshot, digest: digest(snapshot) };
}

function portableFileList(projectRoot, registry) {
  const values = [path.relative(projectRoot, registry.configFile).replace(/\\/g, '/')];
  for (const suite of registry.suites) {
    values.push(suite.matrix, ...suite.watchFiles, ...suite.matrixEvidence.dependencies.map(item => item.relative));
  }
  return [...new Set(values)].sort();
}

function assertPortableRegistry(projectRoot, registry, options = {}) {
  const run = options.spawnSync || spawnSync;
  const rootResult = run('git', ['-C', projectRoot, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024, shell: false,
  });
  if (rootResult.status !== 0 || rootResult.error || !String(rootResult.stdout || '').trim()) {
    throw regressionError('REGRESSION_PORTABILITY_UNPROVEN', 'Project phải nằm trong Git để chứng minh registry/evidence portable qua checkout.');
  }
  const gitRoot = fs.realpathSync.native(String(rootResult.stdout).trim());
  const projectPrefix = path.relative(gitRoot, projectRoot).replace(/\\/g, '/');
  if (projectPrefix.startsWith('..') || path.isAbsolute(projectPrefix)) {
    throw regressionError('REGRESSION_PORTABILITY_UNPROVEN', 'Cocos project nằm ngoài Git root.');
  }
  const projectFiles = portableFileList(projectRoot, registry);
  const gitFiles = projectFiles.map(file => projectPrefix ? `${projectPrefix}/${file}` : file);
  const tracked = new Set();
  for (let index = 0; index < gitFiles.length; index += 40) {
    const batch = gitFiles.slice(index, index + 40);
    const result = run('git', ['-C', gitRoot, 'ls-files', '--cached', '--', ...batch], {
      encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 256 * 1024, shell: false,
    });
    if (result.status !== 0 || result.error) {
      throw regressionError('REGRESSION_PORTABILITY_UNPROVEN', `Không đọc được Git index: ${result.error && result.error.message || result.stderr || 'git failed'}`);
    }
    for (const line of String(result.stdout || '').split(/\r?\n/).filter(Boolean)) tracked.add(line.replace(/\\/g, '/'));
  }
  const missing = gitFiles.filter(file => !tracked.has(file));
  if (missing.length) {
    throw regressionError('REGRESSION_FILES_UNTRACKED', 'Registry/matrix/oracle/watchFiles phải được git add/commit để máy khác nhận cùng gate.', {
      files: missing.slice(0, 16),
      count: missing.length,
    });
  }
  return { ok: true, gitRoot, files: gitFiles.length };
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}${os.EOL}`, { encoding: 'utf8', flag: 'wx' });
  try { fs.renameSync(temp, file); } catch (error) {
    try { fs.unlinkSync(temp); } catch (_) { /* best effort */ }
    throw error;
  }
}

function initialRegistry(risks = []) {
  const selected = risks.length ? normalizeRiskList([...new Set(risks)], '--risk') : ['input-response', 'level-lifecycle'];
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    kind: REGISTRY_KIND,
    requiredRisks: selected,
    suites: [],
    instructions: {
      matrix: 'Mỗi suite trỏ tới một verify.visual matrix được commit cùng project.',
      watchFiles: 'Liệt kê TS/config/effect/font/prefab quyết định hành vi; đổi byte nào receipt cũng stale.',
      next: 'Thêm mandatory suites cover mọi requiredRisks rồi chạy npm run ai:verify:regressions.',
      supportedRisks: RISKS,
    },
  };
}

function initRegistry(options = {}) {
  const projectRoot = validateProjectRoot(options.project);
  const configFile = resolveContained(projectRoot, options.config || DEFAULT_CONFIG, 'config');
  if (fs.existsSync(configFile) && !options.force) {
    throw regressionError('REGRESSION_REGISTRY_EXISTS', `Registry đã tồn tại: ${path.relative(projectRoot, configFile)}`);
  }
  const value = initialRegistry(options.risks || []);
  atomicWriteJson(configFile, value);
  return {
    ok: true,
    command: 'init',
    registry: path.relative(projectRoot, configFile).replace(/\\/g, '/'),
    requiredRisks: value.requiredRisks,
    ready: false,
    nextActions: ['Thêm mandatory suites + matrix/watchFiles cho mọi requiredRisks; registry rỗng chủ ý chưa được PASS.'],
  };
}

function mergeRegistryRequiredRisks(options = {}) {
  const projectRoot = validateProjectRoot(options.project);
  const configFile = resolveContained(projectRoot, options.config || DEFAULT_CONFIG, 'config', { mustExist: true });
  const value = readJsonBounded(configFile, MAX_REGISTRY_BYTES, 'REGRESSION_REGISTRY_INVALID');
  if (!value || value.schemaVersion !== REGISTRY_SCHEMA_VERSION || value.kind !== REGISTRY_KIND || !Array.isArray(value.requiredRisks)) {
    throw regressionError('REGRESSION_REGISTRY_INVALID', 'Không thể merge risk vào registry sai schema/kind.');
  }
  const current = normalizeRiskList(value.requiredRisks, 'requiredRisks');
  const requested = normalizeRiskList(options.risks || [], 'risks');
  const merged = [...new Set([...current, ...requested])];
  if (merged.length === current.length) {
    return { ok: true, status: 'reused', registry: path.relative(projectRoot, configFile).replace(/\\/g, '/'), requiredRisks: current };
  }
  atomicWriteJson(configFile, { ...value, requiredRisks: merged });
  return { ok: true, status: 'updated', registry: path.relative(projectRoot, configFile).replace(/\\/g, '/'), requiredRisks: merged };
}

function loadRegistry(projectRoot, options = {}) {
  const configFile = resolveContained(projectRoot, options.config || DEFAULT_CONFIG, 'config', { mustExist: true });
  const value = readJsonBounded(configFile, MAX_REGISTRY_BYTES, 'REGRESSION_REGISTRY_INVALID');
  return validateRegistry(projectRoot, value, { configFile });
}

async function refreshCocosPreview(projectRoot, options = {}) {
  let client = null;
  try {
    client = await createMcpClient(projectRoot, { timeoutMs: options.timeoutMs || 120_000 });
    const raw = await client.call('editorRuntime_reload_preview', {
      refreshAssets: true,
      assetUrl: 'db://assets',
    });
    if (raw && raw.isError) throw regressionError('REGRESSION_PREVIEW_REFRESH_FAILED', 'Cocos MCP báo reload preview lỗi.');
    const response = unwrapToolResult(raw);
    if (response && (response.success === false || response.ok === false)) {
      throw regressionError('REGRESSION_PREVIEW_REFRESH_FAILED', response.error || response.message || 'Cocos preview refresh failed.');
    }
    return { ok: true, tool: 'editorRuntime_reload_preview' };
  } catch (error) {
    if (error.code === 'REGRESSION_PREVIEW_REFRESH_FAILED') throw error;
    throw regressionError('REGRESSION_PREVIEW_REFRESH_FAILED', `Không refresh/reload được Cocos preview: ${error.message}`);
  } finally {
    if (client) await client.close();
  }
}

function parseJsonOutput(value) {
  const text = String(value || '').trim();
  try { return JSON.parse(text); } catch (_) {
    const start = text.lastIndexOf('\n{');
    if (start >= 0) {
      try { return JSON.parse(text.slice(start + 1)); } catch (_) { /* handled below */ }
    }
  }
  throw regressionError('REGRESSION_MATRIX_OUTPUT_INVALID', 'verify.visual không trả JSON hợp lệ.');
}

function executeMatrix(projectRoot, suite, runNumber, options = {}) {
  const outputRoot = options.output || DEFAULT_OUTPUT;
  const output = path.posix.join(outputRoot.replace(/\\/g, '/'), suite.id, `run-${runNumber}`);
  resolveContained(projectRoot, output, `${suite.id}.output`);
  const child = (options.spawnSync || spawnSync)(process.execPath, [
    path.join(__dirname, 'preview-checkpoints.cjs'),
    '--config', suite.matrix,
    '--output', output,
    '--json',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeoutMs || RUN_TIMEOUT_MS,
    maxBuffer: RUN_MAX_BUFFER_BYTES,
    shell: false,
  });
  const ok = child.status === 0 && !child.error;
  let payload = null;
  try { payload = parseJsonOutput(child.stdout); } catch (error) {
    if (ok) throw error;
  }
  return {
    run: runNumber,
    ok: ok && payload && payload.ok === true,
    exitCode: Number.isInteger(child.status) ? child.status : null,
    timedOut: !!(child.error && child.error.code === 'ETIMEDOUT') || undefined,
    code: child.error && child.error.code || undefined,
    manifest: payload && payload.manifest,
    contactSheet: payload && payload.contactSheet,
    cases: payload && Array.isArray(payload.cases) ? payload.cases.map(entry => ({ name: entry.name, ok: entry.ok })) : [],
    output: ok ? undefined : redactOutput(`${child.stdout || ''}\n${child.stderr || ''}\n${child.error || ''}`, projectRoot),
  };
}

function redactOutput(value, projectRoot) {
  return String(value || '')
    .replaceAll(projectRoot, '<project>')
    .replaceAll(projectRoot.replace(/\\/g, '/'), '<project>')
    .replace(/(["']?(?:authorization|api[_-]?key|token|secret|password)["']?\s*[=:]\s*["']?)[^\s"',}]+/gi, '$1<redacted>')
    .trim().slice(-4000);
}

function readReceipt(projectRoot, options = {}) {
  const file = resolveContained(projectRoot, options.receipt || DEFAULT_RECEIPT, 'receipt', { mustExist: true });
  const value = readJsonBounded(file, MAX_REGISTRY_BYTES, 'REGRESSION_RECEIPT_INVALID');
  if (value.schemaVersion !== RECEIPT_SCHEMA_VERSION || value.kind !== RECEIPT_KIND ||
      !value.snapshot || typeof value.snapshot.digest !== 'string' || !Array.isArray(value.suites)) {
    throw regressionError('REGRESSION_RECEIPT_INVALID', `Receipt phải là ${RECEIPT_KIND} schema v${RECEIPT_SCHEMA_VERSION}.`);
  }
  return { file, value };
}

function checkRegressionReceipt(options = {}) {
  const projectRoot = validateProjectRoot(options.project);
  const registry = loadRegistry(projectRoot, options);
  const portable = options.portabilityCheck === false ? { ok: true, skipped: true } : assertPortableRegistry(projectRoot, registry);
  const current = registrySnapshot(projectRoot, registry);
  const receipt = readReceipt(projectRoot, options);
  const valid = receipt.value.ok === true && receipt.value.snapshot && receipt.value.snapshot.digest === current.digest;
  if (!valid) {
    throw regressionError('REGRESSION_RECEIPT_STALE', 'Regression receipt thiếu, fail, hoặc không khớp code/matrix hiện tại.', {
      expected: current.digest,
      actual: receipt.value.snapshot && receipt.value.snapshot.digest,
    });
  }
  return {
    ok: true,
    command: 'check',
    registry: path.relative(projectRoot, registry.configFile).replace(/\\/g, '/'),
    receipt: path.relative(projectRoot, receipt.file).replace(/\\/g, '/'),
    snapshotDigest: current.digest,
    portable,
    suites: receipt.value.suites.length,
  };
}

async function runRegressionGate(options = {}, dependencies = {}) {
  const projectRoot = validateProjectRoot(options.project);
  const registry = loadRegistry(projectRoot, options);
  const portable = dependencies.assertPortable
    ? await dependencies.assertPortable(projectRoot, registry)
    : assertPortableRegistry(projectRoot, registry);
  const before = registrySnapshot(projectRoot, registry);
  const selectedSuiteIds = [...new Set((options.suites || []).map(value => String(value || '').trim()).filter(Boolean))];
  const selectedSuiteSet = new Set(selectedSuiteIds);
  const unknownSuites = selectedSuiteIds.filter(id => !registry.suites.some(suite => suite.id === id));
  if (unknownSuites.length) {
    throw regressionError('REGRESSION_SUITE_UNKNOWN', `Suite không có trong registry: ${unknownSuites.join(', ')}`);
  }
  let baseReceipt = null;
  let baseResults = new Map();
  if (selectedSuiteIds.length) {
    try {
      baseReceipt = readReceipt(projectRoot, options).value;
    } catch (error) {
      throw regressionError('REGRESSION_SELECTIVE_BASE_REQUIRED', 'Selective suite rerun cần receipt hiện hữu cùng snapshot; chạy full registry trước.', {
        cause: error.code || error.message,
      });
    }
    if (!baseReceipt.snapshot || baseReceipt.snapshot.digest !== before.digest) {
      throw regressionError('REGRESSION_SELECTIVE_BASE_STALE', 'Selective suite rerun không được merge với receipt stale; chạy full registry trước.', {
        expected: before.digest,
        actual: baseReceipt.snapshot && baseReceipt.snapshot.digest,
      });
    }
    baseResults = new Map((baseReceipt.suites || []).map(result => [result.id, result]));
    const missingBaseSuites = registry.suites
      .filter(suite => !selectedSuiteSet.has(suite.id) && !baseResults.has(suite.id))
      .map(suite => suite.id);
    if (missingBaseSuites.length) {
      throw regressionError('REGRESSION_SELECTIVE_BASE_INCOMPLETE', `Receipt base thiếu suite chưa được chọn: ${missingBaseSuites.join(', ')}`);
    }
  }
  const refresh = options.refresh === false
    ? { ok: true, skipped: true, reason: 'explicit --no-refresh' }
    : await (dependencies.refreshPreview || refreshCocosPreview)(projectRoot, dependencies.refreshOptions || {});
  const results = [];
  const executionSuites = selectedSuiteIds.length
    ? registry.suites.filter(suite => selectedSuiteSet.has(suite.id))
    : registry.suites;
  for (const suite of executionSuites) {
    const runs = [];
    for (let runNumber = 1; runNumber <= suite.runs; runNumber += 1) {
      const result = (dependencies.runMatrix || executeMatrix)(projectRoot, suite, runNumber, {
        output: options.output || DEFAULT_OUTPUT,
        ...(dependencies.matrixOptions || {}),
      });
      runs.push(await Promise.resolve(result));
    }
    results.push({ id: suite.id, risks: suite.risks, mandatory: suite.mandatory, runs, ok: runs.every(item => item.ok) });
  }
  const after = registrySnapshot(projectRoot, registry);
  if (before.digest !== after.digest) {
    throw regressionError('REGRESSION_TARGET_CHANGED_DURING_RUN', 'Registry/matrix/watchFiles đổi trong lúc chạy; kết quả bị hủy.', {
      before: before.digest, after: after.digest,
    });
  }
  const executedById = new Map(results.map(result => [result.id, result]));
  const mergedResults = selectedSuiteIds.length
    ? registry.suites.map(suite => executedById.get(suite.id) || baseResults.get(suite.id))
    : results;
  const ok = mergedResults.filter(item => item.mandatory).every(item => item.ok);
  const receiptFile = resolveContained(projectRoot, options.receipt || DEFAULT_RECEIPT, 'receipt');
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: RECEIPT_KIND,
    generatedAt: new Date().toISOString(),
    ok,
    refresh,
    portable,
    snapshot: after,
    requiredRisks: registry.requiredRisks,
    suites: mergedResults,
    ...(selectedSuiteIds.length ? {
      selectiveRerun: {
        suites: selectedSuiteIds,
        baseGeneratedAt: baseReceipt.generatedAt || null,
      },
    } : {}),
  };
  atomicWriteJson(receiptFile, receipt);
  return {
    ok,
    command: 'run',
    registry: path.relative(projectRoot, registry.configFile).replace(/\\/g, '/'),
    receipt: path.relative(projectRoot, receiptFile).replace(/\\/g, '/'),
    snapshotDigest: after.digest,
    portable,
    refresh,
    requiredRisks: registry.requiredRisks,
    suites: mergedResults,
    ...(selectedSuiteIds.length ? { selectiveRerun: selectedSuiteIds } : {}),
    nextActions: mergedResults.filter(item => item.mandatory && !item.ok).map(item => `Fix/re-run ${item.id}`),
  };
}

async function execute(options = {}, dependencies = {}) {
  if (options.command === 'init') return initRegistry(options);
  if (options.command === 'check') return checkRegressionReceipt(options);
  return runRegressionGate(options, dependencies);
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { console.log(USAGE); return; }
    const result = await execute(options);
    console.log(JSON.stringify(result, null, options.json ? 0 : 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error.code || 'REGRESSION_GATE_FAILED',
      message: error.message,
      details: error.details || undefined,
    }));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  REGISTRY_SCHEMA_VERSION,
  REGISTRY_KIND,
  RECEIPT_SCHEMA_VERSION,
  RECEIPT_KIND,
  DEFAULT_CONFIG,
  DEFAULT_RECEIPT,
  DEFAULT_OUTPUT,
  RISKS,
  parseArgs,
  findHostProject,
  validateProjectRoot,
  resolveContained,
  stableStringify,
  digest,
  hashFile,
  initialRegistry,
  initRegistry,
  mergeRegistryRequiredRisks,
  validateRegistry,
  registrySnapshot,
  portableFileList,
  assertPortableRegistry,
  loadRegistry,
  refreshCocosPreview,
  executeMatrix,
  readReceipt,
  checkRegressionReceipt,
  runRegressionGate,
  execute,
};
