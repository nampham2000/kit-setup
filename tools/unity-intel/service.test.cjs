'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createUnityFixture } = require('./test-fixture.cjs');
const { buildUnityProjectSnapshot } = require('./project-index.cjs');
const { computeStaticProjectFingerprint, createUnityLiveSnapshotPatch } = require('./live-schema.cjs');
const { jsonBytes, SUMMARY_MAX_BYTES, createCompactSummary } = require('./compact-projection.cjs');
const {
  createCompactScanEnvelope,
  defaultLiveProvider,
  scanUnityProject,
} = require('./service.cjs');

function staticFixture(t) {
  const fixture = createUnityFixture(t);
  const snapshot = buildUnityProjectSnapshot({ projectRoot: fixture.root, cache: false });
  return { fixture, snapshot, fingerprint: computeStaticProjectFingerprint(snapshot) };
}

function livePatch(fingerprint) {
  return createUnityLiveSnapshotPatch({
    provider: 'unity-mcp',
    projectFingerprint: fingerprint,
    scanId: 'service-live-scan',
    project: {},
    facts: { componentCensus: [{ type: 'UnityEngine.ParticleSystem', count: 2 }] },
  });
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
    runBatch: async () => { batchCalls++; },
    liveProvider: {
      probe: async options => { seen.push(options.timeoutMs); return livePatch(fingerprint); },
      scan: async () => livePatch(fingerprint),
    },
  });
  assert.equal(batchCalls, 0);
  assert.deepEqual(seen, [42_000]);
  assert.equal(result.snapshot.provider, 'hybrid');
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
      assert.deepEqual(error.rollback, { config: 'not-needed', manifest: 'restored', footprint: 'restored' });
      return true;
    },
  );
  assert.equal(manifestRollbacks, 1);
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

test('batch/live failure rolls back config and manifest unless keepOnFailure is explicit', async t => {
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
        assert.equal(!!error.rollback, !keepOnFailure);
        return true;
      },
    );
    assert.equal(configRollbacks, keepOnFailure ? 0 : 1);
    assert.equal(manifestRollbacks, keepOnFailure ? 0 : 1);
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
