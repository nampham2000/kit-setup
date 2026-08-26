'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { resolveDefaultCacheDir } = require('./cache.cjs');
const { jsonBytes, sanitizeForProjection } = require('./compact-projection.cjs');
const {
  buildCoreGameplayScope,
  coreGameplayProjection,
  normalizePortProfile,
} = require('./core-gameplay-scope.cjs');
const { stableStringify } = require('./live-schema.cjs');
const { discoverPackageRoots } = require('./package-roots.cjs');
const { findUnityProjectRoot } = require('./project-index.cjs');
const { computeUnityProjectState, normalizedRealPath, projectKey } = require('./project-state.cjs');

const PREFLIGHT_SCHEMA_VERSION = 2;
const PREFLIGHT_POLICY_VERSION = 2;
const PREFLIGHT_MAX_BYTES = 12 * 1024;
const PREFLIGHT_ID_RESERVE_BYTES = 256;
const RECEIPT_MAX_BYTES = 4 * 1024;
const DEFAULT_RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PORT_PROVENANCE_SCHEMA_VERSION = 1;
const PORT_PROVENANCE_FILE = '.unity-port-provenance.json';
const PORT_PROVENANCE_MAX_FILES = 10_000;
const PORT_PROVENANCE_MAX_BYTES = 2 * 1024 * 1024;
const SOURCE_BINDING_POLICY_VERSION = 1;
const WORKFLOW_FILES = [
  'preflight.cjs',
  'project-state.cjs',
  'service.cjs',
  'project-index.cjs',
  'schema.cjs',
  'asset-reader.cjs',
  'guid-index.cjs',
  'dependency-graph.cjs',
  'script-index.cjs',
  'diagnostics.cjs',
  'package-roots.cjs',
  'cache.cjs',
  'snapshot-merge.cjs',
  'live-schema.cjs',
  'unity-mcp-provider.cjs',
  'unity-batch-provider.cjs',
  'unity-bootstrap.cjs',
  'unity-bootstrap-footprint.cjs',
  'feature-sketch.cjs',
  'core-gameplay-scope.cjs',
  'compact-projection.cjs',
  path.join('..', 'lib', 'path-boundary.cjs'),
  path.join('..', '..', 'packages', 'unity-intelligence', 'package.json'),
  path.join('..', '..', 'packages', 'unity-intelligence', 'Editor', 'BatchEntry.cs'),
  path.join('..', '..', 'packages', 'unity-intelligence', 'Editor', 'PlayablePortScanTool.cs'),
  path.join('..', '..', 'packages', 'unity-intelligence', 'Editor', 'UnityIntelligenceModels.cs'),
  path.join('..', '..', 'packages', 'unity-intelligence', 'Editor', 'UnityIntelligenceScanner.cs'),
  path.join('..', '..', 'ai', 'capabilities.def.cjs'),
];

function workflowFingerprint() {
  const hash = crypto.createHash('sha256');
  for (const relative of WORKFLOW_FILES) {
    const file = path.resolve(__dirname, relative);
    hash.update(relative.replace(/\\/g, '/'));
    try { hash.update(fs.readFileSync(file)); } catch (_) { hash.update('missing'); }
  }
  return hash.digest('hex').slice(0, 24);
}

const PREFLIGHT_WORKFLOW_FINGERPRINT = workflowFingerprint();

const HARD_DIAGNOSTIC_CODES = new Set([
  'UNITY_ASMDEF_INVALID_JSON',
  'UNITY_ASSET_META_MISSING',
  'UNITY_BUILD_SCENE_GUID_MISMATCH',
  'UNITY_DUPLICATE_GUID',
  'UNITY_DUPLICATE_SCRIPT_GUID',
  'UNITY_MULTIPLE_ASMDEF_IN_DIRECTORY',
  'UNITY_SERIALIZED_FILE_PARTIAL',
]);

const DIAGNOSTIC_ROUTES = Object.freeze({
  UNITY_ADDRESSABLES_RUNTIME_LOAD: {
    class: 'behavior', gate: 'completion', capabilities: ['port.closure', 'port.compile'],
    verify: ['verify.assets', 'verify.runtime'],
  },
  UNITY_ZENJECT_DI: {
    class: 'architecture', gate: 'completion', capabilities: ['port.closure', 'port.compile'],
    verify: ['verify.all', 'verify.runtime'],
  },
  UNITY_DOTWEEN: {
    class: 'behavior', gate: 'completion', capabilities: ['port.closure', 'port.compile'],
    verify: ['verify.all', 'verify.runtime'],
  },
  UNITY_ANIMATOR_STATE_MACHINE: {
    class: 'behavior-visual', gate: 'completion', capabilities: ['port.prefab', 'port.compile'],
    verify: ['verify.prefab', 'verify.runtime'],
  },
  UNITY_COROUTINE: {
    class: 'timing', gate: 'completion', capabilities: ['port.closure', 'port.compile'],
    verify: ['verify.all', 'verify.runtime'],
  },
  UNITY_SHADER_GRAPH: {
    class: 'visual', gate: 'completion', capabilities: ['shader.chain', 'shader.convert'],
    verify: ['shader.validate', 'verify.assets', 'verify.runtime'],
  },
  UNITY_SHADERLAB: {
    class: 'visual', gate: 'completion', capabilities: ['shader.chain', 'shader.convert'],
    verify: ['shader.validate', 'verify.assets', 'verify.runtime'],
  },
  UNITY_REACHABLE_GUID_UNRESOLVED: {
    class: 'source-evidence', gate: 'completion', capabilities: ['unity.intel.setup', 'unity.intel.query'],
    verify: ['unity.intel.scan', 'verify.assets', 'verify.runtime'],
  },
});

const COMPACT_OBLIGATION_ROUTE = Object.freeze({
  action: 'Query bounded evidence, disposition this source high, then run its relevant verification gate.',
  capabilities: ['unity.intel.query'],
  verify: ['unity.intel.scan'],
});

const FEATURE_ROUTES = Object.freeze({
  input: ['port.compile', 'verify.runtime'],
  'physics-2d': ['port.prefab', 'port.compile', 'verify.runtime'],
  'physics-3d': ['port.prefab', 'port.compile', 'verify.runtime'],
  ui: ['port.prefab', 'verify.runtime'],
  camera: ['port.compile', 'verify.runtime'],
  animation: ['port.prefab', 'port.compile', 'verify.runtime'],
  'particles-vfx': ['port.prefab', 'verify.assets', 'verify.runtime'],
  'rendering-shaders': ['shader.chain', 'shader.validate', 'verify.assets'],
  audio: ['port.prefab', 'verify.runtime'],
  'runtime-loading': ['port.closure', 'port.compile', 'verify.assets'],
  tweening: ['port.compile', 'verify.runtime'],
  'timing-coroutines': ['port.compile', 'verify.runtime'],
  'spawning-pooling': ['port.compile', 'verify.gc', 'verify.runtime'],
  persistence: ['port.compile', 'verify.runtime'],
  'analytics-monetization': ['port.compile', 'verify.all', 'verify.runtime'],
});

const DIAGNOSTIC_FEATURES = Object.freeze({
  UNITY_ADDRESSABLES_RUNTIME_LOAD: 'runtime-loading',
  UNITY_ANIMATOR_STATE_MACHINE: 'animation',
  UNITY_COROUTINE: 'timing-coroutines',
  UNITY_DOTWEEN: 'tweening',
  UNITY_SHADER_GRAPH: 'rendering-shaders',
  UNITY_SHADERLAB: 'rendering-shaders',
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function compactId(prefix, value) {
  return `${prefix}:${sha256(stableStringify(value)).slice(0, 24)}`;
}

function preflightError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function normalizeIntent(projectRoot, input = {}) {
  const kind = String(input.intent || 'project').toLowerCase();
  const profile = normalizePortProfile(input.profile);
  const supported = new Set(['project', 'scene', 'prefab', 'script', 'shader', 'feature', 'diagnostic']);
  if (!supported.has(kind)) throw preflightError('UNITY_PREFLIGHT_INTENT_INVALID', `Intent không hỗ trợ: ${kind}`);
  const values = input.targets || (input.target ? [input.target] : []);
  const targets = [...new Set(values.map(value => {
    const text = String(value || '').trim();
    if (!text) return null;
    if (!path.isAbsolute(text)) return text.replace(/\\/g, '/').replace(/^\.\//, '');
    const relative = path.relative(projectRoot, path.resolve(text));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw preflightError('UNITY_PREFLIGHT_TARGET_OUTSIDE_PROJECT', 'Target preflight phải nằm trong Unity project.');
    }
    return relative.replace(/\\/g, '/');
  }).filter(Boolean))].sort();
  if (kind !== 'project' && !targets.length) {
    throw preflightError('UNITY_PREFLIGHT_TARGET_REQUIRED', `Intent ${kind} cần --target.`);
  }
  return { kind, targets, profile, hash: sha256(stableStringify({ kind, targets, profile })).slice(0, 24) };
}

function evidencePaths(value, output = []) {
  if (typeof value === 'string') {
    const normalized = value.replace(/\\/g, '/');
    if (/^(?:Assets|Packages|ProjectSettings)\//.test(normalized) && !output.includes(normalized)) output.push(normalized);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) evidencePaths(item, output);
    return output;
  }
  if (value && typeof value === 'object') {
    evidencePaths(value.path || value.assetPath, output);
    evidencePaths(value.sources, output);
  }
  return output;
}

function resolveIntentScope(snapshot, intent) {
  if (intent.kind === 'project') return { paths: null, matchedTargets: [], missingTargets: [] };
  const records = snapshot.assets && snapshot.assets.records || [];
  const scripts = snapshot.scriptIndex && snapshot.scriptIndex.scripts || [];
  const features = snapshot.features && snapshot.features.sketch || [];
  const diagnostics = snapshot.diagnostics || [];
  const seeds = new Set();
  const matchedTargets = [];
  const lowerPath = value => String(value || '').replace(/\\/g, '/').toLowerCase();

  for (const target of intent.targets) {
    const normalizedTarget = lowerPath(target);
    let matched = false;
    for (const record of records) {
      const assetPath = record.assetPath || record.path;
      if (lowerPath(assetPath) === normalizedTarget) { seeds.add(assetPath); matched = true; }
    }
    if (intent.kind === 'script') {
      for (const script of scripts) {
        const types = script.declaredTypes || (script.type ? [script.type] : []);
        if (types.some(type => lowerPath(type) === normalizedTarget)) {
          seeds.add(script.assetPath || script.path);
          matched = true;
        }
      }
    }
    if (intent.kind === 'feature') {
      for (const feature of features.filter(item => lowerPath(item.id) === normalizedTarget)) {
        for (const evidence of feature.evidence || []) evidencePaths(evidence, []).forEach(item => seeds.add(item));
        matched = true;
      }
    }
    if (intent.kind === 'diagnostic') {
      for (const diagnostic of diagnostics.filter(item => lowerPath(item.code) === normalizedTarget)) {
        for (const evidence of diagnostic.evidence || []) evidencePaths(evidence, []).forEach(item => seeds.add(item));
        matched = true;
      }
    }
    if (matched) matchedTargets.push(target);
  }

  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of snapshot.dependencies && snapshot.dependencies.edges || []) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, new Set());
    if (!incoming.has(edge.to)) incoming.set(edge.to, new Set());
    outgoing.get(edge.from).add(edge.to);
    incoming.get(edge.to).add(edge.from);
  }
  let frontier = [...seeds];
  for (let depth = 0; depth < 2; depth += 1) {
    const next = [];
    for (const source of frontier) {
      for (const target of outgoing.get(source) || []) {
        if (!seeds.has(target)) { seeds.add(target); next.push(target); }
      }
    }
    frontier = next;
  }
  for (const source of [...seeds]) {
    for (const parent of incoming.get(source) || []) seeds.add(parent);
  }
  return {
    paths: seeds,
    matchedTargets: matchedTargets.sort(),
    missingTargets: intent.targets.filter(target => !matchedTargets.includes(target)),
  };
}

function diagnosticGroups(snapshot, intent = { kind: 'project', targets: [] }, scope = { paths: null }) {
  const groups = new Map();
  for (const diagnostic of snapshot.diagnostics || []) {
    if (diagnostic.severity !== 'high') continue;
    const code = String(diagnostic.code || 'UNITY_UNKNOWN_HIGH');
    if (scope.paths) {
      const paths = evidencePaths(diagnostic.evidence || []);
      const explicitlySelected = intent.kind === 'diagnostic' && intent.targets.some(target => target.toLowerCase() === code.toLowerCase());
      const globalIntegrity = !DIAGNOSTIC_ROUTES[code] && (HARD_DIAGNOSTIC_CODES.has(code) || paths.length === 0);
      if (!explicitlySelected && !globalIntegrity && !paths.some(item => scope.paths.has(item))) continue;
    }
    if (!groups.has(code)) {
      groups.set(code, {
        code,
        count: 0,
        action: diagnostic.action || 'Thu thập evidence và xử lý mất hành vi/hình ảnh trước khi hoàn tất port.',
        evidence: [],
        sources: [],
      });
    }
    const group = groups.get(code);
    group.count += Math.max(1, Number(diagnostic.count) || 1);
    const source = String(diagnostic.source || 'static');
    if (!group.sources.includes(source)) group.sources.push(source);
    for (const logical of evidencePaths(diagnostic.evidence || [])) {
      if (!group.evidence.includes(logical) && group.evidence.length < 3) group.evidence.push(logical);
    }
  }
  return [...groups.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function classifyDiagnostic(group) {
  if (group.code === 'UNITY_REACHABLE_GUID_UNRESOLVED' &&
      group.sources.some(source => ['unity-mcp', 'unity-batch', 'unity-editor', 'hybrid'].includes(source))) {
    return {
      class: 'source-integrity', gate: 'implementation', capabilities: ['unity.intel.query'],
      verify: ['unity.intel.scan'], hard: true,
    };
  }
  if (HARD_DIAGNOSTIC_CODES.has(group.code)) {
    return {
      class: 'source-integrity', gate: 'implementation', capabilities: ['unity.intel.setup', 'unity.intel.query'],
      verify: ['unity.intel.scan'], hard: true,
    };
  }
  const route = DIAGNOSTIC_ROUTES[group.code];
  if (route) return { ...route, hard: false };
  return {
    class: 'unclassified', gate: 'implementation', capabilities: ['unity.intel.query'],
    verify: ['unity.intel.scan'], hard: true,
  };
}

function buildObligations(snapshot, intent, scope) {
  const obligations = diagnosticGroups(snapshot, intent, scope).map(group => {
    const route = classifyDiagnostic(group);
    const core = { code: group.code, count: group.count, class: route.class, gate: route.gate };
    return {
      id: compactId('obl', core),
      ...core,
      action: String(group.action).slice(0, 240),
      capabilities: route.capabilities,
      verify: route.verify,
      evidence: group.evidence,
      hard: route.hard,
    };
  });
  if (scope.missingTargets.length) {
    obligations.push({
      id: compactId('obl', { code: 'UNITY_PREFLIGHT_TARGET_NOT_FOUND', targets: scope.missingTargets }),
      code: 'UNITY_PREFLIGHT_TARGET_NOT_FOUND',
      count: scope.missingTargets.length,
      class: 'evidence',
      gate: 'implementation',
      action: 'Chọn exact logical path, declared type, feature id hoặc diagnostic code từ compact query.',
      capabilities: ['unity.intel.query'],
      verify: ['unity.intel.scan'],
      evidence: [],
      hard: true,
    });
  }
  return obligations.sort((left, right) => left.code.localeCompare(right.code));
}

function buildFeatures(snapshot, intent, scope, sourceFeatures) {
  const candidates = (sourceFeatures || snapshot.features && snapshot.features.sketch || []).filter(feature => {
    if (!scope.paths) return true;
    if (intent.kind === 'feature' && intent.targets.some(target => target.toLowerCase() === String(feature.id).toLowerCase())) return true;
    return (feature.evidence || []).some(item => evidencePaths(item).some(logical => scope.paths.has(logical)));
  });
  return candidates.slice(0, 12).map(feature => ({
    id: feature.id,
    confidence: feature.confidence,
    target: feature.porting && feature.porting.target || null,
    action: feature.porting && feature.porting.action || null,
    coverageGap: feature.coverageGap === true || undefined,
    capabilities: FEATURE_ROUTES[feature.id] || ['port.plan', 'verify.runtime'],
    evidence: (feature.evidence || []).map(item => item.path).filter(Boolean).slice(0, 2),
  }));
}

function implementationSteps(obligations, features, coreScope) {
  const steps = new Map();
  function add(capabilityId, reason, satisfies) {
    if (!steps.has(capabilityId)) steps.set(capabilityId, { capabilityId, reasons: [], satisfies: [] });
    const step = steps.get(capabilityId);
    if (reason && step.reasons.length < 3 && !step.reasons.includes(reason)) step.reasons.push(reason);
    if (satisfies && !step.satisfies.includes(satisfies)) step.satisfies.push(satisfies);
  }
  if (coreScope && coreScope.profile === 'playable-core' && coreScope.entry.primary) {
    add('port.core.init', 'lock-core-scope-and-acceptance', null);
    add('port.scene', 'core-gameplay-entry', null);
    if (coreScope.coreScripts.length) {
      add('port.closure', 'core-gameplay-scripts', null);
      add('port.compile', 'core-gameplay-scripts', null);
    }
  }
  for (const obligation of obligations.filter(item => !item.hard && item.coreDisposition !== 'deferred')) {
    for (const capability of obligation.capabilities) add(capability, obligation.code, obligation.id);
  }
  for (const feature of features) {
    for (const capability of feature.capabilities.filter(value =>
      !value.startsWith('verify.') && value !== 'shader.validate')) add(capability, feature.id, null);
  }
  return [...steps.values()].slice(0, 12).map((step, index) => ({ order: index + 1, ...step }));
}

function verificationSteps(obligations, features, coreScope) {
  const values = new Set(['verify.all', 'verify.gc']);
  for (const item of obligations.filter(obligation => obligation.coreDisposition !== 'deferred')) {
    for (const value of item.verify) values.add(value);
  }
  for (const feature of features) {
    for (const value of feature.capabilities.filter(capability => capability.startsWith('verify.') || capability === 'shader.validate')) {
      values.add(value);
    }
  }
  if (coreScope && coreScope.profile === 'playable-core') {
    values.add('verify.assets');
    values.add('build.playable');
    values.add('verify.runtime');
    values.add('port.core.acceptance');
  }
  return [...values];
}

function coreDisposition(obligation, coreScope) {
  if (!coreScope || coreScope.profile === 'full-project') return 'required';
  if (obligation.hard) return 'required';
  const featureId = DIAGNOSTIC_FEATURES[obligation.code];
  const feature = featureId && coreScope.features.find(item => item.id === featureId);
  if (feature) return feature.tier === 'adapter' || feature.tier === 'lifecycle' ? 'adapter' : 'required';
  const evidence = obligation.evidence || [];
  if (!evidence.length) return 'required';
  if (evidence.some(item => coreScope.pathSet.has(item))) return 'required';
  if (evidence.some(item => coreScope.adapterPathSet.has(item))) return 'adapter';
  return 'deferred';
}

function trimBrief(brief) {
  const bodyLimit = PREFLIGHT_MAX_BYTES - PREFLIGHT_ID_RESERVE_BYTES;
  while (jsonBytes(brief) > bodyLimit && brief.coreGameplay &&
      [...brief.coreGameplay.excluded, ...brief.coreGameplay.adapters].some(item => item.examples.length)) {
    const groups = [...brief.coreGameplay.excluded, ...brief.coreGameplay.adapters];
    const group = [...groups].reverse().find(item => item.examples.length);
    group.examples.pop();
    brief.truncated.coreEvidence += 1;
  }
  while (jsonBytes(brief) > bodyLimit && brief.coreGameplay && brief.coreGameplay.coreScripts.length > 3) {
    brief.coreGameplay.coreScripts.pop();
    brief.truncated.coreEvidence += 1;
  }
  while (jsonBytes(brief) > bodyLimit && brief.coreGameplay && brief.coreGameplay.entryPrefabs.length > 3) {
    brief.coreGameplay.entryPrefabs.pop();
    brief.truncated.coreEvidence += 1;
  }
  while (jsonBytes(brief) > bodyLimit && brief.obligations.some(item => item.evidence.length)) {
    const item = [...brief.obligations].reverse().find(obligation => obligation.evidence.length);
    item.evidence.pop();
    brief.truncated.evidence += 1;
  }
  while (jsonBytes(brief) > bodyLimit) {
    const item = [...brief.obligations].reverse().find(obligation => !obligation.routeRef);
    if (!item) break;
    delete item.action;
    delete item.capabilities;
    delete item.verify;
    delete item.evidence;
    item.routeRef = 'compact';
    brief.truncated.obligationDetails += 1;
  }
  while (jsonBytes(brief) > bodyLimit && brief.features.some(item => item.evidence.length)) {
    const feature = brief.features.findLast ? brief.features.findLast(item => item.evidence.length) : [...brief.features].reverse().find(item => item.evidence.length);
    feature.evidence.pop();
    brief.truncated.evidence += 1;
  }
  while (jsonBytes(brief) > bodyLimit && brief.features.length) {
    brief.features.pop();
    brief.truncated.features += 1;
  }
  while (jsonBytes(brief) > bodyLimit && brief.implementation.length > 2) {
    brief.implementation.pop();
    brief.truncated.implementation += 1;
  }
  while (jsonBytes(brief) > bodyLimit && brief.obligations.length) {
    brief.obligations.pop();
    brief.truncated.obligations += 1;
  }
  if (jsonBytes(brief) > bodyLimit) {
    throw preflightError('UNITY_PREFLIGHT_PAYLOAD_EXCEEDED', 'Implementation brief tối thiểu vượt 12 KiB.');
  }
  return brief;
}

function semanticBriefBody(brief) {
  const { briefId: _briefId, receiptId: _receiptId, generatedAt: _generatedAt, ...body } = brief;
  return body;
}

function createImplementationBrief(scanResult, input = {}) {
  const snapshot = scanResult.snapshot;
  const projectRoot = scanResult.projectRoot || findUnityProjectRoot(input.project);
  const intent = normalizeIntent(projectRoot, input);
  const scope = resolveIntentScope(snapshot, intent);
  const coreScope = buildCoreGameplayScope(snapshot, { profile: intent.profile });
  const obligations = buildObligations(snapshot, intent, scope).map(obligation => ({
    ...obligation,
    coreDisposition: coreDisposition(obligation, coreScope),
  }));
  const featureSource = intent.kind === 'project' && coreScope.profile === 'playable-core'
    ? coreScope.features
    : null;
  const features = buildFeatures(snapshot, intent, scope, featureSource).map(feature => ({
    ...feature,
    tier: coreScope.featureTiers && Object.entries(coreScope.featureTiers)
      .find(([, ids]) => ids.includes(feature.id))?.[0] || 'core',
  }));
  const hard = obligations.filter(item => item.hard);
  const coreObligations = obligations.filter(item => item.coreDisposition !== 'deferred');
  const status = hard.length ? 'blocked' : obligations.length ? 'ready-with-obligations' : 'ready';
  const stateFingerprint = snapshot.stateFingerprint || computeUnityProjectState(projectRoot).fingerprint;
  const projectFingerprint = snapshot.projectFingerprint || snapshot.live && snapshot.live.projectFingerprint || snapshot.fingerprint;
  const brief = {
    schemaVersion: PREFLIGHT_SCHEMA_VERSION,
    kind: 'unity-port-implementation-brief',
    briefId: null,
    receiptId: null,
    generatedAt: new Date(input.now === undefined ? Date.now() : input.now).toISOString(),
    project: {
      name: snapshot.project && snapshot.project.name || path.basename(projectRoot),
      unityVersion: snapshot.project && snapshot.project.unityVersion || null,
      projectFingerprint,
      stateFingerprint,
      provider: snapshot.provider,
      scanId: snapshot.scanId,
      coverage: {
        editTime: true,
        playModeCapture: !!(snapshot.live && snapshot.live.capabilities && snapshot.live.capabilities.playModeCapture),
      },
    },
    intent: {
      ...intent,
      matchedTargets: scope.matchedTargets,
      missingTargets: scope.missingTargets,
      scopePathCount: scope.paths ? scope.paths.size : snapshot.assets && snapshot.assets.records && snapshot.assets.records.length || 0,
      scopeRevision: compactId('scp', {
        stateFingerprint,
        paths: scope.paths ? [...scope.paths].sort() : ['project'],
      }),
    },
    decision: {
      status,
      implementationAllowed: hard.length === 0,
      sourceHighFree: obligations.length === 0,
      completionDispositionRequired: coreObligations.length > 0,
      completionGate: coreObligations.length ? 'core-obligation-and-acceptance-required' : 'core-acceptance-required',
      mutationReceiptIssued: intent.kind === 'project',
      hardBlockerCount: hard.length,
      obligationCount: obligations.length,
      coreObligationCount: coreObligations.length,
      coreEntryReady: !coreScope.entry.needsDecision,
    },
    diagnosticCounts: scanResult.summary && scanResult.summary.diagnosticCounts || null,
    features,
    coreGameplay: coreGameplayProjection(coreScope),
    obligations,
    obligationIndexSchema: ['code', 'count', 'hard', 'gate', 'class'],
    obligationIndex: obligations.map(item => [item.code, item.count, item.hard ? 1 : 0, item.gate, item.class]),
    coreObligationIndexSchema: ['code', 'disposition'],
    coreObligationIndex: obligations.map(item => [item.code, item.coreDisposition]),
    obligationRoutes: { compact: COMPACT_OBLIGATION_ROUTE },
    implementation: implementationSteps(obligations, features, coreScope),
    verification: verificationSteps(obligations, features, coreScope),
    coverageGaps: snapshot.live && snapshot.live.capabilities && snapshot.live.capabilities.playModeCapture
      ? []
      : ['play-mode-runtime-objects-not-captured'],
    evidenceQueries: hard.length || coreObligations.some(item => item.capabilities.includes('unity.intel.query'))
      ? [
        'npm run ai:unity:query -- --project <UnityProjectRoot> --section diagnostics --severity high',
        'npm run unity:intel:setup -- --project <UnityProjectRoot>',
      ]
      : [],
    truncated: { coreEvidence: 0, features: 0, evidence: 0, implementation: 0, obligationDetails: 0, obligations: 0 },
  };
  trimBrief(brief);
  const semantic = semanticBriefBody(brief);
  brief.briefId = compactId('brf', semantic);
  brief.receiptId = intent.kind === 'project' ? compactId('rcp', {
    policyVersion: PREFLIGHT_POLICY_VERSION,
    workflowFingerprint: PREFLIGHT_WORKFLOW_FINGERPRINT,
    projectFingerprint,
    stateFingerprint,
    intent: intent.hash,
    briefId: brief.briefId,
    decision: brief.decision,
  }) : null;
  return sanitizeForProjection(brief, { maxString: 320, maxArray: 512, maxDepth: 12 });
}

function receiptDirectory(projectRoot, cacheDir) {
  const root = path.resolve(cacheDir || resolveDefaultCacheDir(), 'receipts');
  const relative = path.relative(projectRoot, root);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw preflightError('UNITY_PREFLIGHT_CACHE_INSIDE_PROJECT', 'Receipt cache phải nằm ngoài Unity project.');
  }
  return path.join(root, projectKey(projectRoot));
}

function receiptFile(projectRoot, cacheDir) {
  return path.join(receiptDirectory(projectRoot, cacheDir), 'project.json');
}

function pathIsInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function realExistingPath(value, label = 'source') {
  const resolved = path.resolve(value);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch (_) {
    throw preflightError('UNITY_PREFLIGHT_SOURCE_INVALID', `Unity ${label} không tồn tại.`);
  }
  if (stat.isSymbolicLink()) {
    // Resolve the exact target before project discovery. This prevents a
    // junction/symlink in Project A from disguising Project B as an A source.
    return fs.realpathSync.native(resolved);
  }
  return fs.realpathSync.native(resolved);
}

function allowedSourceRoots(projectRoot) {
  const roots = [];
  const assets = path.join(projectRoot, 'Assets');
  if (fs.existsSync(assets)) {
    roots.push({
      kind: 'project-assets', packageName: null, packageVersion: null,
      logicalPrefix: 'Assets', physicalRoot: fs.realpathSync.native(assets),
    });
  }
  for (const descriptor of discoverPackageRoots(projectRoot).roots) {
    let rootReal;
    try { rootReal = fs.realpathSync.native(descriptor.physicalRoot); } catch (_) { continue; }
    roots.push({ ...descriptor, physicalRoot: rootReal });
  }
  return roots.sort((left, right) =>
    right.physicalRoot.length - left.physicalRoot.length || left.kind.localeCompare(right.kind));
}

function sourceRootsDigest(projectRoot) {
  const identity = allowedSourceRoots(projectRoot).map(root => ({
    kind: root.kind,
    packageName: root.packageName || null,
    packageVersion: root.packageVersion || null,
    logicalPrefix: root.logicalPrefix,
    physicalKey: sha256(normalizedRealPath(root.physicalRoot)).slice(0, 24),
  }));
  return sha256(stableStringify(identity)).slice(0, 24);
}

function allowedSourceBinding(projectRoot, sourcePath) {
  for (const root of allowedSourceRoots(projectRoot)) {
    if (!pathIsInside(root.physicalRoot, sourcePath)) continue;
    const relative = path.relative(root.physicalRoot, sourcePath).replace(/\\/g, '/');
    return {
      kind: root.kind,
      packageName: root.packageName || null,
      packageVersion: root.packageVersion || null,
      physicalRoot: root.physicalRoot,
      logicalPath: relative ? `${root.logicalPrefix}/${relative}` : root.logicalPrefix,
    };
  }
  return null;
}

function provenanceIntegrity(provenance, receipt) {
  const { integrity: _integrity, ...body } = provenance;
  return sha256(`${receipt.integrity}\0${stableStringify(body)}`);
}

function collectBoundFiles(sourcePath, provenanceRoot) {
  const output = [];
  const sourceReal = fs.realpathSync.native(sourcePath);
  const rootReal = fs.realpathSync.native(provenanceRoot);
  if (!pathIsInside(rootReal, sourceReal)) {
    throw preflightError('UNITY_PORT_PROVENANCE_INVALID', 'Source staging nằm ngoài provenance root.');
  }
  const stack = [sourceReal];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw preflightError('UNITY_PORT_PROVENANCE_INVALID', 'Staging provenance không cho phép symlink/junction.');
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.name === PORT_PROVENANCE_FILE) continue;
        if (entry.isSymbolicLink()) {
          throw preflightError('UNITY_PORT_PROVENANCE_INVALID', 'Staging provenance không cho phép symlink/junction.');
        }
        stack.push(path.join(current, entry.name));
      }
      continue;
    }
    if (!stat.isFile()) {
      throw preflightError('UNITY_PORT_PROVENANCE_INVALID', 'Staging chỉ được chứa regular files.');
    }
    output.push({
      path: path.relative(rootReal, current).replace(/\\/g, '/'),
      size: stat.size,
      sha256: sha256File(current),
    });
    if (output.length > PORT_PROVENANCE_MAX_FILES) {
      throw preflightError('UNITY_PORT_PROVENANCE_TOO_LARGE', 'Staging provenance vượt giới hạn file.');
    }
  }
  return output.sort((left, right) => left.path.localeCompare(right.path));
}

function provenanceFile(stagingRoot) {
  return path.join(path.resolve(stagingRoot), PORT_PROVENANCE_FILE);
}

function createPortProvenance(projectRoot, stagingRoot, copyRecords, options = {}) {
  const validated = options.receipt
    ? validateReceipt(projectRoot, options.receipt, options)
    : validateReceipt(projectRoot, readReceipt(projectRoot, options), options);
  const rootReal = realExistingPath(stagingRoot, 'staging root');
  if (!fs.statSync(rootReal).isDirectory()) {
    throw preflightError('UNITY_PORT_PROVENANCE_INVALID', 'Staging root phải là directory.');
  }
  const seenTargets = new Set();
  const entries = (copyRecords || []).map(record => {
      if (!record || typeof record !== 'object' || !record.source || !record.target) {
        throw preflightError('UNITY_PORT_PROVENANCE_INVALID', 'Provenance writer cần mapping source -> target.');
      }
      const source = realExistingPath(record.source, 'provenance origin');
      const target = realExistingPath(record.target, 'staged file');
      const targetKey = normalizedRealPath(target);
      if (seenTargets.has(targetKey)) {
        throw preflightError('UNITY_PORT_PROVENANCE_INVALID', 'Provenance writer nhận duplicate target.');
      }
      seenTargets.add(targetKey);
      if (!pathIsInside(rootReal, target) || !fs.statSync(target).isFile()) {
        throw preflightError('UNITY_PORT_PROVENANCE_INVALID', 'Staged file phải nằm trong staging root.');
      }
      const origin = allowedSourceBinding(projectRoot, source);
      if (!origin) {
        throw preflightError('UNITY_PORT_PROVENANCE_ORIGIN_UNBOUND', 'Provenance origin không thuộc Assets/package đã khai báo.');
      }
      const stat = fs.statSync(target);
      const targetHash = sha256File(target);
      const originHash = sha256File(source);
      if (targetHash !== originHash) {
        throw preflightError('UNITY_PORT_PROVENANCE_COPY_MISMATCH', 'Staged bytes không khớp Unity origin.');
      }
      return {
        path: path.relative(rootReal, target).replace(/\\/g, '/'),
        size: stat.size,
        sha256: targetHash,
        originKind: origin.kind,
        originLogicalPath: origin.logicalPath,
        originSha256: originHash,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  if (!entries.length || entries.length > PORT_PROVENANCE_MAX_FILES) {
    throw preflightError('UNITY_PORT_PROVENANCE_INVALID', 'Staging provenance cần 1-10000 files.');
  }
  const body = {
    schemaVersion: PORT_PROVENANCE_SCHEMA_VERSION,
    kind: 'unity-port-staging-provenance',
    projectKey: validated.receipt.projectKey,
    receiptId: validated.receipt.receiptId,
    stateFingerprint: validated.receipt.stateFingerprint,
    workflowFingerprint: validated.receipt.workflowFingerprint,
    sourceBindingPolicyVersion: SOURCE_BINDING_POLICY_VERSION,
    sourceRootsDigest: validated.receipt.sourceRootsDigest,
    stagingRootKey: sha256(normalizedRealPath(rootReal)).slice(0, 24),
    createdAt: new Date(options.now === undefined ? Date.now() : Number(options.now)).toISOString(),
    files: entries,
  };
  return { ...body, integrity: provenanceIntegrity(body, validated.receipt) };
}

function writePortProvenance(projectRoot, stagingRoot, copyRecords, options = {}) {
  const provenance = createPortProvenance(projectRoot, stagingRoot, copyRecords, options);
  const file = provenanceFile(stagingRoot);
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw preflightError('UNITY_PORT_PROVENANCE_INVALID', 'Provenance file không được là symlink.');
  }
  const payload = `${JSON.stringify(provenance)}\n`;
  if (Buffer.byteLength(payload) > PORT_PROVENANCE_MAX_BYTES) {
    throw preflightError('UNITY_PORT_PROVENANCE_TOO_LARGE', 'Staging provenance vượt giới hạn 2 MiB.');
  }
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch (_) { /* best effort */ }
    throw error;
  }
  return { file, provenance };
}

function findPortProvenance(sourcePath) {
  let current = fs.statSync(sourcePath).isDirectory() ? sourcePath : path.dirname(sourcePath);
  for (;;) {
    const candidate = path.join(current, PORT_PROVENANCE_FILE);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function validatePortProvenance(sourcePath, projectRoot, receipt) {
  const file = findPortProvenance(sourcePath);
  if (!file || fs.lstatSync(file).isSymbolicLink()) {
    throw preflightError(
      'UNITY_PORT_PROVENANCE_REQUIRED',
      'Source ngoài Unity project cần provenance do port.closure tạo; không thể ghép arbitrary source với receipt project.',
    );
  }
  const size = fs.statSync(file).size;
  if (size <= 0 || size > PORT_PROVENANCE_MAX_BYTES) {
    throw preflightError('UNITY_PORT_PROVENANCE_INVALID', 'Staging provenance có kích thước không hợp lệ.');
  }
  let provenance;
  try { provenance = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {
    throw preflightError('UNITY_PORT_PROVENANCE_INVALID', 'Staging provenance không đọc được.');
  }
  const root = fs.realpathSync.native(path.dirname(file));
  if (provenance.schemaVersion !== PORT_PROVENANCE_SCHEMA_VERSION ||
      provenance.kind !== 'unity-port-staging-provenance' ||
      provenance.projectKey !== projectKey(projectRoot) ||
      provenance.receiptId !== receipt.receiptId ||
      provenance.stateFingerprint !== receipt.stateFingerprint ||
      provenance.workflowFingerprint !== receipt.workflowFingerprint ||
      provenance.sourceBindingPolicyVersion !== SOURCE_BINDING_POLICY_VERSION ||
      provenance.sourceRootsDigest !== receipt.sourceRootsDigest ||
      provenance.stagingRootKey !== sha256(normalizedRealPath(root)).slice(0, 24) ||
      provenance.integrity !== provenanceIntegrity(provenance, receipt) ||
      !Array.isArray(provenance.files) || provenance.files.length === 0 ||
      provenance.files.length > PORT_PROVENANCE_MAX_FILES) {
    throw preflightError('UNITY_PORT_PROVENANCE_STALE', 'Staging provenance không khớp receipt/project hiện tại; hãy tạo lại closure.');
  }
  const declared = new Map();
  for (const entry of provenance.files) {
    if (!entry || typeof entry.path !== 'string' || !entry.path || path.isAbsolute(entry.path) ||
        entry.path.includes('\\') || entry.path === PORT_PROVENANCE_FILE ||
        path.posix.normalize(entry.path) !== entry.path || entry.path.startsWith('../') || entry.path.includes('/../') ||
        !Number.isFinite(entry.size) || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(entry.sha256) ||
        typeof entry.originKind !== 'string' || typeof entry.originLogicalPath !== 'string' ||
        !/^(?:Assets|Packages)\//.test(entry.originLogicalPath) ||
        typeof entry.originSha256 !== 'string' || entry.originSha256 !== entry.sha256) {
      throw preflightError('UNITY_PORT_PROVENANCE_INVALID', 'Staging provenance chứa file entry không hợp lệ.');
    }
    const key = process.platform === 'win32' ? entry.path.toLowerCase() : entry.path;
    if (declared.has(key)) {
      throw preflightError('UNITY_PORT_PROVENANCE_INVALID', 'Staging provenance chứa duplicate path.');
    }
    declared.set(key, entry);
  }
  const actual = collectBoundFiles(sourcePath, root);
  const sourceRelative = fs.statSync(sourcePath).isDirectory()
    ? path.relative(root, sourcePath).replace(/\\/g, '/').replace(/\/$/, '')
    : path.relative(root, sourcePath).replace(/\\/g, '/');
  const expectedEntries = [...declared.entries()].filter(([, entry]) =>
    fs.statSync(sourcePath).isDirectory()
      ? (!sourceRelative || entry.path.startsWith(`${sourceRelative}/`))
      : entry.path === sourceRelative);
  if (!actual.length || actual.length !== expectedEntries.length || actual.some(entry => {
    const key = process.platform === 'win32' ? entry.path.toLowerCase() : entry.path;
    const expected = declared.get(key);
    return !expected || expected.size !== entry.size || expected.sha256 !== entry.sha256;
  })) {
    throw preflightError('UNITY_PORT_PROVENANCE_CHANGED', 'Staging source đã đổi hoặc có file ngoài provenance; hãy tạo lại closure.');
  }
  return { kind: 'staging-provenance', root, file, fileCount: actual.length };
}

function nearestExistingAncestor(candidate) {
  let current = path.resolve(candidate);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

function assertProspectiveLocationOutsideProject(projectRoot, candidate) {
  const ancestor = nearestExistingAncestor(candidate);
  if (!ancestor) return;
  const realAncestor = fs.realpathSync.native(ancestor);
  const realProject = fs.realpathSync.native(projectRoot);
  const prospective = path.resolve(realAncestor, path.relative(ancestor, path.resolve(candidate)));
  if (pathIsInside(realProject, prospective)) {
    throw preflightError(
      'UNITY_PREFLIGHT_CACHE_ESCAPE',
      'Receipt cache symlink/junction trỏ vào Unity project.',
    );
  }
}

function assertReceiptLocation(projectRoot, file, cacheDir, create) {
  const base = path.resolve(cacheDir || resolveDefaultCacheDir(), 'receipts');
  assertProspectiveLocationOutsideProject(projectRoot, base);
  assertProspectiveLocationOutsideProject(projectRoot, path.dirname(file));
  if (create) {
    fs.mkdirSync(base, { recursive: true });
    assertProspectiveLocationOutsideProject(projectRoot, base);
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  if (!fs.existsSync(base) || !fs.existsSync(path.dirname(file))) return;
  const realBase = fs.realpathSync.native(base);
  const realDirectory = fs.realpathSync.native(path.dirname(file));
  const realProject = fs.realpathSync.native(projectRoot);
  if (!pathIsInside(realBase, realDirectory) || pathIsInside(realProject, realDirectory)) {
    throw preflightError('UNITY_PREFLIGHT_CACHE_ESCAPE', 'Receipt cache symlink/junction thoát khỏi user-local cache hoặc trỏ vào Unity project.');
  }
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw preflightError('UNITY_PREFLIGHT_CACHE_ESCAPE', 'Receipt file không được là symlink.');
  }
}

function receiptIntegrity(receipt) {
  const { integrity: _integrity, ...body } = receipt;
  return sha256(stableStringify(body));
}

function createReceipt(projectRoot, brief, options = {}) {
  if (brief.intent.kind !== 'project' || !brief.receiptId) return null;
  const createdMs = options.now === undefined ? Date.now() : Number(options.now);
  const hardCodes = brief.obligationIndex.filter(item => item[2] === 1).map(item => item[0]);
  const semantic = {
    schemaVersion: PREFLIGHT_SCHEMA_VERSION,
    policyVersion: PREFLIGHT_POLICY_VERSION,
    workflowFingerprint: PREFLIGHT_WORKFLOW_FINGERPRINT,
    kind: 'unity-port-preflight-receipt',
    receiptId: brief.receiptId,
    projectKey: projectKey(projectRoot),
    sourceBindingPolicyVersion: SOURCE_BINDING_POLICY_VERSION,
    sourceRootsDigest: sourceRootsDigest(projectRoot),
    projectFingerprint: brief.project.projectFingerprint,
    stateFingerprint: brief.project.stateFingerprint,
    extractorFingerprint: brief.project && brief.project.stateFingerprint ? require('./cache.cjs').EXTRACTOR_FINGERPRINT : null,
    scanId: brief.project.scanId,
    provider: brief.project.provider,
    playModeCapture: brief.project.coverage.playModeCapture,
    intentHash: brief.intent.hash,
    briefId: brief.briefId,
    decision: {
      status: brief.decision.status,
      implementationAllowed: brief.decision.implementationAllowed,
      hardBlockerCount: hardCodes.length,
      hardBlockerCodes: hardCodes.slice(0, 16),
      obligationCount: brief.obligationIndex.length,
      obligationDigest: sha256(stableStringify(brief.obligationIndex)).slice(0, 24),
    },
    createdAt: new Date(createdMs).toISOString(),
    expiresAt: new Date(createdMs + (options.maxAgeMs || DEFAULT_RECEIPT_MAX_AGE_MS)).toISOString(),
  };
  return { ...semantic, integrity: receiptIntegrity(semantic) };
}

function writeReceipt(projectRoot, receipt, options = {}) {
  if (!receipt) return null;
  const file = receiptFile(projectRoot, options.cacheDir);
  const payload = `${JSON.stringify(receipt)}\n`;
  if (Buffer.byteLength(payload) > RECEIPT_MAX_BYTES) {
    throw preflightError('UNITY_PREFLIGHT_RECEIPT_TOO_LARGE', 'Receipt vượt giới hạn 4 KiB.');
  }
  assertReceiptLocation(projectRoot, file, options.cacheDir, true);
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch (_) { /* best effort */ }
    throw error;
  }
  return file;
}

function readReceipt(projectRoot, options = {}) {
  const file = receiptFile(projectRoot, options.cacheDir);
  assertReceiptLocation(projectRoot, file, options.cacheDir, false);
  let stat;
  try { stat = fs.statSync(file); } catch (_) { return null; }
  if (stat.size > RECEIPT_MAX_BYTES) throw preflightError('UNITY_PREFLIGHT_RECEIPT_INVALID', 'Receipt vượt giới hạn cho phép.');
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {
    throw preflightError('UNITY_PREFLIGHT_RECEIPT_INVALID', 'Receipt không đọc được.');
  }
  return receipt;
}

function validateReceipt(projectRoot, receipt, options = {}) {
  if (!receipt) throw preflightError(
    'UNITY_PREFLIGHT_REQUIRED',
    'Chưa có Unity preflight receipt. Chạy `npm run ai:port:preflight -- --project <UnityProjectRoot>` trước khi ghi output port.',
  );
  if (receipt.schemaVersion !== PREFLIGHT_SCHEMA_VERSION || receipt.policyVersion !== PREFLIGHT_POLICY_VERSION ||
      receipt.workflowFingerprint !== PREFLIGHT_WORKFLOW_FINGERPRINT ||
      receipt.kind !== 'unity-port-preflight-receipt' || receipt.projectKey !== projectKey(projectRoot) ||
      receipt.sourceBindingPolicyVersion !== SOURCE_BINDING_POLICY_VERSION ||
      receipt.sourceRootsDigest !== sourceRootsDigest(projectRoot) ||
      receipt.integrity !== receiptIntegrity(receipt)) {
    throw preflightError('UNITY_PREFLIGHT_RECEIPT_INVALID', 'Unity preflight receipt sai schema, project hoặc integrity; hãy scan lại.');
  }
  const now = options.now === undefined ? Date.now() : Number(options.now);
  if (!Date.parse(receipt.expiresAt) || Date.parse(receipt.expiresAt) < now) {
    throw preflightError('UNITY_PREFLIGHT_EXPIRED', 'Unity preflight receipt đã hết hạn; hãy scan lại trước khi port.');
  }
  const state = computeUnityProjectState(projectRoot);
  if (state.fingerprint !== receipt.stateFingerprint || state.extractorFingerprint !== receipt.extractorFingerprint) {
    throw preflightError('UNITY_PREFLIGHT_STALE', 'Unity source/tooling đã đổi sau preflight; hãy chạy lại preflight.', {
      receiptId: receipt.receiptId,
    });
  }
  if (!receipt.decision || !receipt.decision.implementationAllowed) {
    const codes = receipt.decision && receipt.decision.hardBlockerCodes || [];
    const omitted = Math.max(0, Number(receipt.decision && receipt.decision.hardBlockerCount) - codes.length);
    throw preflightError(
      'UNITY_PREFLIGHT_BLOCKED',
      `Preflight chặn implement vì source evidence chưa đủ${codes.length ? `: ${codes.join(', ')}${omitted ? ` (+${omitted})` : ''}` : ''}. Chạy query/setup được ghi trong implementation brief.`,
      { receiptId: receipt.receiptId, hardBlockerCodes: codes },
    );
  }
  return { applicable: true, projectRoot, receipt, state };
}

function assertUnityPortPreflight(source, options = {}) {
  const hasExplicitProject = options.projectRoot !== undefined && options.projectRoot !== null &&
    String(options.projectRoot).trim() !== '';
  let explicitPath = null;
  if (hasExplicitProject) {
    try { explicitPath = realExistingPath(options.projectRoot, 'project root'); } catch (_) {
      throw preflightError(
        'UNITY_PREFLIGHT_PROJECT_INVALID',
        'Unity project explicit không hợp lệ; gate không thể bị bỏ qua bằng project root sai.',
      );
    }
  }
  const explicitRoot = hasExplicitProject ? findUnityProjectRoot(explicitPath) : null;
  if (hasExplicitProject && !explicitRoot) {
    throw preflightError(
      'UNITY_PREFLIGHT_PROJECT_INVALID',
      'Unity project explicit không hợp lệ; gate không thể bị bỏ qua bằng project root sai.',
    );
  }
  const sourcePath = source ? realExistingPath(source) : null;
  const sourceRoot = sourcePath ? findUnityProjectRoot(sourcePath) : null;
  if (explicitRoot && sourceRoot && normalizedRealPath(explicitRoot) !== normalizedRealPath(sourceRoot)) {
    throw preflightError(
      'UNITY_PREFLIGHT_PROJECT_MISMATCH',
      'Unity source và explicit project root thuộc hai project khác nhau.',
    );
  }
  const projectRoot = explicitRoot || sourceRoot;
  if (!projectRoot) {
    if (options.requireProject) {
      throw preflightError(
        'UNITY_PREFLIGHT_PROJECT_REQUIRED',
        'Output port cần Unity project hợp lệ. Dùng --unity-project cho declared local package hoặc closure staging.',
      );
    }
    return { applicable: false, reason: 'source-is-not-inside-a-complete-unity-project' };
  }
  const validated = validateReceipt(projectRoot, readReceipt(projectRoot, options), options);
  let binding = { kind: 'project-context' };
  if (sourcePath) {
    binding = allowedSourceBinding(projectRoot, sourcePath);
    if (!binding && explicitRoot && !sourceRoot) {
      binding = validatePortProvenance(sourcePath, projectRoot, validated.receipt);
    }
    if (!binding) {
      throw preflightError(
        'UNITY_PREFLIGHT_SOURCE_UNBOUND',
        'Unity source phải nằm trong Assets hoặc package đã khai báo; Temp/UserSettings/arbitrary project files không được receipt authorize.',
      );
    }
  }
  return { ...validated, sourcePath, binding };
}

async function runUnityPortPreflight(input = {}, dependencies = {}) {
  const scan = dependencies.scanProject || require('./service.cjs').scanUnityProject;
  const scanResult = await scan({
    project: input.project,
    provider: input.provider || 'auto',
    bootstrap: input.bootstrap === true,
    unity: input.unity,
    mcpUrl: input.mcpUrl,
    mcpToken: input.mcpToken,
    timeoutMs: input.timeoutMs,
    requestTimeoutMs: input.requestTimeoutMs,
    includeVendor: input.includeVendor === true,
    cache: input.cache !== false,
    cacheDir: input.indexCacheDir,
    refreshCache: input.refreshCache === true,
    keepOnFailure: input.keepOnFailure === true,
  });
  const brief = createImplementationBrief(scanResult, input);
  const receipt = createReceipt(scanResult.projectRoot, brief, input);
  writeReceipt(scanResult.projectRoot, receipt, input);
  return { brief, snapshot: scanResult.snapshot, receipt };
}

module.exports = {
  PREFLIGHT_SCHEMA_VERSION,
  PREFLIGHT_POLICY_VERSION,
  PREFLIGHT_WORKFLOW_FINGERPRINT,
  PREFLIGHT_MAX_BYTES,
  RECEIPT_MAX_BYTES,
  DEFAULT_RECEIPT_MAX_AGE_MS,
  PORT_PROVENANCE_SCHEMA_VERSION,
  PORT_PROVENANCE_FILE,
  PORT_PROVENANCE_MAX_FILES,
  PORT_PROVENANCE_MAX_BYTES,
  SOURCE_BINDING_POLICY_VERSION,
  HARD_DIAGNOSTIC_CODES,
  DIAGNOSTIC_ROUTES,
  FEATURE_ROUTES,
  normalizeIntent,
  resolveIntentScope,
  diagnosticGroups,
  classifyDiagnostic,
  createImplementationBrief,
  receiptDirectory,
  receiptFile,
  createReceipt,
  writeReceipt,
  readReceipt,
  validateReceipt,
  createPortProvenance,
  writePortProvenance,
  findPortProvenance,
  validatePortProvenance,
  allowedSourceRoots,
  allowedSourceBinding,
  sourceRootsDigest,
  assertUnityPortPreflight,
  runUnityPortPreflight,
};
