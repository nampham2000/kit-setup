'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createUnityProjectSnapshot, validateUnityProjectSnapshot } = require('./schema.cjs');
const {
  computeStaticProjectFingerprint,
  createUnityLiveSnapshotPatch,
  diagnosticKey,
} = require('./live-schema.cjs');
const { mergeUnityProjectSnapshots } = require('./snapshot-merge.cjs');

function staticSnapshot() {
  return createUnityProjectSnapshot({
    generatedAt: '2026-08-23T00:00:00.000Z',
    project: {
      name: 'MergeGame', root: 'D:/Unity/MergeGame', unityVersion: '6000.0.66f2',
      packages: { 'com.unity.inputsystem': '1.18.0' },
    },
    source: { root: 'D:/Unity/MergeGame/Assets', assetsRoot: 'D:/Unity/MergeGame/Assets', includeVendor: false },
    buildScenes: [{ enabled: true, path: 'Assets/Main.unity', guid: 'a'.repeat(32) }],
    assets: {
      count: 1,
      records: [{ guid: 'b'.repeat(32), assetPath: 'Assets/Hero.prefab', path: 'Hero.prefab', type: 'prefab' }],
    },
    dependencies: {
      edgeCount: 1,
      edges: [{ from: 'Assets/Main.unity', to: 'Assets/Hero.prefab', guid: 'b'.repeat(32), kind: 'asset', provider: 'static' }],
      unresolvedCount: 0,
      unresolved: [],
    },
    features: { blockers: [{ id: 'particle', count: 1, examples: ['Assets/Hero.prefab'] }] },
    diagnostics: [
      { code: 'UNITY_MISSING', severity: 'high', message: 'first', source: 'static', count: 1, evidence: ['Assets/A.prefab'] },
      { code: 'UNITY_MISSING', severity: 'high', message: 'second', source: 'static', count: 1, evidence: ['Assets/B.prefab'] },
    ],
  });
}

test('merge is immutable, deterministic and resolves diagnostics only by explicit key', () => {
  const source = staticSnapshot();
  const fingerprint = computeStaticProjectFingerprint(source);
  const resolvedKey = diagnosticKey(source.diagnostics[0]);
  const patch = createUnityLiveSnapshotPatch({
    generatedAt: '2026-08-24T01:00:00.000Z',
    projectFingerprint: fingerprint,
    scanId: 'merge-scan-1',
    project: {
      name: 'MergeGame', unityVersion: '6000.0.66f2',
      packages: { 'com.unity.inputsystem': '1.18.0', 'com.unity.render-pipelines.universal': '17.3.0' },
    },
    buildScenes: [{ enabled: true, path: 'Assets/Main.unity', guid: 'a'.repeat(32), loaded: true }],
    assets: { records: [
      { guid: 'b'.repeat(32), assetPath: 'Assets/Hero.prefab', importer: 'PrefabImporter' },
      { guid: 'c'.repeat(32), assetPath: 'Assets/Hero.mat', type: 'material' },
    ] },
    dependencies: {
      edges: [
        { from: 'Assets/Main.unity', to: 'Assets/Hero.prefab', guid: 'b'.repeat(32), kind: 'asset', provider: 'unity-mcp' },
        { from: 'Assets/Hero.prefab', to: 'Assets/Hero.mat', guid: 'c'.repeat(32), kind: 'asset', provider: 'unity-mcp' },
      ],
      unresolved: [],
    },
    features: { blockers: [{ id: 'particle', count: 2, examples: ['Assets/Hero.prefab'] }] },
    diagnostics: [{ code: 'UNITY_LIVE_READY', severity: 'low', message: 'ready', evidence: ['Assets/Main.unity'] }],
    resolvesDiagnosticKeys: [resolvedKey],
    facts: { componentTypes: [{ type: 'UnityEngine.ParticleSystem', count: 2 }] },
  });
  const sourceBefore = JSON.parse(JSON.stringify(source));
  const patchBefore = JSON.parse(JSON.stringify(patch));

  const merged = mergeUnityProjectSnapshots(source, patch);
  const repeated = mergeUnityProjectSnapshots(source, patch);
  assert.deepEqual(source, sourceBefore);
  assert.deepEqual(patch, patchBefore);
  assert.deepEqual(merged, repeated);
  assert.deepEqual(validateUnityProjectSnapshot(merged), []);
  assert.equal(merged.provider, 'hybrid');
  assert.equal(merged.live.scanId, 'merge-scan-1');
  assert.equal(merged.assets.count, 2);
  assert.equal(merged.assets.records.find(item => item.guid === 'b'.repeat(32)).importer, 'PrefabImporter');
  assert.equal(merged.dependencies.edgeCount, 2);
  assert.equal(merged.dependencies.edges.find(item => item.from === 'Assets/Main.unity').provider, 'hybrid');
  assert.equal(merged.features.blockers[0].count, 2);
  assert.equal(merged.diagnostics.some(item => item.key === resolvedKey), false);
  assert.equal(merged.diagnostics.some(item => item.message === 'second'), true);
  assert.match(merged.fingerprint, /^[0-9a-f]{64}$/);
});

test('merge rejects mismatched fingerprints and records authoritative provider conflicts', () => {
  const source = staticSnapshot();
  const fingerprint = computeStaticProjectFingerprint(source);
  const mismatch = createUnityLiveSnapshotPatch({
    generatedAt: '2026-08-24T01:00:00.000Z', projectFingerprint: '0'.repeat(64), scanId: 'wrong',
  });
  assert.throws(() => mergeUnityProjectSnapshots(source, mismatch), error =>
    error && error.code === 'UNITY_LIVE_PROJECT_MISMATCH');

  const conflict = createUnityLiveSnapshotPatch({
    generatedAt: '2026-08-24T01:00:00.000Z', projectFingerprint: fingerprint, scanId: 'conflict',
    project: { unityVersion: '6000.3.1f1' },
  });
  const merged = mergeUnityProjectSnapshots(source, conflict);
  assert.equal(merged.project.unityVersion, '6000.3.1f1');
  assert.equal(merged.diagnostics.some(item => item.code === 'UNITY_PROVIDER_CONFLICT'), true);
});
