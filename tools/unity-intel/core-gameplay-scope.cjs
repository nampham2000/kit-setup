'use strict';

const path = require('node:path');

const { FEATURE_RULES, buildFeatureSketch } = require('./feature-sketch.cjs');

const CORE_GAMEPLAY_SCOPE_VERSION = 1;
const DEFAULT_PORT_PROFILE = 'playable-core';
const PORT_PROFILES = Object.freeze(['playable-core', 'full-project']);

const CORE_PACKAGE_PATTERNS = Object.freeze([
  /^com\.unity\.inputsystem$/i,
  /^com\.unity\.cinemachine$/i,
  /^com\.unity\.render-pipelines\./i,
  /^com\.unity\.2d\./i,
  /^com\.unity\.ai\.navigation$/i,
]);

const NON_CORE_RULES = Object.freeze([
  {
    id: 'boot-loading', disposition: 'replace',
    pattern: /(?:^|[\/_. -])(?:loading|splash|bootstrap|boot)(?:[\/_. -]|$)/i,
    action: 'Start directly in the selected gameplay scene; replace loading/bootstrap with local initialization.',
  },
  {
    id: 'main-menu', disposition: 'defer',
    pattern: /(?:main[ _.-]?menu|menu[\/_. -]+main|(?:^|[\/_. -])lobby(?:[\/_. -]|$)|(?:^|[\/_. -])home[ _.-]?(?:screen|menu)(?:[\/_. -]|$))/i,
    action: 'Skip navigation screens and enter the playable loop directly.',
  },
  {
    id: 'commerce', disposition: 'defer',
    pattern: /(?:popup[ _.-]?iap|remove[ _.-]?ads|(?:^|[\/_. -])(?:shop|store|iap|purchase|subscription|offer|paywall)(?:[\/_. -]|$))/i,
    action: 'Do not port commerce; keep only the playable CTA adapter.',
  },
  {
    id: 'meta-progression', disposition: 'defer',
    pattern: /(?:daily[ _.-]?(?:login|reward)|leaderboard|achievement|user[ _.-]?profile|life[ _.-]?system|infinite[ _.-]?lives)/i,
    action: 'Skip long-term/meta progression; keep only state needed for one playable session.',
  },
  {
    id: 'persistence', disposition: 'replace',
    pattern: /(?:player[ _.-]?prefs?|save[ _.-]?(?:manager|system|load)|local[ _.-]?save|persistence)/i,
    action: 'Replace persistence with deterministic in-memory state for one playable session.',
  },
  {
    id: 'online-services', disposition: 'replace',
    pattern: /(?:firebase|onesignal|remote[ _.-]?config|cloud[ _.-]?(?:save|service)|backend|authentication|google[ _.-]?play[ _.-]?(?:games|plugins)|network[ _.-]?(?:manager|service))/i,
    action: 'Replace remote services with deterministic local data embedded in the playable.',
  },
  {
    id: 'ads-analytics', disposition: 'replace',
    pattern: /(?:analytics|attribution|appsflyer|app[ _.-]?lovin|ironsource|advertisement|monetization|ac[ _.-]?tracking)/i,
    action: 'Drop source SDKs; wire only playable-sdk lifecycle, interaction, end and CTA events.',
  },
  {
    id: 'settings-support', disposition: 'defer',
    pattern: /(?:^|[\/_. -])(?:settings?|privacy|consent|in[ _.-]?app[ _.-]?review|notification)(?:[\/_. -]|$)/i,
    action: 'Skip support/settings screens unless a value directly affects the core loop.',
  },
]);

const ENTRY_POSITIVE = Object.freeze([
  [/(?:^|[\/_. -])game[ _.-]?play(?:[ _.-]?scene)?(?:[\/_. -]|$)/i, 180],
  [/(?:^|[\/_. -])level(?:[\/_. -]|$)/i, 75],
  [/(?:^|[\/_. -])board(?:[\/_. -]|$)/i, 55],
  [/(?:^|[\/_. -])puzzle(?:[\/_. -]|$)/i, 55],
]);

const ENTRY_NEGATIVE = Object.freeze([
  [/(?:^|[\/_. -])(?:loading|splash|bootstrap|boot)(?:[\/_. -]|$)/i, -220],
  [/(?:main[ _.-]?menu|(?:^|[\/_. -])lobby(?:[\/_. -]|$))/i, -210],
  [/(?:^|[\/_. -])(?:shop|store|test|debug|designer)(?:[\/_. -]|$)/i, -160],
  [/(?:^|[\/_. -])entry(?:[\/_. -]|$)/i, -80],
]);

const FEATURE_TIERS = Object.freeze({
  input: 'core',
  'physics-2d': 'core',
  'physics-3d': 'core',
  ui: 'core',
  camera: 'core',
  animation: 'fidelity',
  'particles-vfx': 'fidelity',
  'rendering-shaders': 'fidelity',
  audio: 'fidelity',
  tweening: 'core',
  'timing-coroutines': 'core',
  'spawning-pooling': 'core',
  'runtime-loading': 'adapter',
  persistence: 'adapter',
  'analytics-monetization': 'lifecycle',
});

const FIDELITY_CHECKPOINTS = Object.freeze([
  Object.freeze({ id: 'input-response', weight: 15, mandatory: true, featureIds: ['input'] }),
  Object.freeze({ id: 'core-rules-state', weight: 20, mandatory: true, featureIds: [] }),
  Object.freeze({ id: 'interaction-motion', weight: 15, mandatory: false, featureIds: ['physics-2d', 'physics-3d', 'input'] }),
  Object.freeze({ id: 'spawn-timing', weight: 10, mandatory: false, featureIds: ['spawning-pooling', 'timing-coroutines', 'tweening'] }),
  Object.freeze({ id: 'win-lose-restart', weight: 15, mandatory: true, featureIds: [] }),
  Object.freeze({ id: 'camera-layout', weight: 5, mandatory: false, featureIds: ['camera', 'ui'] }),
  Object.freeze({ id: 'animation-vfx-feedback', weight: 10, mandatory: false, featureIds: ['animation', 'particles-vfx', 'rendering-shaders'] }),
  Object.freeze({ id: 'audio-feedback', weight: 5, mandatory: false, featureIds: ['audio'] }),
  Object.freeze({ id: 'playable-lifecycle-cta', weight: 5, mandatory: false, featureIds: ['analytics-monetization'] }),
]);

function normalizePortProfile(value) {
  const normalized = String(value || DEFAULT_PORT_PROFILE).trim().toLowerCase();
  if (!PORT_PROFILES.includes(normalized)) {
    const error = new Error(`Port profile khong ho tro: ${value}`);
    error.code = 'UNITY_PORT_PROFILE_INVALID';
    throw error;
  }
  return normalized;
}

function logicalPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  return /^(?:Assets|Packages)\//.test(normalized) ? normalized : null;
}

function scoreGameplayScene(scene) {
  const scenePath = logicalPath(scene && (scene.path || scene.assetPath));
  if (!scenePath) return null;
  let score = 0;
  if (scene.enabled) score += 30;
  if (scene.indexed !== false) score += 15;
  if (!scene.scope || scene.scope === 'runtime') score += 20;
  else score -= 200;
  for (const [pattern, value] of ENTRY_POSITIVE) if (pattern.test(scenePath)) score += value;
  for (const [pattern, value] of ENTRY_NEGATIVE) if (pattern.test(scenePath)) score += value;
  return { path: scenePath, score, enabled: !!scene.enabled, indexed: scene.indexed !== false };
}

function selectGameplayEntry(snapshot) {
  const buildScenes = Array.isArray(snapshot && snapshot.buildScenes) ? snapshot.buildScenes : [];
  const viewScenes = snapshot && snapshot.views && Array.isArray(snapshot.views.scenes) ? snapshot.views.scenes : [];
  const source = buildScenes.length ? buildScenes : viewScenes;
  const candidates = source
    .map(scoreGameplayScene)
    .filter(Boolean)
    .filter(scene => scene.enabled && scene.indexed)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  const primary = candidates[0] || null;
  const tied = primary ? candidates.filter(item => item.score === primary.score).length : 0;
  const positive = primary && primary.score >= 100;
  return {
    primary: primary && primary.path || null,
    confidence: !primary ? 'none' : positive && tied === 1 ? 'high' : positive ? 'medium' : 'low',
    needsDecision: !primary || !positive || tied > 1,
    candidates: candidates.slice(0, 4).map(item => [item.path, item.score]),
  };
}

function buildClosure(snapshot, seeds, options = {}) {
  const maxCodeDepth = Number.isInteger(options.maxCodeDepth) ? Math.max(0, options.maxCodeDepth) : 2;
  const assetOutgoing = new Map();
  const codeOutgoing = new Map();
  for (const edge of snapshot && snapshot.dependencies && snapshot.dependencies.edges || []) {
    const from = logicalPath(edge.from);
    const to = logicalPath(edge.to);
    if (!from || !to) continue;
    const target = edge.kind === 'code-type-reference' ? codeOutgoing : assetOutgoing;
    if (!target.has(from)) target.set(from, new Set());
    target.get(from).add(to);
  }
  const paths = new Set();
  const codeDepths = new Map();
  const distances = new Map();
  const queue = [];
  for (const seed of seeds) {
    const normalized = logicalPath(seed);
    if (!normalized || paths.has(normalized)) continue;
    paths.add(normalized);
    codeDepths.set(normalized, 0);
    distances.set(normalized, 0);
    queue.push({ path: normalized, codeDepth: 0 });
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const distance = distances.get(current.path) || 0;
    const visit = (next, codeDepth) => {
      if (paths.has(next) && (codeDepths.get(next) || 0) <= codeDepth) return;
      if (!paths.has(next)) {
        paths.add(next);
        distances.set(next, distance + 1);
      }
      codeDepths.set(next, codeDepth);
      queue.push({ path: next, codeDepth });
    };
    for (const next of assetOutgoing.get(current.path) || []) visit(next, current.codeDepth);
    if (current.codeDepth < maxCodeDepth) {
      for (const next of codeOutgoing.get(current.path) || []) visit(next, current.codeDepth + 1);
    }
  }
  return { paths, distances };
}

function classifyNonCore(assetPath, record) {
  if (record && ['editor', 'sample', 'vendor'].includes(record.scope)) {
    return {
      id: record.scope === 'editor' ? 'editor-only' : 'vendor-sample',
      disposition: 'defer',
      action: 'Do not port editor, sample or vendor implementation into the playable runtime.',
    };
  }
  const matches = NON_CORE_RULES.filter(rule => rule.pattern.test(assetPath));
  if (matches.length) return matches.find(rule => rule.id === 'ads-analytics') || matches[0];
  return null;
}

function groupClassifications(entries, maxExamples = 2) {
  const groups = new Map();
  for (const entry of entries) {
    const rule = entry.rule;
    if (!groups.has(rule.id)) {
      groups.set(rule.id, {
        id: rule.id,
        disposition: rule.disposition,
        count: 0,
        action: rule.action,
        examples: [],
      });
    }
    const group = groups.get(rule.id);
    group.count += 1;
    if (group.examples.length < maxExamples && !group.examples.includes(entry.path)) group.examples.push(entry.path);
  }
  return [...groups.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function filterCoreSnapshot(snapshot, includedPaths) {
  const records = snapshot && snapshot.assets && snapshot.assets.records || [];
  const scripts = snapshot && snapshot.scriptIndex && snapshot.scriptIndex.scripts || [];
  const packages = snapshot && snapshot.project && snapshot.project.packages || {};
  const blockers = snapshot && snapshot.features && snapshot.features.blockers || [];
  const keepPath = value => {
    const normalized = logicalPath(value);
    return normalized && includedPaths.has(normalized);
  };
  const filteredPackages = Object.fromEntries(Object.entries(packages)
    .filter(([name]) => CORE_PACKAGE_PATTERNS.some(pattern => pattern.test(name))));
  const filteredBlockers = blockers
    .map(blocker => ({ ...blocker, examples: (blocker.examples || []).filter(keepPath) }))
    .filter(blocker => blocker.examples.length);
  return {
    project: { ...(snapshot.project || {}), packages: filteredPackages },
    assets: { records: records.filter(record => keepPath(record.assetPath || record.path)) },
    scriptIndex: { scripts: scripts.filter(script => keepPath(script.assetPath || script.path)) },
    features: { blockers: filteredBlockers },
  };
}

function rankCoreScript(scriptPath) {
  let score = 0;
  if (/(?:gameplay|game[ _.-]?manager|level[ _.-]?(?:manager|controller)|board|grid|tile|player|input|spawn|puzzle|match)/i.test(scriptPath)) score += 80;
  if (/(?:controller|manager|system|state|model)/i.test(scriptPath)) score += 20;
  if (/\/(?:common|utility|utilities)\//i.test(scriptPath)) score -= 10;
  return score;
}

function rankCorePrefab(prefabPath) {
  let score = 0;
  if (/(?:gameplay|board|grid|tile|player|level|puzzle|root|manager)/i.test(prefabPath)) score += 80;
  if (/(?:^|[\/_. -])(?:ui|vfx|fx|particle|common|popup|icon)(?:[\/_. -]|$)/i.test(prefabPath)) score -= 50;
  return score;
}

function summarizeTypes(records) {
  const counts = {};
  for (const record of records) counts[record.type || 'asset'] = (counts[record.type || 'asset'] || 0) + 1;
  return Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 8);
}

function checkpointSourceEvidence(checkpoint, features, coreScripts) {
  const evidence = [];
  for (const feature of features) {
    if (!checkpoint.featureIds.includes(feature.id)) continue;
    for (const item of feature.evidence || []) {
      const itemPath = logicalPath(item.path);
      if (itemPath && !evidence.includes(itemPath)) evidence.push(itemPath);
    }
  }
  if (!evidence.length && ['core-rules-state', 'win-lose-restart'].includes(checkpoint.id)) {
    evidence.push(...coreScripts.slice(0, 2));
  }
  return evidence.slice(0, 3);
}

function fullProjectScope(snapshot) {
  const entry = selectGameplayEntry(snapshot);
  const records = snapshot && snapshot.assets && snapshot.assets.records || [];
  const features = snapshot && snapshot.features && snapshot.features.sketch || [];
  return {
    version: CORE_GAMEPLAY_SCOPE_VERSION,
    profile: 'full-project',
    entry,
    pathSet: null,
    adapterPathSet: new Set(),
    features,
    featureTiers: { full: features.map(feature => feature.id) },
    closure: { pathCount: records.length, includedCount: records.length, adapterCount: 0, byType: summarizeTypes(records) },
    coreScripts: [],
    entryPrefabs: [],
    adapters: [],
    excluded: [],
    checkpoints: FIDELITY_CHECKPOINTS.map(item => ({ ...item, sourceEvidence: [] })),
  };
}

function buildCoreGameplayScope(snapshot, options = {}) {
  const profile = normalizePortProfile(options.profile);
  if (profile === 'full-project') return fullProjectScope(snapshot);

  const entry = selectGameplayEntry(snapshot);
  const records = snapshot && snapshot.assets && snapshot.assets.records || [];
  const recordByPath = new Map(records.map(record => [logicalPath(record.assetPath || record.path), record]).filter(item => item[0]));
  const closure = buildClosure(snapshot, entry.primary ? [entry.primary] : []);
  const includedPaths = new Set();
  const adapterPaths = new Set();
  const reachableNonCore = [];
  for (const assetPath of closure.paths) {
    const rule = classifyNonCore(assetPath, recordByPath.get(assetPath));
    if (rule) {
      adapterPaths.add(assetPath);
      reachableNonCore.push({ path: assetPath, rule });
    } else includedPaths.add(assetPath);
  }
  if (entry.primary) includedPaths.add(entry.primary);

  const excludedEntries = [];
  for (const [assetPath, record] of recordByPath) {
    if (closure.paths.has(assetPath)) continue;
    const rule = classifyNonCore(assetPath, record);
    if (rule) excludedEntries.push({ path: assetPath, rule });
  }

  const coreSnapshot = filterCoreSnapshot(snapshot, includedPaths);
  const features = buildFeatureSketch(coreSnapshot, { maxEvidence: 3, maxFeatures: 20 })
    .map(feature => ({ ...feature, tier: FEATURE_TIERS[feature.id] || 'core' }));
  if (!features.some(feature => feature.id === 'input')) {
    const inputRule = FEATURE_RULES.find(rule => rule.id === 'input');
    features.unshift({
      id: 'input',
      label: inputRule.label,
      confidence: 'low',
      evidenceCount: 0,
      evidence: [],
      porting: { target: inputRule.target, action: `${inputRule.action} Query core scripts because no bounded input signal was found.` },
      priority: inputRule.priority,
      tier: 'core',
      coverageGap: true,
    });
  }
  const featureTiers = {};
  for (const feature of features) {
    if (!featureTiers[feature.tier]) featureTiers[feature.tier] = [];
    featureTiers[feature.tier].push(feature.id);
  }

  const scripts = snapshot && snapshot.scriptIndex && snapshot.scriptIndex.scripts || [];
  const coreScripts = scripts
    .map(script => logicalPath(script.assetPath || script.path))
    .filter(scriptPath => scriptPath && includedPaths.has(scriptPath))
    .sort((left, right) => rankCoreScript(right) - rankCoreScript(left) || left.localeCompare(right))
    .slice(0, 10);
  if (!coreScripts.length) {
    coreScripts.push(...scripts
      .map(script => logicalPath(script.assetPath || script.path))
      .filter(scriptPath => scriptPath && !classifyNonCore(scriptPath, recordByPath.get(scriptPath)) && rankCoreScript(scriptPath) >= 80)
      .sort((left, right) => rankCoreScript(right) - rankCoreScript(left) || left.localeCompare(right))
      .slice(0, 6));
  }

  const entryPrefabs = (snapshot && snapshot.views && snapshot.views.entryPrefabs || [])
    .map(prefab => logicalPath(prefab.assetPath || prefab.path))
    .filter(prefabPath => prefabPath && includedPaths.has(prefabPath))
    .sort((left, right) => rankCorePrefab(right) - rankCorePrefab(left) ||
      (closure.distances.get(left) || 9999) - (closure.distances.get(right) || 9999) || left.localeCompare(right))
    .slice(0, 8);
  const includedRecords = [...includedPaths].map(assetPath => recordByPath.get(assetPath)).filter(Boolean);
  const checkpoints = FIDELITY_CHECKPOINTS.map(checkpoint => ({
    id: checkpoint.id,
    weight: checkpoint.weight,
    mandatory: checkpoint.mandatory,
    sourceEvidence: checkpointSourceEvidence(checkpoint, features, coreScripts),
  }));

  return {
    version: CORE_GAMEPLAY_SCOPE_VERSION,
    profile,
    entry,
    pathSet: includedPaths,
    adapterPathSet: adapterPaths,
    features,
    featureTiers,
    closure: {
      pathCount: closure.paths.size,
      includedCount: includedPaths.size,
      adapterCount: adapterPaths.size,
      scriptCount: includedRecords.filter(record => record.type === 'script').length,
      prefabCount: includedRecords.filter(record => record.type === 'prefab').length,
      byType: summarizeTypes(includedRecords),
    },
    coreScripts,
    entryPrefabs,
    adapters: groupClassifications(reachableNonCore),
    excluded: groupClassifications(excludedEntries),
    checkpoints,
  };
}

function coreGameplayProjection(scope) {
  const compactGroup = item => ({
    id: item.id,
    disposition: item.disposition,
    count: item.count,
    examples: item.examples,
  });
  return {
    version: scope.version,
    profile: scope.profile,
    entry: scope.entry,
    closure: scope.closure,
    coreScripts: scope.coreScripts,
    entryPrefabs: scope.entryPrefabs,
    featureTiers: scope.featureTiers,
    adapters: scope.adapters.map(compactGroup),
    excluded: scope.excluded.map(compactGroup),
    acceptance: {
      runnableRequired: true,
      minimumFidelity: 80,
      targetFidelity: 90,
      scorePolicy: 'Only evidence-backed checkpoints count; compile confidence is not gameplay fidelity.',
      mandatory: scope.checkpoints.filter(item => item.mandatory).map(item => item.id),
      weights: scope.checkpoints.map(item => [item.id, item.weight]),
      sourceEvidence: Object.fromEntries(scope.checkpoints
        .filter(item => item.sourceEvidence.length)
        .map(item => [item.id, item.sourceEvidence.slice(0, 2)])),
      gates: ['verify.all', 'verify.gc', 'verify.assets', 'build.playable', 'verify.runtime', 'port.core.acceptance'],
    },
  };
}

module.exports = {
  CORE_GAMEPLAY_SCOPE_VERSION,
  DEFAULT_PORT_PROFILE,
  PORT_PROFILES,
  NON_CORE_RULES,
  FEATURE_TIERS,
  FIDELITY_CHECKPOINTS,
  normalizePortProfile,
  scoreGameplayScene,
  selectGameplayEntry,
  buildClosure,
  classifyNonCore,
  buildCoreGameplayScope,
  coreGameplayProjection,
};
