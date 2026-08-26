'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createUnityFixture } = require('./test-fixture.cjs');
const { buildUnityProjectSnapshot } = require('./project-index.cjs');
const { buildDependencyGraph } = require('./dependency-graph.cjs');
const { computeStaticProjectFingerprint, createUnityLiveSnapshotPatch } = require('./live-schema.cjs');
const { jsonBytes, SUMMARY_MAX_BYTES, createCompactSummary } = require('./compact-projection.cjs');
const {
  createCompactScanEnvelope,
  buildLiveCandidateRequest,
  applyLiveCandidateDispositions,
  defaultLiveProvider,
  scanUnityProject,
  queryUnitySnapshot,
} = require('./service.cjs');

function staticFixture(t) {
  const fixture = createUnityFixture(t);
  const snapshot = buildUnityProjectSnapshot({ projectRoot: fixture.root, cache: false });
  return { fixture, snapshot, fingerprint: computeStaticProjectFingerprint(snapshot) };
}

function livePatch(fingerprint) {
  return {
    ...createUnityLiveSnapshotPatch({
    provider: 'unity-mcp',
    projectFingerprint: fingerprint,
    scanId: 'service-live-scan',
    project: {},
    facts: { componentCensus: [{ type: 'UnityEngine.ParticleSystem', count: 2 }] },
    capabilities: { playModeCapture: false, candidateDisposition: true },
    }),
    protocolVersion: 1,
    packageVersion: '0.3.0',
  };
}

function doctorState(projectRoot, canLaunch) {
  return {
    ok: canLaunch,
    ready: true,
    canLaunch,
    canAttach: !canLaunch,
    project: { projectRoot, unityVersion: '6000.0.66f2', unityRevision: null },
    editor: {
      status: 'ready',
      editor: { path: 'D:/Unity/6000.0.66f2/Editor/Unity.exe', version: '6000.0.66f2', source: 'test' },
    },
    lock: { state: canLaunch ? 'free' : 'held', locked: !canLaunch },
    issues: [],
  };
}

test('default provider adapts createUnityMcpProvider API', () => {
  const provider = defaultLiveProvider();
  assert.equal(typeof provider.probe, 'function');
  assert.equal(typeof provider.scan, 'function');
});

test('bootstrap on a locked Editor waits the full requested readiness window and never batch-launches', async t => {
  const { fixture, snapshot, fingerprint } = staticFixture(t);
  const seen = [];
  let batchCalls = 0;
  let scanCalls = 0;
  let refreshCalls = 0;
  const result = await scanUnityProject({
    project: fixture.root,
    provider: 'unity-mcp',
    bootstrap: true,
    timeoutMs: 42_000,
  }, {
    buildStaticSnapshot: () => snapshot,
    doctor: () => doctorState(fixture.root, false),
    setupPackages: () => ({ changed: true, scannerPackageSpec: 'file:scanner', upstreamPackageSpec: 'git', transaction: {} }),
    ensureConfig: () => ({ url: 'http://127.0.0.1:25000', token: 'secret', changed: true, rollback: () => ({ restored: true }) }),
    refreshOpenEditor: projectRoot => {
      refreshCalls += 1;
      assert.equal(projectRoot, fixture.root);
      return { attempted: true, dispatched: true };
    },
    runBatch: async () => { batchCalls++; },
    liveProvider: {
      probe: async options => { seen.push(options.timeoutMs); return livePatch(fingerprint); },
      scan: async () => { scanCalls += 1; return livePatch(fingerprint); },
    },
  });
  assert.equal(batchCalls, 0);
  assert.equal(refreshCalls, 1);
  assert.equal(scanCalls, 2);
  assert.deepEqual(seen, [42_000]);
  assert.equal(result.snapshot.provider, 'hybrid');
  assert.deepEqual(result.setup.reload, { mode: 'existing-editor', completed: true });
});

test('bootstrap never marks reload complete for an older Unity scanner package', async t => {
  const { fixture, snapshot, fingerprint } = staticFixture(t);
  let scans = 0;
  let clock = 0;
  await assert.rejects(
    scanUnityProject({ project: fixture.root, provider: 'unity-mcp', bootstrap: true, timeoutMs: 1000 }, {
      buildStaticSnapshot: () => snapshot,
      doctor: () => doctorState(fixture.root, false),
      setupPackages: () => ({ changed: true, scannerPackageSpec: 'file:scanner', upstreamPackageSpec: 'git', transaction: {} }),
      ensureConfig: () => ({
        url: 'http://127.0.0.1:25000', token: 'secret', changed: true,
        rollback: () => ({ restored: true }),
      }),
      liveProvider: {
        wait: async () => {},
        scan: async () => { scans++; return { ...livePatch(fingerprint), packageVersion: '0.2.0' }; },
      },
      now: () => clock,
      sleep: async delayMs => { clock += delayMs; },
    }),
    error => {
      assert.equal(error.code, 'UNITY_SCANNER_VERSION_MISMATCH');
      assert.deepEqual(error.rollback, {
        preserved: true,
        reason: 'reload-started-ownership-ambiguous',
      });
      return true;
    },
  );
  assert.ok(scans > 1);
});

test('bootstrap promotes bounded project compile evidence over a generic readiness timeout', async t => {
  const { fixture, snapshot } = staticFixture(t);
  await assert.rejects(
    scanUnityProject({ project: fixture.root, provider: 'unity-mcp', bootstrap: true, timeoutMs: 10 }, {
      buildStaticSnapshot: () => snapshot,
      doctor: () => doctorState(fixture.root, false),
      setupPackages: () => ({ changed: true, scannerPackageSpec: 'file:scanner', upstreamPackageSpec: 'git', transaction: {} }),
      ensureConfig: () => ({ url: 'http://127.0.0.1:25000', token: 'secret', changed: true }),
      refreshOpenEditor: () => ({ attempted: true, dispatched: true }),
      liveProvider: {
        wait: async () => {
          const error = new Error('window expired');
          error.code = 'UNITY_MCP_TIMEOUT';
          throw error;
        },
      },
      readCompileDiagnostics: () => ({
        code: 'UNITY_PROJECT_COMPILE_ERRORS',
        count: 2,
        evidence: ['Assets/Game/Main.cs(1,2): error CS0103: missing'],
      }),
    }),
    error => {
      assert.equal(error.code, 'UNITY_PROJECT_COMPILE_ERRORS');
      assert.equal(error.details.causeCode, 'UNITY_MCP_TIMEOUT');
      assert.match(error.message, /Assets\/Game\/Main\.cs/);
      return true;
    },
  );
});

test('existing-editor bootstrap retries until the expected scanner finishes domain reload', async t => {
  const { fixture, snapshot, fingerprint } = staticFixture(t);
  snapshot.dependencies.unresolved.push({
    guid: 'e'.repeat(32),
    category: 'reachable-missing',
    sourceEvidence: ['Assets/Game/Scenes/Main.unity'],
  });
  snapshot.dependencies.unresolvedCount = snapshot.dependencies.unresolved.length;
  let scans = 0;
  let waits = 0;
  let clock = 0;
  const candidateFieldPresence = [];
  const result = await scanUnityProject({
    project: fixture.root,
    provider: 'unity-mcp',
    bootstrap: true,
    timeoutMs: 1000,
  }, {
    buildStaticSnapshot: () => snapshot,
    doctor: () => doctorState(fixture.root, false),
    setupPackages: () => ({ changed: true, scannerPackageSpec: 'file:scanner', upstreamPackageSpec: 'git', transaction: {} }),
    ensureConfig: () => ({
      url: 'http://127.0.0.1:25000', token: 'secret', changed: true,
      rollback: () => ({ restored: true }),
    }),
    liveProvider: {
      wait: async () => { waits += 1; },
      scan: async options => {
        scans += 1;
        candidateFieldPresence.push({
          unresolved: Object.prototype.hasOwnProperty.call(options, 'unresolvedGuids'),
          serialized: Object.prototype.hasOwnProperty.call(options, 'serializedAssetPaths'),
          unresolvedCount: (options.unresolvedGuids || []).length,
        });
        return scans === 1
          ? { ...livePatch(fingerprint), packageVersion: '0.2.0' }
          : livePatch(fingerprint);
      },
    },
    now: () => clock,
    sleep: async delayMs => { clock += delayMs; },
  });
  assert.equal(scans, 3);
  assert.equal(waits, 2);
  assert.deepEqual(candidateFieldPresence.slice(0, 2), [
    { unresolved: false, serialized: false, unresolvedCount: 0 },
    { unresolved: false, serialized: false, unresolvedCount: 0 },
  ]);
  assert.deepEqual(candidateFieldPresence[2], {
    unresolved: true, serialized: true, unresolvedCount: 1,
  });
  assert.deepEqual(result.setup.reload, { mode: 'existing-editor', completed: true });
});

test('bootstrap rolls manifest back when config setup fails', async t => {
  const { fixture, snapshot } = staticFixture(t);
  let manifestRollbacks = 0;
  await assert.rejects(
    scanUnityProject({ project: fixture.root, provider: 'unity-mcp', bootstrap: true }, {
      buildStaticSnapshot: () => snapshot,
      doctor: () => doctorState(fixture.root, false),
      setupPackages: () => ({ changed: true, transaction: { projectRoot: fixture.root } }),
      ensureConfig: () => { const error = new Error('bad config'); error.code = 'CONFIG_FAIL'; throw error; },
      rollbackPackages: () => { manifestRollbacks++; return { rolledBack: true }; },
    }),
    error => {
      assert.deepEqual(error.rollback, {
        config: 'not-needed', manifest: 'restored', footprint: 'unchanged-before-reload',
      });
      return true;
    },
  );
  assert.equal(manifestRollbacks, 1);
});

test('pre-reload rollback validates config and manifest before mutating either transaction', async t => {
  const { fixture, snapshot } = staticFixture(t);
  let configRollbacks = 0;
  let manifestRollbacks = 0;
  const config = {
    changed: true,
    token: 'secret',
    validateRollback: () => ({ restorable: true }),
    rollback: () => { configRollbacks++; return { restored: true }; },
  };
  Object.defineProperty(config, 'url', {
    get() { const error = new Error('connection construction failed'); error.code = 'CONNECTION_FAIL'; throw error; },
  });
  await assert.rejects(
    scanUnityProject({ project: fixture.root, provider: 'unity-mcp', bootstrap: true }, {
      buildStaticSnapshot: () => snapshot,
      doctor: () => doctorState(fixture.root, false),
      setupPackages: () => ({ changed: true, transaction: { projectRoot: fixture.root } }),
      ensureConfig: () => config,
      validatePackageRollback: () => {
        const error = new Error('manifest changed');
        error.code = 'UNITY_BOOTSTRAP_ROLLBACK_CONFLICT';
        throw error;
      },
      rollbackPackages: () => { manifestRollbacks++; return { rolledBack: true }; },
    }),
    error => {
      assert.equal(error.code, 'CONNECTION_FAIL');
      assert.deepEqual(error.rollback.validationErrors, [
        { step: 'manifest', code: 'UNITY_BOOTSTRAP_ROLLBACK_CONFLICT' },
      ]);
      assert.equal(error.rollback.config, 'preserved-validation-conflict');
      assert.equal(error.rollback.manifest, 'preserved-validation-conflict');
      return true;
    },
  );
  assert.equal(configRollbacks, 0);
  assert.equal(manifestRollbacks, 0);
});

test('unsafe editor state fails before package/config mutation', async t => {
  const { fixture, snapshot } = staticFixture(t);
  let setupCalls = 0;
  await assert.rejects(
    scanUnityProject({ project: fixture.root, provider: 'unity-mcp', bootstrap: true }, {
      buildStaticSnapshot: () => snapshot,
      doctor: () => ({ ...doctorState(fixture.root, false), canAttach: false }),
      setupPackages: () => { setupCalls++; },
    }),
    error => error.code === 'UNITY_BOOTSTRAP_NO_SAFE_EDITOR',
  );
  assert.equal(setupCalls, 0);
});

test('failure after Unity reload starts preserves the whole bootstrap generation', async t => {
  const { fixture, snapshot } = staticFixture(t);
  for (const keepOnFailure of [false, true]) {
    let configRollbacks = 0;
    let manifestRollbacks = 0;
    await assert.rejects(
      scanUnityProject({
        project: fixture.root,
        provider: 'unity-mcp',
        bootstrap: true,
        keepOnFailure,
      }, {
        buildStaticSnapshot: () => snapshot,
        doctor: () => doctorState(fixture.root, true),
        setupPackages: () => ({ changed: true, transaction: { projectRoot: fixture.root } }),
        ensureConfig: () => ({
          url: 'http://127.0.0.1:25000', token: 'secret',
          rollback: () => { configRollbacks++; return { restored: true }; },
        }),
        runBatch: async () => { const error = new Error('compile failed'); error.code = 'UNITY_BATCH_RESULT_MISSING'; throw error; },
        rollbackPackages: () => { manifestRollbacks++; return { rolledBack: true }; },
      }),
      error => {
        assert.equal(error.code, 'UNITY_BATCH_RESULT_MISSING');
        assert.deepEqual(error.rollback, {
          preserved: true,
          reason: 'reload-started-ownership-ambiguous',
        });
        return true;
      },
    );
    assert.equal(configRollbacks, 0);
    assert.equal(manifestRollbacks, 0);
  }
});

test('final scan envelope remains inside 24 KiB after environment metadata is considered', () => {
  const snapshot = {
    schemaVersion: 1,
    provider: 'static',
    scanId: 'bounded',
    project: { name: 'Large', unityVersion: '6000.3.1f1', packages: {} },
    inventory: {}, buildScenes: [], assets: { records: [] },
    dependencies: { edgeCount: 0, unresolvedCount: 0, edges: [], unresolved: [] },
    features: { sketch: [] }, scriptIndex: { scripts: [] },
    diagnostics: Array.from({ length: 200 }, (_, index) => ({
      code: `D${index}`, severity: 'low', message: 'x'.repeat(300), action: 'y'.repeat(300), evidence: [],
    })),
  };
  const result = {
    summary: createCompactSummary(snapshot),
    doctor: { issues: Array.from({ length: 100 }, () => ({ message: 'z'.repeat(300) })) },
    setup: { reload: { message: 'r'.repeat(5000) } },
  };
  assert.ok(jsonBytes(createCompactScanEnvelope(result)) <= SUMMARY_MAX_BYTES);
});

test('content-sensitive scanId rejects a cursor after Unity source changes', async t => {
  const fixture = createUnityFixture(t);
  const first = await scanUnityProject({ project: fixture.root, provider: 'static', cache: false });
  const page = queryUnitySnapshot(first.snapshot, { section: 'assets', limit: 1 });
  assert.ok(page.nextCursor);
  const script = path.join(fixture.root, 'Assets', 'Game', 'Scripts', 'Gameplay.cs');
  fs.appendFileSync(script, '// source revision\n', 'utf8');
  const second = await scanUnityProject({ project: fixture.root, provider: 'static', cache: false });
  assert.notEqual(second.snapshot.scanId, first.snapshot.scanId);
  assert.throws(
    () => queryUnitySnapshot(second.snapshot, { section: 'assets', limit: 1, cursor: page.nextCursor }),
    error => error.code === 'UNITY_CURSOR_STALE',
  );
});

test('scan fails closed when Unity source changes after indexing begins', async t => {
  const fixture = createUnityFixture(t);
  const script = path.join(fixture.root, 'Assets', 'Game', 'Scripts', 'Gameplay.cs');
  await assert.rejects(
    scanUnityProject({ project: fixture.root, provider: 'static', cache: false }, {
      buildStaticSnapshot: options => {
        const snapshot = buildUnityProjectSnapshot(options);
        fs.appendFileSync(script, '// concurrent source mutation\n', 'utf8');
        return snapshot;
      },
      doctor: () => doctorState(fixture.root, true),
    }),
    error => {
      assert.equal(error.code, 'UNITY_SOURCE_CHANGED_DURING_SCAN');
      assert.notEqual(error.details.beforeFingerprint, error.details.afterFingerprint);
      assert.equal(JSON.stringify(error.details).includes(fixture.root), false);
      return true;
    },
  );
});

test('bootstrap resets consistency baseline after its intentional project mutations', async t => {
  const { fixture, snapshot, fingerprint } = staticFixture(t);
  const manifestPath = path.join(fixture.root, 'Packages', 'manifest.json');
  let staticBuilds = 0;
  const result = await scanUnityProject({
    project: fixture.root,
    provider: 'unity-mcp',
    bootstrap: true,
  }, {
    buildStaticSnapshot: () => {
      staticBuilds += 1;
      const current = JSON.parse(JSON.stringify(snapshot));
      if (staticBuilds === 2) current.diagnostics.push({
        code: 'UNITY_BOOTSTRAP_REBUILT_STATIC', severity: 'low', message: 'rebuilt',
        action: 'none', count: 1, evidence: [], source: 'static',
      });
      return current;
    },
    doctor: () => doctorState(fixture.root, false),
    setupPackages: () => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.dependencies['com.example.bootstrap-owned'] = 'file:../BootstrapOwned';
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      return { changed: true, scannerPackageSpec: 'file:scanner', upstreamPackageSpec: 'git', transaction: {} };
    },
    ensureConfig: () => ({
      url: 'http://127.0.0.1:25000', token: 'secret', changed: true,
      rollback: () => ({ restored: true }),
    }),
    liveProvider: {
      probe: async () => ({ ready: true }),
      scan: async () => livePatch(fingerprint),
    },
  });
  assert.equal(staticBuilds, 2);
  assert.equal(result.snapshot.provider, 'hybrid');
  assert.equal(result.snapshot.diagnostics.some(item => item.code === 'UNITY_BOOTSTRAP_REBUILT_STATIC'), true);
  assert.equal(result.snapshot.stateFingerprint.length, 64);
});

test('closed-project bootstrap merges only a second batch scan bound to the rebuilt baseline', async t => {
  const { fixture, snapshot } = staticFixture(t);
  let staticBuilds = 0;
  const calls = [];
  const result = await scanUnityProject({
    project: fixture.root,
    provider: 'unity-mcp',
    bootstrap: true,
  }, {
    buildStaticSnapshot: () => {
      staticBuilds += 1;
      const current = JSON.parse(JSON.stringify(snapshot));
      if (staticBuilds === 2) current.buildScenes[0].guid = '9'.repeat(32);
      return current;
    },
    doctor: () => doctorState(fixture.root, true),
    setupPackages: () => ({ changed: true, transaction: {} }),
    ensureConfig: () => ({
      url: 'http://127.0.0.1:25000', token: 'secret', changed: true,
      rollback: () => ({ restored: true }),
    }),
    runBatch: async options => {
      calls.push(options.projectFingerprint);
      return { patch: {
        ...createUnityLiveSnapshotPatch({
          provider: 'unity-batch',
          projectFingerprint: options.projectFingerprint,
          scanId: `batch-${calls.length}`,
          facts: { authoritativePass: calls.length },
          capabilities: { playModeCapture: false, candidateDisposition: true },
          diagnostics: [{
            code: calls.length === 1 ? 'UNITY_FIRST_MARKER_MUST_NOT_MERGE' : 'UNITY_CONFIRMATION_MARKER',
            severity: 'low', message: 'bounded', evidence: [],
          }],
        }),
        protocolVersion: 1,
        packageVersion: '0.3.0',
      } };
    },
  });
  assert.equal(staticBuilds, 2);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0], calls[1]);
  assert.equal(result.snapshot.live.scanId, 'batch-2');
  assert.equal(result.snapshot.live.facts.authoritativePass, 2);
  assert.equal(result.snapshot.diagnostics.some(item => item.code === 'UNITY_FIRST_MARKER_MUST_NOT_MERGE'), false);
  assert.equal(result.snapshot.diagnostics.some(item => item.code === 'UNITY_CONFIRMATION_MARKER'), true);
});

test('live candidate dispositions resolve bounded static uncertainty or promote Editor-confirmed misses', () => {
  const guid = '1234567890abcdef1234567890abcdef';
  const assetPath = 'Assets/Game/Binary.asset';
  const snapshot = {
    buildScenes: [{ enabled: true, indexed: true, gameplayCandidate: true, path: 'Assets/Game/Main.unity' }],
    assets: { records: [{ assetPath, serialization: { complete: false } }] },
    dependencies: {
      edges: [
        { from: 'Assets/Game/Main.unity', to: assetPath },
        { from: 'Assets/Game/Main.unity', to: 'Assets/__missing__/' + guid },
      ],
      unresolved: [{ guid, category: 'reachable-missing', source: 'Assets/Game/Main.unity' }],
    },
    diagnostics: [
      { code: 'UNITY_REACHABLE_GUID_UNRESOLVED', severity: 'high', evidence: [guid], source: 'static' },
      { code: 'UNITY_SERIALIZED_FILE_PARTIAL', severity: 'high', evidence: [assetPath], source: 'static' },
    ],
  };
  const request = buildLiveCandidateRequest(snapshot);
  assert.deepEqual(request.unresolvedGuids, [guid]);
  assert.deepEqual(request.serializedAssetPaths, [assetPath]);

  const resolved = applyLiveCandidateDispositions(snapshot, {
    provider: 'unity-mcp', diagnostics: [], resolvesDiagnosticKeys: [],
    candidateDispositions: [
      {
        kind: 'guid', key: guid, status: 'resolved', assetPath: 'Assets/Game/Recovered.asset',
        dependencyCount: 1, referencesComplete: true,
        references: [{
          fieldPath: '', assetPath: 'Assets/Game/RecoveredDependency.asset',
          guid: 'f'.repeat(32), type: 'UnityEngine.Object',
        }],
      },
      {
        kind: 'serialized-asset', key: assetPath, status: 'resolved', assetPath,
        dependencyCount: 0, serializedScanComplete: true, serializedPropertyCount: 8,
        missingReferenceCount: 0, referencesComplete: true, references: [
          {
            fieldPath: 'sprites.Array.data[0]', assetPath: 'Assets/Game/Atlas.png',
            guid: 'e'.repeat(32), objectId: '21300000', type: 'UnityEngine.Sprite',
          },
          {
            fieldPath: 'sprites.Array.data[1]', assetPath: 'Assets/Game/Atlas.png',
            guid: 'e'.repeat(32), objectId: '21300002', type: 'UnityEngine.Sprite',
          },
        ],
      },
    ],
  }, request);
  assert.equal(resolved.resolvesDiagnosticKeys.length, 2);
  assert.deepEqual(resolved.resolvesUnresolvedGuids, [guid]);
  assert.equal(resolved.diagnostics.length, 0);
  assert.equal(resolved.assets.records.some(item => item.guid === guid), true);
  assert.equal(resolved.assets.records.some(item =>
    item.assetPath === assetPath && item.serialization.liveConfirmed === true), true);
  assert.equal(resolved.dependencies.edges.some(item =>
    item.from === 'Assets/Game/Main.unity' && item.to === 'Assets/Game/Recovered.asset'), true);
  assert.equal(resolved.dependencies.edges.some(item =>
    item.from === 'Assets/Game/Recovered.asset' && item.to === 'Assets/Game/RecoveredDependency.asset'), true);
  assert.deepEqual(resolved.dependencies.edges
    .filter(item => item.from === assetPath && item.to === 'Assets/Game/Atlas.png')
    .map(item => item.objectId).sort(), ['21300000', '21300002']);
  assert.equal(resolved.capabilities.candidateDisposition, true);

  const missing = applyLiveCandidateDispositions(snapshot, {
    provider: 'unity-mcp', diagnostics: [], resolvesDiagnosticKeys: [],
    candidateDispositions: [
      { kind: 'guid', key: guid, status: 'missing', assetPath: '' },
      { kind: 'serialized-asset', key: assetPath, status: 'missing', assetPath: '' },
    ],
  }, request);
  assert.equal(missing.resolvesDiagnosticKeys.length, 2);
  assert.deepEqual(missing.diagnostics.map(item => item.code).sort(), [
    'UNITY_REACHABLE_GUID_UNRESOLVED',
    'UNITY_SERIALIZED_FILE_PARTIAL',
  ]);
  assert.equal(missing.diagnostics.every(item => item.source === 'unity-mcp'), true);
  assert.deepEqual(missing.resolvesUnresolvedGuids, [guid]);
  assert.equal(missing.dependencies.unresolved.some(item =>
    item.guid === guid && item.confirmation === 'unity-editor-missing'), true);
});

test('partial or truncated live candidate evidence never clears static diagnostics', () => {
  const guids = Array.from({ length: 513 }, (_, index) => index.toString(16).padStart(32, '0'));
  const snapshot = {
    buildScenes: [{ enabled: true, indexed: true, gameplayCandidate: true, path: 'Assets/Main.unity' }],
    assets: { records: [] },
    dependencies: {
      edges: [],
      unresolved: guids.map(guid => ({ guid, category: 'reachable-missing' })),
    },
    diagnostics: [{ code: 'UNITY_REACHABLE_GUID_UNRESOLVED', severity: 'high', evidence: [] }],
  };
  const request = buildLiveCandidateRequest(snapshot);
  assert.equal(request.unresolvedGuids.length, 512);
  assert.equal(request.unresolvedComplete, false);
  const patch = applyLiveCandidateDispositions(snapshot, {
    provider: 'unity-mcp', diagnostics: [], resolvesDiagnosticKeys: [],
    candidateDispositions: request.unresolvedGuids.map(guid => ({
      kind: 'guid', key: guid, status: 'resolved', assetPath: `Assets/${guid}.asset`,
    })),
  }, request);
  assert.deepEqual(patch.resolvesDiagnosticKeys, []);
  assert.deepEqual(patch.resolvesUnresolvedGuids, []);
});

test('live GUID resolution restores a retained gameplay source after bounded unresolved grouping', () => {
  const guid = 'd'.repeat(32);
  const unreachable = Array.from({ length: 5 }, (_, index) => `Assets/A${index}.asset`);
  const gameplaySource = 'Assets/ZGameplay.prefab';
  const records = [...unreachable, gameplaySource].map(assetPath => ({
    assetPath,
    scope: 'runtime',
    referenceEvidence: [{ guid, kind: 'sprite', fieldPath: 'm_Sprite' }],
  }));
  const graph = buildDependencyGraph(records, { byGuid: new Map() }).toJSON({
    reachablePaths: new Set([gameplaySource]),
  });
  const grouped = graph.unresolved.find(item => item.guid === guid);
  assert.equal(grouped.category, 'reachable-missing');
  assert.deepEqual(grouped.sources, [gameplaySource]);
  assert.equal(grouped.sourceEvidence[0].source, gameplaySource);

  const snapshot = {
    buildScenes: [{ enabled: true, indexed: true, gameplayCandidate: true, path: gameplaySource }],
    assets: { records: [] },
    dependencies: graph,
    diagnostics: [{ code: 'UNITY_REACHABLE_GUID_UNRESOLVED', severity: 'high', evidence: [guid] }],
  };
  const request = buildLiveCandidateRequest(snapshot);
  const patch = applyLiveCandidateDispositions(snapshot, {
    provider: 'unity-mcp', diagnostics: [], resolvesDiagnosticKeys: [],
    candidateDispositions: [{
      kind: 'guid', key: guid, status: 'resolved', assetPath: 'Assets/Recovered.asset',
      assetType: 'UnityEngine.Sprite', dependencyCount: 0, referencesComplete: true, references: [],
    }],
  }, request);
  assert.equal(patch.dependencies.edges.some(edge =>
    edge.from === gameplaySource && edge.to === 'Assets/Recovered.asset' && edge.kind === 'sprite'), true);
  assert.deepEqual(patch.resolvesUnresolvedGuids, [guid]);
});
