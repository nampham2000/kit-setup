'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createUnityProjectSnapshot } = require('./unity-intel/schema.cjs');
const { addFeatureSketch } = require('./unity-intel/service.cjs');
const { TOOLS, handleToolCall, snapshotCache } = require('./unity-intel-mcp.cjs');

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

test('MCP surface stays narrow and descriptions make compact scan the first porting action', () => {
  assert.deepEqual(TOOLS.map(tool => tool.name), [
    'doctorUnityProject', 'scanUnityProject', 'getUnityProjectFeatures', 'getUnityProjectSlice',
  ]);
  assert.match(TOOLS[1].description, /FIRST tool/);
  assert.equal(TOOLS[2].annotations.readOnlyHint, true);
});

test('scan returns compact summary, keeps full snapshot only in-process, and feature query reuses it', async () => {
  snapshotCache.clear();
  const snapshot = fakeSnapshot();
  const dependencies = {
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
  };
  const scanResult = await handleToolCall('scanUnityProject', { project: 'D:/Tiny' }, dependencies);
  assert.equal(scanResult.structuredContent.provider, 'static');
  assert.equal(JSON.stringify(scanResult.structuredContent).includes('D:/secret'), false);
  assert.equal(snapshotCache.size, 1);

  const features = await handleToolCall('getUnityProjectFeatures', { project: 'D:/Tiny', limit: 10 }, dependencies);
  assert.equal(features.structuredContent.section, 'features');
  assert.ok(features.structuredContent.count > 0);
  assert.ok(Buffer.byteLength(features.content[0].text) < 48 * 1024);
});

test('MCP errors expose code/message but not stack or token-shaped internals', () => {
  const { makeErrorResult } = require('./unity-intel-mcp.cjs');
  const error = new Error('endpoint unavailable');
  error.code = 'UNITY_MCP_UNAVAILABLE';
  error.token = 'never-print';
  const result = makeErrorResult(error);
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text.includes('never-print'), false);
  assert.equal(result.content[0].text.includes('at '), false);
});
