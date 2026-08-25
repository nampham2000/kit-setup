'use strict';

const { validateUnityProjectSnapshot } = require('./schema.cjs');
const {
  assertUnityLiveSnapshotPatch,
  computeStaticProjectFingerprint,
  diagnosticKey,
  stableStringify,
  sha256Hex,
} = require('./live-schema.cjs');

const SEVERITY_ORDER = new Map([['high', 3], ['medium', 2], ['low', 1]]);

function cloneValue(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const clone = Array.isArray(value) ? [] : {};
  seen.set(value, clone);
  if (Array.isArray(value)) {
    for (const item of value) clone.push(cloneValue(item, seen));
  } else {
    for (const [key, item] of Object.entries(value)) clone[key] = cloneValue(item, seen);
  }
  return clone;
}

function mismatchError(message) {
  const error = new Error(message);
  error.code = 'UNITY_LIVE_PROJECT_MISMATCH';
  return error;
}

function assetKey(record) {
  if (record && record.guid) return `guid:${String(record.guid).toLowerCase()}`;
  return `path:${String(record && (record.assetPath || record.path) || '')}`;
}

function edgeKey(edge) {
  return [
    edge && edge.from || '', edge && edge.to || '', edge && edge.guid || '', edge && edge.kind || 'asset',
    edge && edge.objectId || '', edge && edge.fieldPath || '',
  ].join('\0');
}

function unresolvedKey(item) {
  return [item && item.guid || '', item && item.category || '', item && item.source || ''].join('\0');
}

function mergeEvidence(left, right, limit = 10) {
  const values = [...(left || []), ...(right || [])]
    .filter(value => typeof value === 'string' && value)
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort();
  return values.slice(0, limit);
}

function mergeAssets(staticAssets, liveAssets) {
  const output = cloneValue(staticAssets || { count: 0, records: [] });
  const records = new Map();
  for (const record of output.records || []) records.set(assetKey(record), record);
  for (const liveRecord of liveAssets && liveAssets.records || []) {
    const key = assetKey(liveRecord);
    const previous = records.get(key);
    records.set(key, previous ? { ...previous, ...cloneValue(liveRecord) } : cloneValue(liveRecord));
  }
  output.records = [...records.values()].sort((a, b) =>
    String(a.assetPath || a.path || '').localeCompare(String(b.assetPath || b.path || '')) ||
    String(a.guid || '').localeCompare(String(b.guid || '')));
  output.count = output.records.length;
  return output;
}

function mergeEdges(staticEdges, liveEdges) {
  const edges = new Map();
  for (const edge of staticEdges || []) edges.set(edgeKey(edge), cloneValue(edge));
  for (const edge of liveEdges || []) {
    const key = edgeKey(edge);
    const previous = edges.get(key);
    if (!previous) {
      edges.set(key, cloneValue(edge));
      continue;
    }
    edges.set(key, {
      ...previous,
      ...cloneValue(edge),
      occurrences: Math.max(Number(previous.occurrences) || 1, Number(edge.occurrences) || 1),
      evidenceLines: [...new Set([...(previous.evidenceLines || []), ...(edge.evidenceLines || [])])]
        .filter(Number.isInteger).sort((a, b) => a - b).slice(0, 3),
      provider: previous.provider === edge.provider ? previous.provider : 'hybrid',
    });
  }
  return [...edges.values()].sort((a, b) =>
    String(a.from || '').localeCompare(String(b.from || '')) ||
    String(a.to || '').localeCompare(String(b.to || '')) ||
    String(a.kind || '').localeCompare(String(b.kind || '')) ||
    String(a.fieldPath || '').localeCompare(String(b.fieldPath || '')));
}

function mergeUnresolved(staticItems, liveItems, resolvedGuids = new Set()) {
  const items = new Map();
  for (const item of staticItems || []) {
    if (resolvedGuids.has(String(item && item.guid || '').toLowerCase())) continue;
    items.set(unresolvedKey(item), cloneValue(item));
  }
  for (const item of liveItems || []) {
    const key = unresolvedKey(item);
    const previous = items.get(key);
    items.set(key, previous ? {
      ...previous,
      ...cloneValue(item),
      occurrences: Math.max(Number(previous.occurrences) || 1, Number(item.occurrences) || 1),
      sources: mergeEvidence(previous.sources, item.sources, 5),
      kinds: mergeEvidence(previous.kinds, item.kinds, 10),
      fields: mergeEvidence(previous.fields, item.fields, 5),
    } : cloneValue(item));
  }
  return [...items.values()].sort((a, b) =>
    String(a.category || '').localeCompare(String(b.category || '')) ||
    String(a.guid || '').localeCompare(String(b.guid || '')) ||
    String(a.source || '').localeCompare(String(b.source || '')));
}

function mergeBlockers(staticBlockers, liveBlockers) {
  const blockers = new Map();
  for (const blocker of staticBlockers || []) blockers.set(String(blocker.id || blocker.label), cloneValue(blocker));
  for (const blocker of liveBlockers || []) {
    const key = String(blocker.id || blocker.label);
    const previous = blockers.get(key);
    blockers.set(key, previous ? {
      ...previous,
      ...cloneValue(blocker),
      count: Math.max(Number(previous.count) || 0, Number(blocker.count) || 0),
      examples: mergeEvidence(previous.examples, blocker.examples, 3),
    } : cloneValue(blocker));
  }
  return [...blockers.values()].sort((a, b) =>
    (Number(b.count) || 0) - (Number(a.count) || 0) || String(a.id || '').localeCompare(String(b.id || '')));
}

function conflictDiagnostic(message, evidence) {
  return {
    code: 'UNITY_PROVIDER_CONFLICT',
    severity: 'medium',
    message,
    action: 'Live Unity facts được ưu tiên; kiểm tra project/editor nếu khác biệt không mong đợi.',
    source: 'hybrid',
    count: 1,
    evidence: evidence ? [evidence] : [],
  };
}

function providerConflicts(snapshot, patch) {
  const conflicts = [];
  if (patch.project && patch.project.unityVersion && snapshot.project.unityVersion &&
      patch.project.unityVersion !== snapshot.project.unityVersion) {
    conflicts.push(conflictDiagnostic(
      `Unity version khác nhau giữa static (${snapshot.project.unityVersion}) và live (${patch.project.unityVersion}).`,
      snapshot.project.name,
    ));
  }
  const staticScenes = new Map((snapshot.buildScenes || []).map(scene => [String(scene.path), scene]));
  for (const scene of patch.buildScenes || []) {
    const previous = staticScenes.get(String(scene.path));
    if (!previous) continue;
    if (previous.enabled !== scene.enabled ||
        (previous.guid && scene.guid && String(previous.guid).toLowerCase() !== String(scene.guid).toLowerCase())) {
      conflicts.push(conflictDiagnostic(`Build scene ${scene.path} khác nhau giữa static và live.`, scene.path));
    }
  }
  return conflicts;
}

function normalizeDiagnostic(diagnostic, fallbackSource) {
  return {
    ...cloneValue(diagnostic),
    key: diagnosticKey(diagnostic),
    source: diagnostic.source || fallbackSource,
    count: Number.isFinite(diagnostic.count) ? diagnostic.count : 1,
    evidence: mergeEvidence([], diagnostic.evidence, 10),
  };
}

function mergeDiagnostics(staticDiagnostics, liveDiagnostics, resolvedKeys, conflicts, liveProvider) {
  const diagnostics = new Map();
  for (const diagnostic of staticDiagnostics || []) {
    const normalized = normalizeDiagnostic(diagnostic, 'static');
    if (!resolvedKeys.has(normalized.key)) diagnostics.set(normalized.key, normalized);
  }
  for (const diagnostic of [...(liveDiagnostics || []), ...(conflicts || [])]) {
    const normalized = normalizeDiagnostic(diagnostic, liveProvider || 'unity-mcp');
    const previous = diagnostics.get(normalized.key);
    if (!previous) {
      diagnostics.set(normalized.key, normalized);
      continue;
    }
    diagnostics.set(normalized.key, {
      ...previous,
      ...normalized,
      severity: (SEVERITY_ORDER.get(previous.severity) || 0) >= (SEVERITY_ORDER.get(normalized.severity) || 0)
        ? previous.severity : normalized.severity,
      count: Math.max(previous.count, normalized.count),
      evidence: mergeEvidence(previous.evidence, normalized.evidence, 10),
      source: previous.source === normalized.source ? previous.source : 'hybrid',
    });
  }
  return [...diagnostics.values()].sort((a, b) =>
    (SEVERITY_ORDER.get(b.severity) || 0) - (SEVERITY_ORDER.get(a.severity) || 0) ||
    String(a.code).localeCompare(String(b.code)) || a.key.localeCompare(b.key));
}

function classificationCounts(items) {
  const counts = {};
  for (const item of items || []) {
    const category = item.category || 'unknown';
    counts[category] = (counts[category] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function fingerprintHybridSnapshot(snapshot) {
  const copy = cloneValue(snapshot);
  delete copy.generatedAt;
  delete copy.cache;
  delete copy.metrics;
  delete copy.fingerprint;
  if (copy.project) {
    delete copy.project.root;
    delete copy.project.layout;
  }
  if (copy.source) {
    delete copy.source.root;
    delete copy.source.assetsRoot;
  }
  if (copy.live) delete copy.live.generatedAt;
  if (Array.isArray(copy.providers)) {
    copy.providers = copy.providers.map(provider => {
      const stable = { ...provider };
      delete stable.generatedAt;
      return stable;
    });
  }
  return sha256Hex(stableStringify(copy));
}

function mergeUnityProjectSnapshots(staticSnapshot, livePatch, options = {}) {
  const snapshotErrors = validateUnityProjectSnapshot(staticSnapshot);
  if (snapshotErrors.length) throw new Error(`Invalid static UnityProjectSnapshot: ${snapshotErrors.join('; ')}`);
  const expectedFingerprint = options.projectFingerprint || computeStaticProjectFingerprint(staticSnapshot);
  try {
    assertUnityLiveSnapshotPatch(livePatch, { expectedProjectFingerprint: expectedFingerprint });
  } catch (error) {
    if (/projectFingerprint/.test(error.message)) throw mismatchError(error.message);
    throw error;
  }
  if (livePatch.snapshotSchemaVersion !== staticSnapshot.schemaVersion) {
    throw new Error(`Live patch targets snapshot schema ${livePatch.snapshotSchemaVersion}, expected ${staticSnapshot.schemaVersion}`);
  }
  if (livePatch.project.name && livePatch.project.unityVersion && livePatch.buildScenes.length) {
    const liveIdentity = computeStaticProjectFingerprint({
      project: livePatch.project,
      buildScenes: livePatch.buildScenes,
    });
    if (liveIdentity !== expectedFingerprint) {
      throw mismatchError('Live patch project facts do not reproduce the requested project fingerprint');
    }
  }

  const merged = cloneValue(staticSnapshot);
  const conflicts = providerConflicts(staticSnapshot, livePatch);
  const liveProject = { ...cloneValue(livePatch.project) };
  delete liveProject.root;
  delete liveProject.layout;
  merged.project = { ...merged.project, ...liveProject };
  if (livePatch.buildScenes.length) {
    merged.buildScenes = cloneValue(livePatch.buildScenes).sort((a, b) =>
      String(a.path || '').localeCompare(String(b.path || '')) || String(a.guid || '').localeCompare(String(b.guid || '')));
  }
  merged.assets = mergeAssets(merged.assets, livePatch.assets);

  const edges = mergeEdges(merged.dependencies.edges, livePatch.dependencies.edges);
  const resolvedUnresolvedGuids = new Set((livePatch.resolvesUnresolvedGuids || [])
    .map(guid => String(guid).toLowerCase()));
  const unresolved = mergeUnresolved(
    merged.dependencies.unresolved,
    livePatch.dependencies.unresolved,
    resolvedUnresolvedGuids,
  );
  merged.dependencies = {
    ...merged.dependencies,
    ...cloneValue(livePatch.dependencies),
    edgeCount: edges.length,
    edges,
    unresolvedCount: unresolved.length,
    unresolved,
    classificationCounts: classificationCounts(unresolved),
  };

  merged.features = {
    ...(merged.features || {}),
    ...cloneValue(livePatch.features || {}),
    blockers: mergeBlockers(merged.features && merged.features.blockers, livePatch.features && livePatch.features.blockers),
  };
  const resolvedKeys = new Set(livePatch.resolvesDiagnosticKeys);
  merged.diagnostics = mergeDiagnostics(
    merged.diagnostics,
    livePatch.diagnostics,
    resolvedKeys,
    conflicts,
    livePatch.provider,
  );
  merged.provider = 'hybrid';
  merged.generatedAt = livePatch.generatedAt;
  merged.providers = [
    { provider: staticSnapshot.provider || 'static', generatedAt: staticSnapshot.generatedAt || null },
    { provider: livePatch.provider, generatedAt: livePatch.generatedAt, scanId: livePatch.scanId },
  ];
  merged.live = {
    status: 'ready',
    provider: livePatch.provider,
    scanId: livePatch.scanId,
    generatedAt: livePatch.generatedAt,
    projectFingerprint: livePatch.projectFingerprint,
    capabilities: cloneValue(livePatch.capabilities),
    facts: cloneValue(livePatch.facts),
  };
  merged.fingerprint = fingerprintHybridSnapshot(merged);

  const mergedErrors = validateUnityProjectSnapshot(merged);
  if (mergedErrors.length) throw new Error(`Merged UnityProjectSnapshot is invalid: ${mergedErrors.join('; ')}`);
  return merged;
}

module.exports = {
  assetKey,
  edgeKey,
  unresolvedKey,
  fingerprintHybridSnapshot,
  mergeUnityProjectSnapshots,
};
