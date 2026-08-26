'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createUnityProjectSnapshot } = require('./unity-intel/schema.cjs');
const { addFeatureSketch } = require('./unity-intel/service.cjs');
const {
  TOOLS,
  handleToolCall,
  makeErrorResult,
  scanGenerations,
  snapshotCache,
} = require('./unity-intel-mcp.cjs');

function fakeSnapshot() {
  const snapshot = createUnityProjectSnapshot({
    provider: 'static',
    project: { name: 'Tiny', root: 'D:/secret/Tiny', unityVersion: '6000.3.1f1', packages: {} },
    source: { root: 'D:/secret/Tiny/Assets', assetsRoot: 'D:/secret/Tiny/Assets', includeVendor: false },
    assets: {
      count: 1,
      records: [{ guid: 'a'.repeat(32), assetPath: 'Assets/Game.prefab', type: 'prefab', blockerIds: ['particle'] }],
    },
  });
  snapshot.scanId = 'fake-scan';
  snapshot.fingerprint = 'f'.repeat(64);
  snapshot.scriptIndex = { scriptCount: 0, assemblyCount: 0, guidToScript: {}, typeDeclarations: {}, scripts: [], assemblies: [], diagnostics: [] };
  return addFeatureSketch(snapshot);
}

test('MCP surface stays narrow and descriptions make preflight scan mandatory', () => {
  assert.deepEqual(TOOLS.map(tool => tool.name), [
    'doctorUnityProject', 'scanUnityProject', 'getUnityProjectFeatures', 'getUnityProjectSlice',
  ]);
  assert.match(TOOLS[1].description, /MANDATORY FIRST tool/);
  assert.equal(TOOLS[1].inputSchema.properties.profile.default, 'playable-core');
  assert.match(TOOLS[2].description, /UNITY_SCAN_REQUIRED/);
  assert.equal(TOOLS[2].annotations.readOnlyHint, true);
});

test('scan returns compact implementation brief, keeps full snapshot only in-process, and feature query reuses it', async () => {
  snapshotCache.clear();
  const snapshot = fakeSnapshot();
  let scannedProject = null;
  let scannedProfile = null;
  let freshnessProject = null;
  const dependencies = {
    resolveProjectRoot: () => 'D:/Tiny',
    scanProject: async () => ({
      snapshot,
      summary: {
        schemaVersion: 1,
        provider: 'static',
        scanId: 'fake-scan',
        project: { name: 'Tiny', unityVersion: '6000.3.1f1' },
        featureSketch: snapshot.features.sketch,
      },
      doctor: { ready: true },
      setup: null,
    }),
    runPreflight: async input => {
      scannedProject = input.project;
      scannedProfile = input.profile;
      return {
        snapshot,
        brief: {
          schemaVersion: 1,
          kind: 'unity-port-implementation-brief',
          receiptId: 'rcp:test',
          project: { name: 'Tiny', provider: 'static' },
          decision: { status: 'ready', implementationAllowed: true },
          features: snapshot.features.sketch,
          obligations: [],
        },
      };
    },
    computeProjectState: projectRoot => {
      freshnessProject = projectRoot;
      return { fingerprint: snapshot.stateFingerprint };
    },
  };
  snapshot.stateFingerprint = 'a'.repeat(64);
  const scanResult = await handleToolCall('scanUnityProject', { project: 'D:/Tiny/Assets' }, dependencies);
  assert.equal(scanResult.structuredContent.kind, 'unity-port-implementation-brief');
  assert.equal(JSON.stringify(scanResult.structuredContent).includes('D:/secret'), false);
  assert.equal(snapshotCache.size, 1);
  assert.equal(scannedProject, 'D:/Tiny');
  assert.equal(scannedProfile, 'playable-core');

  const features = await handleToolCall('getUnityProjectFeatures', { project: 'D:/Tiny/Assets/Game.prefab', limit: 10 }, dependencies);
  assert.equal(features.structuredContent.section, 'features');
  assert.ok(features.structuredContent.count > 0);
  assert.ok(Buffer.byteLength(features.content[0].text) < 48 * 1024);
  assert.equal(freshnessProject, 'D:/Tiny');
});

test('feature and slice queries cannot silently auto-scan before mandatory preflight', async () => {
  snapshotCache.clear();
  await assert.rejects(
    () => handleToolCall('getUnityProjectFeatures', { project: 'D:/NeverScanned' }),
    error => error.code === 'UNITY_SCAN_REQUIRED',
  );
  await assert.rejects(
    () => handleToolCall('getUnityProjectSlice', { project: 'D:/NeverScanned', section: 'diagnostics' }),
    error => error.code === 'UNITY_SCAN_REQUIRED',
  );
});

test('MCP errors expose code/message but not stack or token-shaped internals', () => {
  const error = new Error('endpoint unavailable');
  error.code = 'UNITY_MCP_UNAVAILABLE';
  error.token = 'never-print';
  const result = makeErrorResult(error);
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text.includes('never-print'), false);
  assert.equal(result.content[0].text.includes('at '), false);
});

test('MCP error payload redacts Windows and UNC absolute paths', () => {
  const error = new Error('Invalid Unity project D:\\secret\\project; backup at \\\\server\\share\\manifest.json');
  error.code = 'UNITY_PROJECT_INVALID';
  const result = makeErrorResult(error);
  const serialized = JSON.stringify(result.structuredContent);
  assert.equal(serialized.includes('D:\\secret'), false);
  assert.equal(serialized.includes('server\\share'), false);
  assert.match(serialized, /redacted:absolute-path/);
});

test('newest-started concurrent scan exclusively owns the per-project snapshot cache', async () => {
  snapshotCache.clear();
  scanGenerations.clear();
  const firstSnapshot = fakeSnapshot();
  firstSnapshot.scanId = 'older-scan';
  const secondSnapshot = fakeSnapshot();
  secondSnapshot.scanId = 'newer-scan';
  let releaseFirst;
  let releaseSecond;
  let calls = 0;
  const deferred = [
    new Promise(resolve => { releaseFirst = resolve; }),
    new Promise(resolve => { releaseSecond = resolve; }),
  ];
  const dependencies = {
    resolveProjectRoot: () => 'D:/Tiny',
    runPreflight: async () => {
      const call = calls++;
      await deferred[call];
      const snapshot = call === 0 ? firstSnapshot : secondSnapshot;
      return {
        snapshot,
        brief: {
          schemaVersion: 1,
          kind: 'unity-port-implementation-brief',
          briefId: call === 0 ? 'older-brief' : 'newer-brief',
          decision: { status: 'ready', implementationAllowed: true },
          features: [],
          obligations: [],
        },
      };
    },
  };
  const first = handleToolCall('scanUnityProject', { project: 'D:/Tiny', provider: 'static' }, dependencies);
  await Promise.resolve();
  const second = handleToolCall('scanUnityProject', { project: 'D:/Tiny', provider: 'unity-mcp' }, dependencies);
  await Promise.resolve();

  releaseSecond();
  await second;
  releaseFirst();
  await assert.rejects(first, error => error.code === 'UNITY_SCAN_SUPERSEDED');

  assert.equal(snapshotCache.size, 1);
  assert.equal([...snapshotCache.values()][0].snapshot.scanId, 'newer-scan');
});
