'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_CANDIDATE_DISPOSITIONS_BYTES,
  MAX_CANDIDATE_REFERENCES_TOTAL,
  MAX_DIAGNOSTIC_CODE_LENGTH,
  MAX_LIVE_DIAGNOSTICS,
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
  assert.match(validateUnityLiveSnapshotPatch({
    ...patch,
    diagnostics: Array.from({ length: MAX_LIVE_DIAGNOSTICS + 1 }, (_, index) => ({
      code: `UNITY_NOTE_${index}`, severity: 'low', message: 'bounded', evidence: [],
    })),
  }).join('; '), /at most/);
  assert.match(validateUnityLiveSnapshotPatch({
    ...patch,
    diagnostics: [{ code: `U${'X'.repeat(MAX_DIAGNOSTIC_CODE_LENGTH)}`, severity: 'high' }],
  }).join('; '), /diagnostic code/);
  assert.match(validateUnityLiveSnapshotPatch({
    ...patch, resolvesUnresolvedGuids: ['not-a-guid'],
  }).join('; '), /resolvesUnresolvedGuids/);
  assert.deepEqual(validateUnityLiveSnapshotPatch({
    ...patch,
    candidateDispositions: [{
      kind: 'serialized-asset', key: 'Assets/Game/Binary.asset', status: 'resolved',
      assetPath: 'Assets/Game/Binary.asset', assetType: 'UnityEngine.ScriptableObject', dependencyCount: 1,
      serializedScanComplete: true, serializedPropertyCount: 8, missingReferenceCount: 0,
      referencesComplete: true, references: [
        { fieldPath: '', assetPath: 'Assets/Atlas.spriteatlas', guid: '1'.repeat(32), objectId: '', type: 'UnityEngine.SpriteAtlas' },
        { fieldPath: 'first', assetPath: 'Assets/Atlas.png', guid: '2'.repeat(32), objectId: '21300000', type: 'UnityEngine.Sprite' },
        { fieldPath: 'second', assetPath: 'Assets/Atlas.png', guid: '2'.repeat(32), objectId: '21300002', type: 'UnityEngine.Sprite' },
      ],
    }],
  }), []);
  assert.match(validateUnityLiveSnapshotPatch({
    ...patch,
    candidateDispositions: [{
      kind: 'guid', key: 'a'.repeat(32), status: 'resolved', assetPath: 'Assets/A.asset',
      dependencyCount: 3, referencesComplete: true, references: [],
    }],
  }).join('; '), /inconsistent/);
  assert.match(validateUnityLiveSnapshotPatch({
    ...patch,
    candidateDispositions: [{
      kind: 'serialized-asset', key: 'Assets/A.asset', status: 'resolved', assetPath: 'Assets/A.asset',
      dependencyCount: 0, serializedScanComplete: true, serializedPropertyCount: 1,
      missingReferenceCount: 1, referencesComplete: true, references: [],
    }],
  }).join('; '), /inconsistent/);
  assert.match(validateUnityLiveSnapshotPatch({
    ...patch,
    candidateDispositions: [{
      kind: 'guid', key: 'a'.repeat(32), status: 'resolved', assetPath: '',
      referencesComplete: true, references: [],
    }],
  }).join('; '), /inconsistent/);
  assert.match(validateUnityLiveSnapshotPatch({
    ...patch,
    candidateDispositions: [{
      kind: 'serialized-asset', key: 'Assets/A.asset', status: 'resolved',
      assetPath: 'Assets/B.asset', serializedScanComplete: true, referencesComplete: true, references: [],
    }],
  }).join('; '), /inconsistent/);

  const oversizedReferences = Array.from({ length: MAX_CANDIDATE_REFERENCES_TOTAL + 1 }, (_, index) => ({
    fieldPath: `refs.Array.data[${index}]`,
    assetPath: `Assets/Dependency/${index}.asset`,
    guid: index.toString(16).padStart(32, '0'),
    type: 'UnityEngine.Object',
  }));
  assert.match(validateUnityLiveSnapshotPatch({
    ...patch,
    candidateDispositions: Array.from({ length: Math.ceil(oversizedReferences.length / 128) }, (_, index) => ({
      kind: 'guid', key: (index + 1).toString(16).padStart(32, '0'), status: 'partial',
      assetPath: `Assets/Candidate/${index}.asset`, referencesComplete: false,
      references: oversizedReferences.slice(index * 128, (index + 1) * 128),
    })),
  }).join('; '), /global .* reference budget/);
});

test('diagnostic keys are deterministic but distinguish concrete evidence', () => {
  const left = { code: 'UNITY_MISSING', severity: 'high', evidence: ['Assets/B.prefab', 'Assets/A.prefab'] };
  const reordered = { ...left, evidence: [...left.evidence].reverse() };
  const other = { ...left, evidence: ['Assets/C.prefab'] };
  assert.equal(diagnosticKey(left), diagnosticKey(reordered));
  assert.notEqual(diagnosticKey(left), diagnosticKey(other));
  assert.equal(diagnosticKey({ ...left, key: 'explicit:key' }), 'explicit:key');
});

test('compact partial fallback for a maximum UTF-8 candidate request stays within the live budget', () => {
  const unicodePath = `Assets/${'界'.repeat(303)}/A.asset`;
  const dispositions = [
    ...Array.from({ length: 512 }, (_, index) => ({
      kind: 'guid',
      key: index.toString(16).padStart(32, '0'),
      status: 'partial',
      assetPath: '',
      assetType: 'Unknown',
      dependencyCount: 0,
      serializedScanComplete: false,
      serializedPropertyCount: 0,
      missingReferenceCount: 0,
      referencesComplete: false,
      references: [],
    })),
    ...Array.from({ length: 96 }, (_, index) => ({
      kind: 'serialized-asset',
      key: `${unicodePath.slice(0, -7)}${String(index).padStart(2, '0')}.asset`,
      status: 'partial',
      assetPath: '',
      assetType: 'Unknown',
      dependencyCount: 0,
      serializedScanComplete: false,
      serializedPropertyCount: 0,
      missingReferenceCount: 0,
      referencesComplete: false,
      references: [],
    })),
  ];
  assert.ok(dispositions.every(item => item.key.length <= 320));
  assert.ok(Buffer.byteLength(JSON.stringify(dispositions), 'utf8') <= MAX_CANDIDATE_DISPOSITIONS_BYTES);
});
