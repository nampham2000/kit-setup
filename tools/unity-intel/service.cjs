'use strict';

const path = require('node:path');

const { buildUnityProjectSnapshot, findUnityProjectRoot } = require('./project-index.cjs');
const {
  doctorUnityEditor,
  readUnityCompileDiagnostics,
  readUnityPackageDiagnostics,
  refreshOpenUnityEditor,
} = require('./unity-editor.cjs');
const {
  rollbackUnityMcpPackages,
  SCANNER_PACKAGE_VERSION,
  setupUnityMcpPackages,
  validateUnityMcpPackageRollback,
} = require('./unity-bootstrap.cjs');
const {
  captureUnityBootstrapFootprint,
  rollbackUnityBootstrapFootprint,
  sealUnityBootstrapFootprint,
  validateUnityBootstrapFootprintRollback,
} = require('./unity-bootstrap-footprint.cjs');
const { ensureUnityMcpConfig, publicConnection, readUnityMcpConnection } = require('./unity-mcp-config.cjs');
const { runUnityBatchScan } = require('./unity-batch-provider.cjs');
const { computeStaticProjectFingerprint, diagnosticKey, sha256Hex, stableStringify } = require('./live-schema.cjs');
const { computeUnityProjectState } = require('./project-state.cjs');
const { mergeUnityProjectSnapshots } = require('./snapshot-merge.cjs');
const { buildFeatureSketch } = require('./feature-sketch.cjs');
const {
  SUMMARY_MAX_BYTES,
  createCompactPage,
  createCompactSummary,
  jsonBytes,
  sanitizeForProjection,
} = require('./compact-projection.cjs');

const PROVIDERS = new Set(['auto', 'static', 'unity-mcp']);
const DEFAULT_SCANNER_PACKAGE_ROOT = path.resolve(__dirname, '..', '..', 'packages', 'unity-intelligence');

class UnityIntelligenceError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'UnityIntelligenceError';
    this.code = code;
    this.details = details;
  }
}

function resolveProjectRoot(inputPath) {
  if (!inputPath) throw new UnityIntelligenceError('UNITY_PROJECT_REQUIRED', 'Thiếu Unity project path.');
  const resolved = path.resolve(inputPath);
  const projectRoot = findUnityProjectRoot(resolved);
  if (!projectRoot) {
    throw new UnityIntelligenceError(
      'UNITY_PROJECT_INVALID',
      `Không tìm thấy Unity project root từ ${resolved}. Cần Assets/ và ProjectSettings/.`,
    );
  }
  return projectRoot;
}

function normalizeProvider(value) {
  const provider = value || 'auto';
  if (!PROVIDERS.has(provider)) {
    throw new UnityIntelligenceError('UNITY_PROVIDER_INVALID', `Provider không hỗ trợ: ${provider}`);
  }
  return provider;
}

function unavailableDiagnostic(error, requestedProvider) {
  const code = error && error.code || 'UNITY_MCP_UNAVAILABLE';
  const transient = new Set([
    'UNITY_MCP_UNAVAILABLE', 'UNITY_MCP_NETWORK_ERROR', 'UNITY_MCP_TIMEOUT', 'UNITY_MCP_NOT_READY',
    'UNITY_MCP_CONFIG_MISSING', 'UNITY_MCP_CONNECTION_REQUIRED', 'ECONNREFUSED', 'ECONNRESET',
  ]);
  return {
    code,
    severity: transient.has(code) ? 'low' : 'medium',
    message: requestedProvider === 'auto'
      ? 'Unity-MCP chưa sẵn sàng; scan tiếp tục bằng static provider.'
      : 'Unity-MCP chưa sẵn sàng.',
    action: 'Chạy `npm run unity:intel:setup -- --project <UnityProjectRoot>` để cài package, reload và scan tự động.',
    count: 1,
    evidence: [],
    source: 'unity-intel',
  };
}

function addFeatureSketch(snapshot) {
  snapshot.features = snapshot.features || {};
  snapshot.features.sketchVersion = 1;
  snapshot.features.sketch = buildFeatureSketch(snapshot);
  return snapshot;
}

function decorateStaticFallback(snapshot, fingerprint, error, requestedProvider) {
  snapshot.scanId = fingerprint;
  snapshot.live = {
    status: requestedProvider === 'static' ? 'not-requested' : 'unavailable',
    provider: null,
    scanId: fingerprint,
    projectFingerprint: fingerprint,
    capabilities: { playModeCapture: false },
    reason: error ? { code: error.code || 'UNITY_MCP_UNAVAILABLE', message: String(error.message || error) } : null,
  };
  if (error) snapshot.diagnostics.push(unavailableDiagnostic(error, requestedProvider));
  return addFeatureSketch(snapshot);
}

function assertStableProjectState(before, after) {
  if (!before || before.fingerprint === after.fingerprint) return;
  throw new UnityIntelligenceError(
    'UNITY_SOURCE_CHANGED_DURING_SCAN',
    'Unity source thay đổi trong khi scanner đang chạy; hãy chờ Editor/import ổn định rồi scan lại.',
    {
      beforeFingerprint: before.fingerprint,
      afterFingerprint: after.fingerprint,
      beforeFileCount: before.fileCount,
      afterFileCount: after.fileCount,
    },
  );
}

function finalizeSnapshotState(projectRoot, snapshot, projectFingerprint, options = {}) {
  const computeProjectState = options.computeProjectState || computeUnityProjectState;
  const state = computeProjectState(projectRoot);
  assertStableProjectState(options.expectedState, state);
  const providerScanId = snapshot.live && snapshot.live.scanId || snapshot.scanId || projectFingerprint;
  snapshot.projectFingerprint = projectFingerprint;
  snapshot.stateFingerprint = state.fingerprint;
  snapshot.scanId = sha256Hex(stableStringify({
    projectFingerprint,
    stateFingerprint: state.fingerprint,
    provider: snapshot.provider,
    providerScanId,
  })).slice(0, 32);
  snapshot.state = {
    schemaVersion: state.schemaVersion,
    fingerprint: state.fingerprint,
    fileCount: state.fileCount,
    extractorFingerprint: state.extractorFingerprint,
  };
  return snapshot;
}

function scanResult(projectRoot, snapshot, projectFingerprint, doctor, setup, options = {}) {
  finalizeSnapshotState(projectRoot, snapshot, projectFingerprint, options);
  return {
    projectRoot,
    snapshot,
    summary: createCompactSummary(snapshot),
    doctor: publicDoctor(doctor),
    setup,
  };
}

function publicDoctor(doctor) {
  if (!doctor) return null;
  return sanitizeForProjection({
    ok: doctor.ok,
    ready: doctor.ready,
    canLaunch: doctor.canLaunch,
    canAttach: doctor.canAttach,
    project: doctor.project && {
      name: path.basename(doctor.project.projectRoot || ''),
      unityVersion: doctor.project.unityVersion,
      unityRevision: doctor.project.unityRevision,
    },
    editor: doctor.editor && {
      status: doctor.editor.status,
      version: doctor.editor.editor && doctor.editor.editor.version,
      revision: doctor.editor.requiredRevision || null,
      source: doctor.editor.source || null,
    },
    lock: doctor.lock && { state: doctor.lock.state, locked: doctor.lock.locked },
    remediation: doctor.remediation && {
      available: true,
      executable: path.basename(doctor.remediation.executable || ''),
      args: doctor.remediation.args,
    },
    issues: doctor.issues,
  }, { maxString: 320, maxArray: 30 });
}

function publicSetup(setup, connection) {
  if (!setup && !connection) return null;
  return sanitizeForProjection({
    changed: !!(setup && setup.changed),
    packages: setup ? {
      scanner: setup.scannerPackageSpec,
      upstream: setup.upstreamPackageSpec,
    } : null,
    connection: connection ? publicConnection(connection) : null,
    reload: setup && setup.reload || null,
  }, { maxString: 320, maxArray: 20 });
}

function createCompactScanEnvelope(result) {
  const environment = { doctor: result.doctor, setup: result.setup };
  const full = { ...result.summary, environment };
  if (jsonBytes(full) <= SUMMARY_MAX_BYTES) return full;
  const reduced = {
    ...result.summary,
    environment: {
      doctor: result.doctor ? {
        ready: result.doctor.ready,
        canLaunch: result.doctor.canLaunch,
        canAttach: result.doctor.canAttach,
        lock: result.doctor.lock,
        issueCount: Array.isArray(result.doctor.issues) ? result.doctor.issues.length : 0,
      } : null,
      setup: result.setup ? {
        changed: result.setup.changed,
        reload: result.setup.reload,
      } : null,
      truncated: true,
    },
  };
  return jsonBytes(reduced) <= SUMMARY_MAX_BYTES ? reduced : result.summary;
}

async function inspectUnityProject(input = {}, injected = {}) {
  const projectRoot = resolveProjectRoot(input.project || input.sourceRoot);
  const doctor = (injected.doctor || doctorUnityEditor)(projectRoot, { editorPath: input.unity });
  let connection = null;
  try {
    connection = (injected.readConnection || readUnityMcpConnection)(projectRoot, {
      url: input.mcpUrl,
      token: input.mcpToken,
    });
  } catch (error) {
    connection = { error: { code: error.code || 'UNITY_MCP_CONFIG_INVALID', message: error.message } };
  }
  let liveMcp = {
    configured: Boolean(connection && connection.url),
    transportAuthenticated: false,
    toolReady: false,
    toolId: 'playable-port-scan',
  };
  if (connection && connection.url) {
    try {
      const provider = injected.liveProvider || defaultLiveProvider();
      const probe = await callProbe(provider, connection, {
        probeTimeoutMs: input.timeoutMs || input.probeTimeoutMs || 3_000,
      });
      if (probe === false || probe && probe.ready === false) {
        throw new UnityIntelligenceError('UNITY_MCP_NOT_READY', 'Unity-MCP scanner tool chưa sẵn sàng.');
      }
      liveMcp = {
        ...liveMcp,
        transportAuthenticated: true,
        toolReady: true,
        scannerPackageVersion: probe && probe.packageVersion || null,
        protocolVersion: probe && probe.protocolVersion || null,
      };
    } catch (error) {
      const causeCode = error && error.code || 'UNITY_MCP_UNAVAILABLE';
      liveMcp = {
        ...liveMcp,
        // Endpoint configuration alone must not be advertised as a usable
        // live scanner; the playable-port-scan invocation must complete.
        error: {
          code: causeCode === 'UNITY_MCP_TIMEOUT'
            ? 'UNITY_MCP_TOOL_UNRESPONSIVE' : causeCode,
          causeCode,
          message: causeCode === 'UNITY_MCP_TIMEOUT'
            ? 'Unity-MCP endpoint/playable-port-scan không trả kết quả trong deadline.'
            : String(error.message || error),
        },
      };
    }
  }
  return {
    schemaVersion: 1,
    project: path.basename(projectRoot),
    doctor: publicDoctor(doctor),
    connection: connection && connection.url
      ? publicConnection(connection)
      : connection,
    canUseLiveMcp: liveMcp.toolReady,
    liveMcp: sanitizeForProjection(liveMcp, { maxString: 320, maxArray: 8, maxDepth: 4 }),
  };
}

function defaultLiveProvider() {
  const provider = require('./unity-mcp-provider.cjs');
  if (typeof provider.createUnityMcpProvider === 'function') {
    const instance = provider.createUnityMcpProvider();
    return { probe: instance.probe, scan: instance.scan };
  }
  const probe = provider.probeUnityMcp || provider.probeUnityMcpEndpoint || provider.probe;
  const scan = provider.scanUnityProjectViaMcp || provider.scanUnityMcp || provider.scan;
  const wait = provider.waitForUnityMcp || provider.waitForUnityMcpEndpoint || provider.waitUntilReady;
  if (typeof probe !== 'function' || typeof scan !== 'function') {
    throw new UnityIntelligenceError('UNITY_MCP_PROVIDER_INVALID', 'Unity-MCP provider thiếu probe/scan API.');
  }
  return { probe, scan, wait };
}

async function callProbe(provider, connection, options) {
  const timeoutMs = options.probeTimeoutMs || Math.min(options.timeoutMs || 10_000, 1_500);
  return provider.probe({
    url: connection.url,
    token: connection.token,
    timeoutMs,
    requestTimeoutMs: timeoutMs,
  });
}

async function callScan(provider, connection, fingerprint, options, candidates = {}) {
  return provider.scan({
    url: connection.url,
    token: connection.token,
    projectFingerprint: fingerprint,
    timeoutMs: options.timeoutMs,
    requestTimeoutMs: options.requestTimeoutMs || Math.min(options.timeoutMs || 120_000, 120_000),
    action: 'scan',
    unresolvedGuids: candidates.unresolvedGuids || [],
    serializedAssetPaths: candidates.serializedAssetPaths || [],
  });
}

async function waitAndScan(provider, connection, fingerprint, options) {
  if (typeof provider.wait === 'function') {
    await provider.wait({
      url: connection.url,
      token: connection.token,
      timeoutMs: options.timeoutMs,
    });
  } else {
    const probe = await provider.probe({
      url: connection.url,
      token: connection.token,
      timeoutMs: options.timeoutMs || 180_000,
      requestTimeoutMs: Math.min(options.requestTimeoutMs || 15_000, options.timeoutMs || 180_000),
    });
    if (probe === false || probe && probe.ready === false) {
      throw new UnityIntelligenceError('UNITY_MCP_UNAVAILABLE', 'Unity-MCP endpoint chưa sẵn sàng.');
    }
  }
  // Upgrade readiness must remain callable through the previously installed
  // scanner. In particular scanner 0.2 does not declare the candidate fields,
  // so omitting them (rather than sending empty arrays) lets domain reload be
  // observed before the first 0.3 candidate-aware scan.
  return provider.scan({
    url: connection.url,
    token: connection.token,
    projectFingerprint: fingerprint,
    timeoutMs: options.timeoutMs,
    requestTimeoutMs: options.requestTimeoutMs || Math.min(options.timeoutMs || 120_000, 120_000),
    action: 'scan',
  });
}

const BOOTSTRAP_SCANNER_RETRY_CODES = new Set([
  'UNITY_SCANNER_VERSION_MISMATCH',
  'UNITY_SCANNER_CAPABILITY_MISSING',
  'UNITY_MCP_NOT_READY',
  'UNITY_MCP_NETWORK_ERROR',
]);

async function waitForBootstrapScannerPatch(
  provider,
  connection,
  fingerprint,
  options,
  candidates = {},
  runtime = {},
) {
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.floor(options.timeoutMs))
    : 180_000;
  const now = typeof runtime.now === 'function' ? runtime.now : Date.now;
  const sleep = typeof runtime.sleep === 'function'
    ? runtime.sleep
    : delayMs => new Promise(resolve => setTimeout(resolve, delayMs));
  const deadline = now() + timeoutMs;
  let attempts = 0;
  let retryDelayMs = 100;
  let lastError = null;

  while (now() < deadline) {
    const remainingMs = Math.max(1, deadline - now());
    attempts += 1;
    try {
      const result = await waitAndScan(provider, connection, fingerprint, {
        ...options,
        timeoutMs: remainingMs,
        probeTimeoutMs: Math.min(options.probeTimeoutMs || 1_500, remainingMs),
        requestTimeoutMs: Math.min(options.requestTimeoutMs || 120_000, remainingMs),
      });
      assertBootstrapScannerPatch(result, candidates);
      return result;
    } catch (error) {
      if (!BOOTSTRAP_SCANNER_RETRY_CODES.has(error && error.code)) throw error;
      lastError = error;
      const remainingAfterAttempt = deadline - now();
      if (remainingAfterAttempt <= 0) break;
      const delayMs = Math.min(retryDelayMs, remainingAfterAttempt);
      await sleep(delayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, 1_000);
    }
  }

  if (lastError) {
    lastError.details = {
      ...(lastError.details || {}),
      attempts,
      retryWindowMs: timeoutMs,
    };
    throw lastError;
  }
  throw new UnityIntelligenceError(
    'UNITY_MCP_TIMEOUT',
    `Unity Editor không sẵn sàng trong ${timeoutMs} ms.`,
    { attempts, retryWindowMs: timeoutMs },
  );
}

function unwrapPatch(value) {
  if (value && value.patch) return value.patch;
  if (value && value.result && value.result.kind === 'unity-live-patch') return value.result;
  return value;
}

function assertBootstrapScannerPatch(value, candidates = {}) {
  const patch = unwrapPatch(value);
  if (!patch || patch.packageVersion !== SCANNER_PACKAGE_VERSION || patch.protocolVersion !== 1) {
    throw new UnityIntelligenceError(
      'UNITY_SCANNER_VERSION_MISMATCH',
      `Unity Editor chưa reload scanner ${SCANNER_PACKAGE_VERSION}; giữ nguyên setup và thử lại sau domain reload.`,
      { expectedPackageVersion: SCANNER_PACKAGE_VERSION, actualPackageVersion: patch && patch.packageVersion || null },
    );
  }
  const hasCandidates = (candidates.unresolvedGuids || []).length > 0 ||
    (candidates.serializedAssetPaths || []).length > 0;
  if (hasCandidates && (!patch.capabilities || patch.capabilities.candidateDisposition !== true)) {
    throw new UnityIntelligenceError(
      'UNITY_SCANNER_CAPABILITY_MISSING',
      'Unity Editor trả scanner chưa hỗ trợ candidateDisposition; chờ domain reload rồi scan lại.',
    );
  }
  return patch;
}

function reachableAssetPaths(snapshot) {
  const outgoing = new Map();
  for (const edge of snapshot.dependencies && snapshot.dependencies.edges || []) {
    if (!edge || !edge.from || !edge.to) continue;
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, new Set());
    outgoing.get(edge.from).add(edge.to);
  }
  const reachable = new Set((snapshot.buildScenes || [])
    .filter(scene => scene.enabled && scene.indexed && scene.gameplayCandidate !== false)
    .map(scene => scene.path));
  const queue = [...reachable];
  for (let index = 0; index < queue.length; index += 1) {
    for (const target of outgoing.get(queue[index]) || []) {
      if (!reachable.has(target)) { reachable.add(target); queue.push(target); }
    }
  }
  return reachable;
}

function buildLiveCandidateRequest(snapshot) {
  const unresolvedAll = [...new Set((snapshot.dependencies && snapshot.dependencies.unresolved || [])
    .filter(item => item && item.category === 'reachable-missing' && /^[0-9a-f]{32}$/i.test(String(item.guid || '')))
    .map(item => String(item.guid).toLowerCase()))].sort();
  const reachable = reachableAssetPaths(snapshot);
  const serializedAll = [...new Set((snapshot.assets && snapshot.assets.records || [])
    .filter(record => record && record.serialization && record.serialization.complete === false && reachable.has(record.assetPath))
    .map(record => record.assetPath)
    .filter(value => /^(?:Assets|Packages)\//.test(String(value || ''))))].sort();
  return {
    unresolvedGuids: unresolvedAll.slice(0, 512),
    unresolvedComplete: unresolvedAll.length <= 512,
    serializedAssetPaths: serializedAll.slice(0, 96),
    serializedComplete: serializedAll.length <= 96,
  };
}

function applyLiveCandidateDispositions(staticSnapshot, patch, request) {
  const dispositions = (Array.isArray(patch.candidateDispositions) ? patch.candidateDispositions : [])
    .map(item => {
      if (!item || item.status !== 'resolved') return item;
      const hasCompleteReferences = item.referencesComplete === true;
      const hasCompleteSerialization = item.kind !== 'serialized-asset' || item.serializedScanComplete === true;
      return hasCompleteReferences && hasCompleteSerialization ? item : { ...item, status: 'partial' };
    });
  patch.resolvesDiagnosticKeys = Array.isArray(patch.resolvesDiagnosticKeys) ? patch.resolvesDiagnosticKeys : [];
  patch.resolvesUnresolvedGuids = Array.isArray(patch.resolvesUnresolvedGuids)
    ? patch.resolvesUnresolvedGuids : [];
  patch.diagnostics = Array.isArray(patch.diagnostics) ? patch.diagnostics : [];
  patch.assets = patch.assets && Array.isArray(patch.assets.records) ? patch.assets : { records: [] };
  patch.dependencies = patch.dependencies && Array.isArray(patch.dependencies.edges) &&
    Array.isArray(patch.dependencies.unresolved) ? patch.dependencies : { edges: [], unresolved: [] };
  const resolvedKeys = new Set(patch.resolvesDiagnosticKeys);

  function dispositionGroup(kind, requested, complete, code, action) {
    if (!requested.length || !complete) return null;
    const byKey = new Map(dispositions
      .filter(item => item && item.kind === kind && requested.includes(item.key))
      .map(item => [item.key, item]));
    if (!requested.every(key => byKey.has(key))) return null;
    for (const diagnostic of staticSnapshot.diagnostics || []) {
      if (diagnostic.code === code && diagnostic.severity === 'high') resolvedKeys.add(diagnosticKey(diagnostic));
    }
    const unresolved = requested.filter(key => byKey.get(key).status !== 'resolved');
    if (unresolved.length) patch.diagnostics.push({
      code,
      severity: 'high',
      message: `Unity Editor confirmed ${unresolved.length} missing/partial candidate(s).`,
      action,
      count: unresolved.length,
      evidence: unresolved.slice(0, 10),
      source: patch.provider || 'unity-mcp',
    });
    return byKey;
  }

  const guidDispositions = dispositionGroup(
    'guid', request.unresolvedGuids, request.unresolvedComplete,
    'UNITY_REACHABLE_GUID_UNRESOLVED',
    'Restore or replace the missing reachable asset reference before implementation.',
  );
  if (guidDispositions) {
    const resolvedUnresolved = new Set(patch.resolvesUnresolvedGuids.map(value => String(value).toLowerCase()));
    for (const guid of request.unresolvedGuids) {
      const disposition = guidDispositions.get(guid);
      if (disposition.status === 'resolved') {
        resolvedUnresolved.add(guid);
        patch.assets.records.push({
          guid,
          assetPath: disposition.assetPath,
          type: disposition.assetType || 'Unknown',
          resolution: 'unity-editor-confirmed',
          provider: patch.provider || 'unity-mcp',
          dependencyCount: Number(disposition.dependencyCount) || 0,
        });
        const original = (staticSnapshot.dependencies && staticSnapshot.dependencies.unresolved || [])
          .find(item => String(item.guid || '').toLowerCase() === guid);
        const sourceEvidence = original && Array.isArray(original.sourceEvidence) && original.sourceEvidence.length
          ? original.sourceEvidence
          : (original && (original.sources || (original.source ? [original.source] : [])) || [])
            .map(source => ({
              source,
              kinds: original && original.kinds || [],
              fields: original && original.fields || [],
              occurrences: original && original.occurrences,
            }));
        for (const evidence of sourceEvidence) patch.dependencies.edges.push({
          from: evidence.source,
          to: disposition.assetPath,
          guid,
          kind: evidence.kinds && evidence.kinds[0] || 'asset',
          resolution: 'unity-editor-confirmed',
          objectId: null,
          classId: null,
          fieldPath: evidence.fields && evidence.fields[0] || '',
          occurrences: Number(evidence.occurrences) || 1,
          provider: patch.provider || 'unity-mcp',
          evidenceLines: [],
        });
        for (const reference of disposition.references || []) patch.dependencies.edges.push({
          from: disposition.assetPath,
          to: reference.assetPath,
          guid: reference.guid || null,
          kind: 'live-asset-dependency',
          resolution: 'unity-editor-confirmed',
          objectId: reference.objectId || null,
          classId: null,
          fieldPath: reference.fieldPath || '',
          occurrences: 1,
          provider: patch.provider || 'unity-mcp',
          evidenceLines: [],
        });
      } else if (disposition.status === 'missing') {
        resolvedUnresolved.add(guid);
        const original = (staticSnapshot.dependencies && staticSnapshot.dependencies.unresolved || [])
          .find(item => String(item.guid || '').toLowerCase() === guid);
        patch.dependencies.unresolved.push({
          ...(original || { guid, category: 'reachable-missing' }),
          guid,
          confirmation: 'unity-editor-missing',
          provider: patch.provider || 'unity-mcp',
        });
      }
    }
    patch.resolvesUnresolvedGuids = [...resolvedUnresolved].sort();
  }

  const serializedDispositions = dispositionGroup(
    'serialized-asset', request.serializedAssetPaths, request.serializedComplete,
    'UNITY_SERIALIZED_FILE_PARTIAL',
    'Fix the Unity importer/serialized asset before implementation.',
  );
  if (serializedDispositions) {
    const records = staticSnapshot.assets && staticSnapshot.assets.records || [];
    for (const assetPath of request.serializedAssetPaths) {
      const disposition = serializedDispositions.get(assetPath);
      if (disposition.status !== 'resolved') continue;
      const original = records.find(record => record.assetPath === assetPath) || {};
      patch.assets.records.push({
        guid: original.guid || undefined,
        assetPath,
        type: disposition.assetType || original.type || 'Unknown',
        dependencyCount: Number(disposition.dependencyCount) || 0,
        serialization: {
          ...(original.serialization || {}),
          complete: true,
          liveConfirmed: true,
          provider: patch.provider || 'unity-mcp',
        },
      });
      for (const reference of disposition.references || []) patch.dependencies.edges.push({
        from: assetPath,
        to: reference.assetPath,
        guid: reference.guid || null,
        kind: 'live-serialized-reference',
        resolution: 'unity-editor-confirmed',
        objectId: reference.objectId || null,
        classId: null,
        fieldPath: reference.fieldPath || '',
        occurrences: 1,
        provider: patch.provider || 'unity-mcp',
        evidenceLines: [],
      });
    }
  }
  patch.resolvesDiagnosticKeys = [...resolvedKeys].sort();
  patch.capabilities = { ...(patch.capabilities || {}), candidateDisposition: dispositions.length > 0 ||
    (!request.unresolvedGuids.length && !request.serializedAssetPaths.length) };
  return patch;
}

async function scanUnityProject(input = {}, injected = {}) {
  const projectRoot = resolveProjectRoot(input.project || input.sourceRoot);
  const providerMode = normalizeProvider(input.provider);
  const computeProjectState = injected.computeProjectState || computeUnityProjectState;
  const buildStaticSnapshot = injected.buildStaticSnapshot || buildUnityProjectSnapshot;
  const staticInput = {
    projectRoot,
    sourceRoot: input.sourceRoot || path.join(projectRoot, 'Assets'),
    includeVendor: !!input.includeVendor,
    cache: input.cache !== false,
    cacheDir: input.cacheDir,
    refreshCache: !!input.refreshCache,
  };
  // Every parse is bracketed by project-state fingerprints. Bootstrap owns a
  // small set of project mutations, so it rebuilds the static snapshot after
  // setup/reload and brackets that rebuilt snapshot with a fresh baseline.
  const stateBeforeScan = computeProjectState(projectRoot);
  const consistencyOptions = expectedState => ({ expectedState, computeProjectState });
  let staticSnapshot = buildStaticSnapshot(staticInput);
  let fingerprint = computeStaticProjectFingerprint(staticSnapshot);
  let liveCandidates = buildLiveCandidateRequest(staticSnapshot);
  function rebuildAfterBootstrap() {
    const expectedState = computeProjectState(projectRoot);
    staticSnapshot = buildStaticSnapshot(staticInput);
    fingerprint = computeStaticProjectFingerprint(staticSnapshot);
    liveCandidates = buildLiveCandidateRequest(staticSnapshot);
    return expectedState;
  }
  const doctor = (injected.doctor || doctorUnityEditor)(projectRoot, { editorPath: input.unity });
  let setup = null;
  let connection = null;
  let configTransaction = null;
  let bootstrapFootprint = null;
  let bootstrapReloadStarted = false;

  if (providerMode === 'static' && !input.bootstrap) {
    const snapshot = decorateStaticFallback(staticSnapshot, fingerprint, null, providerMode);
    return scanResult(projectRoot, snapshot, fingerprint, doctor, null, consistencyOptions(stateBeforeScan));
  }

  try {
    if (input.bootstrap) {
      if (!doctor.canLaunch && !doctor.canAttach) {
        throw new UnityIntelligenceError(
          'UNITY_BOOTSTRAP_NO_SAFE_EDITOR',
          'Không có đường chạy an toàn: cần đúng Unity Editor version và project phải launch được hoặc attach được Editor đang giữ lock.',
          { doctor: publicDoctor(doctor) },
        );
      }
      bootstrapFootprint = (injected.captureFootprint || captureUnityBootstrapFootprint)(projectRoot);
      const scannerPackageRoot = path.resolve(input.scannerPackageRoot || DEFAULT_SCANNER_PACKAGE_ROOT);
      setup = (injected.setupPackages || setupUnityMcpPackages)(projectRoot, {
        scannerPackageSpec: `file:${scannerPackageRoot.replace(/\\/g, '/')}`,
      });
      const config = (injected.ensureConfig || ensureUnityMcpConfig)(projectRoot, {
        url: input.mcpUrl,
        token: input.mcpToken,
      });
      configTransaction = config;
      connection = { url: config.url, token: config.token, source: 'managed-project-config' };

      if (doctor.canAttach && (setup.changed || config.changed)) {
        // An open Editor may have Auto Refresh disabled. Dispatch Unity's own
        // Assets > Refresh command to the PID recorded by this exact project;
        // the helper revalidates the process command line before sending keys.
        // Mark reload ownership ambiguous first because Unity can observe the
        // manifest mutation independently of this best-effort signal.
        bootstrapReloadStarted = true;
        const refreshEditor = injected.refreshOpenEditor || refreshOpenUnityEditor;
        await Promise.resolve(refreshEditor(projectRoot));
      }

      if (doctor.canLaunch) {
        const runBatch = injected.runBatch || runUnityBatchScan;
        bootstrapReloadStarted = true;
        const readiness = await runBatch({
          editorExe: doctor.editor.editor.path,
          projectRoot,
          projectFingerprint: fingerprint,
          timeoutMs: input.timeoutMs,
          keepArtifacts: !!input.keepUnityArtifacts,
          unresolvedGuids: liveCandidates.unresolvedGuids,
          serializedAssetPaths: liveCandidates.serializedAssetPaths,
        });
        assertBootstrapScannerPatch(readiness, liveCandidates);
        bootstrapFootprint = (injected.sealFootprint || sealUnityBootstrapFootprint)(bootstrapFootprint);
        // Package import/domain reload is an intentional bootstrap mutation.
        // Rebuild the static baseline first, then require a second Editor scan
        // against that exact baseline before its evidence can authorize writes.
        const stateAfterBootstrap = rebuildAfterBootstrap();
        const confirmation = await runBatch({
          editorExe: doctor.editor.editor.path,
          projectRoot,
          projectFingerprint: fingerprint,
          timeoutMs: input.timeoutMs,
          keepArtifacts: !!input.keepUnityArtifacts,
          unresolvedGuids: liveCandidates.unresolvedGuids,
          serializedAssetPaths: liveCandidates.serializedAssetPaths,
        });
        const patch = applyLiveCandidateDispositions(
          staticSnapshot,
          assertBootstrapScannerPatch(confirmation, liveCandidates),
          liveCandidates,
        );
        const merged = addFeatureSketch(mergeUnityProjectSnapshots(staticSnapshot, patch));
        setup.reload = { mode: 'batch', completed: true };
        return scanResult(
          projectRoot,
          merged,
          fingerprint,
          doctor,
          publicSetup(setup, connection),
          consistencyOptions(stateAfterBootstrap),
        );
      }
      // A held lock means an existing Editor owns reload/import. Never start a second instance.
      setup.reload = { mode: doctor.canAttach ? 'existing-editor' : 'unavailable', completed: false };
    } else {
      connection = (injected.readConnection || readUnityMcpConnection)(projectRoot, {
        url: input.mcpUrl,
        token: input.mcpToken,
      });
    }

    const liveProvider = injected.liveProvider || defaultLiveProvider();
    let liveResult;
    let stateAfterBootstrap = stateBeforeScan;
    if (input.bootstrap) {
      // First scan waits for import/domain reload. It is deliberately not
      // trusted as final evidence because the static baseline predates setup.
      bootstrapReloadStarted = true;
      const readiness = await waitForBootstrapScannerPatch(
        liveProvider,
        connection,
        fingerprint,
        input,
        liveCandidates,
        { now: injected.now, sleep: injected.sleep },
      );
      bootstrapFootprint = (injected.sealFootprint || sealUnityBootstrapFootprint)(bootstrapFootprint);
      stateAfterBootstrap = rebuildAfterBootstrap();
      liveResult = await callScan(liveProvider, connection, fingerprint, input, liveCandidates);
      assertBootstrapScannerPatch(liveResult, liveCandidates);
    }
    else {
      const probe = await callProbe(liveProvider, connection, input);
      if (probe === false || probe && probe.ready === false) {
        throw new UnityIntelligenceError('UNITY_MCP_UNAVAILABLE', 'Unity-MCP endpoint chưa sẵn sàng.');
      }
      liveResult = await callScan(liveProvider, connection, fingerprint, input, liveCandidates);
    }
    const patch = applyLiveCandidateDispositions(
      staticSnapshot,
      unwrapPatch(liveResult),
      liveCandidates,
    );
    const merged = addFeatureSketch(mergeUnityProjectSnapshots(staticSnapshot, patch));
    if (setup && setup.reload) setup.reload.completed = true;
    return scanResult(
      projectRoot,
      merged,
      fingerprint,
      doctor,
      publicSetup(setup, connection),
      consistencyOptions(stateAfterBootstrap),
    );
  } catch (error) {
    if (input.bootstrap && !input.keepOnFailure && !error.processStillRunning && !bootstrapReloadStarted) {
      const rollback = { config: 'not-needed', manifest: 'not-needed', footprint: 'not-needed' };
      const validationErrors = [];
      const validate = (step, action) => {
        try { action(); } catch (validationError) {
          validationErrors.push({ step, code: validationError.code || 'validation-failed' });
        }
      };

      if (configTransaction && configTransaction.changed) {
        validate('config', () => {
          if (typeof configTransaction.validateRollback === 'function') configTransaction.validateRollback();
          else if (typeof injected.validateConfigRollback === 'function') injected.validateConfigRollback(configTransaction);
        });
      }
      if (setup && setup.transaction) {
        validate('manifest', () => {
          const validator = injected.validatePackageRollback ||
            (injected.rollbackPackages ? null : validateUnityMcpPackageRollback);
          if (validator) validator(setup.transaction);
        });
      }
      if (bootstrapFootprint && bootstrapFootprint.sealed === true) {
        validate('footprint', () => {
          const validator = injected.validateFootprintRollback ||
            (injected.rollbackFootprint ? null : validateUnityBootstrapFootprintRollback);
          if (!validator) return;
          const result = validator(bootstrapFootprint);
          if (!result.complete) {
            const validationError = new Error('Bootstrap footprint rollback validation failed.');
            validationError.code = result.errors && result.errors[0] && result.errors[0].code ||
              'UNITY_BOOTSTRAP_FOOTPRINT_CONFLICT';
            throw validationError;
          }
        });
      } else if (bootstrapFootprint && bootstrapReloadStarted) {
        // Unity may already have generated PackageManager/NuGet/define state,
        // but no sealed ownership snapshot exists. Keep manifest+config too so
        // bootstrap failure never leaves a mixed transaction generation.
        validationErrors.push({ step: 'footprint', code: 'UNITY_BOOTSTRAP_FOOTPRINT_UNSEALED' });
      }

      if (validationErrors.length) {
        rollback.config = 'preserved-validation-conflict';
        rollback.manifest = 'preserved-validation-conflict';
        rollback.footprint = 'preserved-validation-conflict';
        rollback.validationErrors = validationErrors;
      } else {
        try {
          if (configTransaction && typeof configTransaction.rollback === 'function') {
            const result = configTransaction.rollback();
            rollback.config = result.restored ? 'restored' : result.reason || 'unchanged';
          }
        } catch (rollbackError) {
          rollback.config = rollbackError.code || 'rollback-failed';
        }
        try {
          if (setup && setup.transaction) {
            (injected.rollbackPackages || rollbackUnityMcpPackages)(setup.transaction);
            rollback.manifest = 'restored';
          }
        } catch (rollbackError) {
          rollback.manifest = rollbackError.code || 'rollback-failed';
        }
        try {
          if (bootstrapFootprint) {
            if (bootstrapFootprint.sealed !== true) {
              rollback.footprint = 'unchanged-before-reload';
            } else {
              const result = (injected.rollbackFootprint || rollbackUnityBootstrapFootprint)(bootstrapFootprint);
              rollback.footprint = result.complete ? 'restored' : 'partial';
              if (!result.complete) rollback.footprintErrors = result.errors;
            }
          }
        } catch (rollbackError) {
          rollback.footprint = rollbackError.code || 'rollback-failed';
        }
      }
      error.rollback = rollback;
    } else if (input.bootstrap && error.processStillRunning) {
      error.rollback = { deferred: true, reason: 'owned-unity-termination-unconfirmed' };
    } else if (input.bootstrap && bootstrapReloadStarted) {
      // Capture -> import -> seal cannot prove which process authored every
      // PackageManager/NuGet/settings byte. Preserve the whole setup generation
      // (manifest + config included) rather than risk deleting a concurrent user file.
      error.rollback = { preserved: true, reason: 'reload-started-ownership-ambiguous' };
    }
    if (input.bootstrap && [
      'UNITY_MCP_TIMEOUT',
      'UNITY_MCP_NOT_READY',
      'UNITY_MCP_NETWORK_ERROR',
      'UNITY_MCP_HTTP_ERROR',
      'UNITY_MCP_UNAVAILABLE',
    ].includes(error.code)) {
      const readPackageDiagnostics = injected.readPackageDiagnostics || readUnityPackageDiagnostics;
      const packageFailure = readPackageDiagnostics(projectRoot);
      if (packageFailure && packageFailure.count > 0) {
        const causeCode = error.code;
        error.code = packageFailure.code;
        error.message = packageFailure.code === 'UNITY_PACKAGE_TLS_CERTIFICATE_ERROR'
          ? 'Unity Package Manager không tải được Unity-MCP vì TLS certificate verification thất bại; live scanner chưa được cài/reload.'
          : 'Unity Package Manager không resolve được package Unity-MCP; live scanner chưa được cài/reload.';
        error.details = { ...(error.details || {}), causeCode, packageFailure };
      }
      const readCompileDiagnostics = injected.readCompileDiagnostics || readUnityCompileDiagnostics;
      const compile = readCompileDiagnostics(projectRoot);
      if (!packageFailure && compile && compile.count > 0) {
        const causeCode = error.code;
        const examples = compile.evidence.slice(0, 2).join(' | ');
        error.code = 'UNITY_PROJECT_COMPILE_ERRORS';
        error.message = `Unity project có ${compile.count} compile error trong bounded log tail; ` +
          `domain reload/scanner bị chặn. ${examples}`;
        error.details = { ...(error.details || {}), causeCode, compile };
      }
    }
    if (providerMode === 'unity-mcp' || input.bootstrap) {
      if (!error.code) error.code = 'UNITY_MCP_SCAN_FAILED';
      throw error;
    }
    const snapshot = decorateStaticFallback(staticSnapshot, fingerprint, error, providerMode);
    return scanResult(
      projectRoot,
      snapshot,
      fingerprint,
      doctor,
      publicSetup(setup, connection),
      consistencyOptions(stateBeforeScan),
    );
  }
}

function sectionItems(snapshot, section) {
  if (section === 'assets') return snapshot.assets && snapshot.assets.records || [];
  if (section === 'dependencies') return snapshot.dependencies && snapshot.dependencies.edges || [];
  if (section === 'unresolved') return snapshot.dependencies && snapshot.dependencies.unresolved || [];
  if (section === 'diagnostics') return snapshot.diagnostics || [];
  if (section === 'features') return snapshot.features && snapshot.features.sketch || [];
  if (section === 'scenes') return snapshot.buildScenes || [];
  if (section === 'scripts') return snapshot.scriptIndex && snapshot.scriptIndex.scripts || [];
  throw new UnityIntelligenceError('UNITY_SECTION_INVALID', `Section không hỗ trợ: ${section}`);
}

function filterSectionItems(items, query = {}) {
  const search = String(query.search || '').trim().toLowerCase();
  return items.filter(item => {
    if (query.severity && item.severity !== query.severity) return false;
    if (query.type && item.type !== query.type && item.kind !== query.type && item.id !== query.type) return false;
    if (!search) return true;
    return JSON.stringify(sanitizeForProjection(item, { maxString: 320, maxArray: 20 })).toLowerCase().includes(search);
  });
}

function queryUnitySnapshot(snapshot, request = {}) {
  const section = request.section || 'features';
  const query = {
    search: request.search || '',
    severity: request.severity || '',
    type: request.type || '',
  };
  const items = filterSectionItems(sectionItems(snapshot, section), query);
  return createCompactPage(snapshot, {
    section,
    query,
    items,
    cursor: request.cursor,
    pageSize: request.limit,
  });
}

module.exports = {
  PROVIDERS,
  DEFAULT_SCANNER_PACKAGE_ROOT,
  UnityIntelligenceError,
  resolveProjectRoot,
  normalizeProvider,
  unavailableDiagnostic,
  addFeatureSketch,
  decorateStaticFallback,
  assertStableProjectState,
  finalizeSnapshotState,
  publicDoctor,
  publicSetup,
  createCompactScanEnvelope,
  inspectUnityProject,
  defaultLiveProvider,
  unwrapPatch,
  reachableAssetPaths,
  buildLiveCandidateRequest,
  applyLiveCandidateDispositions,
  scanUnityProject,
  sectionItems,
  filterSectionItems,
  queryUnitySnapshot,
};
