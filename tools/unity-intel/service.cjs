'use strict';

const path = require('node:path');

const { buildUnityProjectSnapshot, findUnityProjectRoot } = require('./project-index.cjs');
const { doctorUnityEditor } = require('./unity-editor.cjs');
const { rollbackUnityMcpPackages, setupUnityMcpPackages } = require('./unity-bootstrap.cjs');
const {
  captureUnityBootstrapFootprint,
  rollbackUnityBootstrapFootprint,
} = require('./unity-bootstrap-footprint.cjs');
const { ensureUnityMcpConfig, publicConnection, readUnityMcpConnection } = require('./unity-mcp-config.cjs');
const { runUnityBatchScan } = require('./unity-batch-provider.cjs');
const { computeStaticProjectFingerprint } = require('./live-schema.cjs');
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

function inspectUnityProject(input = {}, injected = {}) {
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
  return {
    schemaVersion: 1,
    project: path.basename(projectRoot),
    doctor: publicDoctor(doctor),
    connection: connection && connection.url
      ? publicConnection(connection)
      : connection,
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

async function callScan(provider, connection, fingerprint, options) {
  return provider.scan({
    url: connection.url,
    token: connection.token,
    projectFingerprint: fingerprint,
    timeoutMs: options.timeoutMs,
    requestTimeoutMs: options.requestTimeoutMs || Math.min(options.timeoutMs || 120_000, 120_000),
    action: 'scan',
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
  return callScan(provider, connection, fingerprint, options);
}

function unwrapPatch(value) {
  if (value && value.patch) return value.patch;
  if (value && value.result && value.result.kind === 'unity-live-patch') return value.result;
  return value;
}

async function scanUnityProject(input = {}, injected = {}) {
  const projectRoot = resolveProjectRoot(input.project || input.sourceRoot);
  const providerMode = normalizeProvider(input.provider);
  const staticSnapshot = (injected.buildStaticSnapshot || buildUnityProjectSnapshot)({
    projectRoot,
    sourceRoot: input.sourceRoot || path.join(projectRoot, 'Assets'),
    includeVendor: !!input.includeVendor,
    cache: input.cache !== false,
    cacheDir: input.cacheDir,
    refreshCache: !!input.refreshCache,
  });
  const fingerprint = computeStaticProjectFingerprint(staticSnapshot);
  const doctor = (injected.doctor || doctorUnityEditor)(projectRoot, { editorPath: input.unity });
  let setup = null;
  let connection = null;
  let configTransaction = null;
  let bootstrapFootprint = null;

  if (providerMode === 'static' && !input.bootstrap) {
    const snapshot = decorateStaticFallback(staticSnapshot, fingerprint, null, providerMode);
    return { projectRoot, snapshot, summary: createCompactSummary(snapshot), doctor: publicDoctor(doctor), setup: null };
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

      if (doctor.canLaunch) {
        const batchResult = await (injected.runBatch || runUnityBatchScan)({
          editorExe: doctor.editor.editor.path,
          projectRoot,
          projectFingerprint: fingerprint,
          timeoutMs: input.timeoutMs,
          keepArtifacts: !!input.keepUnityArtifacts,
        });
        const patch = unwrapPatch(batchResult);
        const merged = addFeatureSketch(mergeUnityProjectSnapshots(staticSnapshot, patch));
        setup.reload = { mode: 'batch', completed: true };
        return {
          projectRoot,
          snapshot: merged,
          summary: createCompactSummary(merged),
          doctor: publicDoctor(doctor),
          setup: publicSetup(setup, connection),
        };
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
    if (input.bootstrap) liveResult = await waitAndScan(liveProvider, connection, fingerprint, input);
    else {
      const probe = await callProbe(liveProvider, connection, input);
      if (probe === false || probe && probe.ready === false) {
        throw new UnityIntelligenceError('UNITY_MCP_UNAVAILABLE', 'Unity-MCP endpoint chưa sẵn sàng.');
      }
      liveResult = await callScan(liveProvider, connection, fingerprint, input);
    }
    const patch = unwrapPatch(liveResult);
    const merged = addFeatureSketch(mergeUnityProjectSnapshots(staticSnapshot, patch));
    if (setup && setup.reload) setup.reload.completed = true;
    return {
      projectRoot,
      snapshot: merged,
      summary: createCompactSummary(merged),
      doctor: publicDoctor(doctor),
      setup: publicSetup(setup, connection),
    };
  } catch (error) {
    if (input.bootstrap && !input.keepOnFailure && !error.processStillRunning) {
      const rollback = { config: 'not-needed', manifest: 'not-needed', footprint: 'not-needed' };
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
          const result = (injected.rollbackFootprint || rollbackUnityBootstrapFootprint)(bootstrapFootprint);
          rollback.footprint = result.complete ? 'restored' : 'partial';
          if (!result.complete) rollback.footprintErrors = result.errors;
        }
      } catch (rollbackError) {
        rollback.footprint = rollbackError.code || 'rollback-failed';
      }
      error.rollback = rollback;
    } else if (input.bootstrap && error.processStillRunning) {
      error.rollback = { deferred: true, reason: 'owned-unity-termination-unconfirmed' };
    }
    if (providerMode === 'unity-mcp' || input.bootstrap) {
      if (!error.code) error.code = 'UNITY_MCP_SCAN_FAILED';
      throw error;
    }
    const snapshot = decorateStaticFallback(staticSnapshot, fingerprint, error, providerMode);
    return {
      projectRoot,
      snapshot,
      summary: createCompactSummary(snapshot),
      doctor: publicDoctor(doctor),
      setup: publicSetup(setup, connection),
    };
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
  publicDoctor,
  publicSetup,
  createCompactScanEnvelope,
  inspectUnityProject,
  defaultLiveProvider,
  unwrapPatch,
  scanUnityProject,
  sectionItems,
  filterSectionItems,
  queryUnitySnapshot,
};
