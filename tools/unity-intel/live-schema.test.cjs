'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  computeStaticProjectFingerprint,
  createUnityLiveSnapshotPatch,
  diagnosticKey,
  validateUnityLiveSnapshotPatch,
} = require('./live-schema.cjs');

function staticIdentity(overrides = {}) {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    project: {
      name: 'PuzzleGame',
      root: 'D:/one/location/PuzzleGame',
      unityVersion: '6000.0.66f2',
      ...(overrides.project || {}),
    },
    buildScenes: overrides.buildScenes || [
      { enabled: false, path: 'Assets/Debug.unity', guid: 'f'.repeat(32) },
      { enabled: true, path: 'Assets/Game/Main.unity', guid: 'A'.repeat(32) },
      { enabled: true, path: 'Assets/Game/Boot.unity', guid: 'b'.repeat(32) },
    ],
  };
}

test('static project fingerprint excludes absolute roots/timestamps and sorts enabled build scenes', () => {
  const first = staticIdentity();
  const reordered = staticIdentity({
    project: { root: 'C:/different/clone/PuzzleGame' },
    buildScenes: [...first.buildScenes].reverse(),
  });
  reordered.generatedAt = '2030-12-31T23:59:59.000Z';
  assert.equal(computeStaticProjectFingerprint(first), computeStaticProjectFingerprint(reordered));

  const disabledChanged = staticIdentity();
  disabledChanged.buildScenes[0].guid = '1'.repeat(32);
  assert.equal(computeStaticProjectFingerprint(first), computeStaticProjectFingerprint(disabledChanged));

  const enabledChanged = staticIdentity();
  enabledChanged.buildScenes[1].guid = '2'.repeat(32);
  assert.notEqual(computeStaticProjectFingerprint(first), computeStaticProjectFingerprint(enabledChanged));
});

test('live patch schema validates provider, project identity and bounded safe evidence', () => {
  const snapshot = staticIdentity();
  const fingerprint = computeStaticProjectFingerprint(snapshot);
  const patch = createUnityLiveSnapshotPatch({
    generatedAt: '2026-08-24T00:00:00.000Z',
    projectFingerprint: fingerprint,
    scanId: 'scan-001',
    project: { name: 'PuzzleGame', unityVersion: '6000.0.66f2' },
    buildScenes: snapshot.buildScenes,
    diagnostics: [{ code: 'UNITY_LIVE_NOTE', severity: 'low', message: 'Ready', evidence: ['Assets/Game/Main.unity'] }],
  });
  assert.deepEqual(validateUnityLiveSnapshotPatch(patch, { expectedProjectFingerprint: fingerprint }), []);

  assert.match(validateUnityLiveSnapshotPatch({ ...patch, provider: 'remote-shell' }).join('; '), /provider is invalid/);
  assert.match(validateUnityLiveSnapshotPatch({ ...patch, projectFingerprint: '0'.repeat(64) }, {
    expectedProjectFingerprint: fingerprint,
  }).join('; '), /does not match/);
  assert.match(validateUnityLiveSnapshotPatch({ ...patch, facts: { accessToken: 'do-not-store' } }).join('; '),
    /unsafe payload/);
  assert.match(validateUnityLiveSnapshotPatch({ ...patch, facts: { path: 'C:\\Users\\Admin\\game.cs' } }).join('; '),
    /absolute filesystem path/);
});

test('diagnostic keys are deterministic but distinguish concrete evidence', () => {
  const left = { code: 'UNITY_MISSING', severity: 'high', evidence: ['Assets/B.prefab', 'Assets/A.prefab'] };
  const reordered = { ...left, evidence: [...left.evidence].reverse() };
  const other = { ...left, evidence: ['Assets/C.prefab'] };
  assert.equal(diagnosticKey(left), diagnosticKey(reordered));
  assert.notEqual(diagnosticKey(left), diagnosticKey(other));
  assert.equal(diagnosticKey({ ...left, key: 'explicit:key' }), 'explicit:key');
});
