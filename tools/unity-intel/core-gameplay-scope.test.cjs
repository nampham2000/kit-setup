'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCoreGameplayScope,
  coreGameplayProjection,
  normalizePortProfile,
  selectGameplayEntry,
} = require('./core-gameplay-scope.cjs');

function snapshotFixture() {
  const records = [
    ['Assets/Scenes/Loading.unity', 'scene'],
    ['Assets/Scenes/MainMenu.unity', 'scene'],
    ['Assets/Scenes/Gameplay.unity', 'scene'],
    ['Assets/Game/Board.prefab', 'prefab'],
    ['Assets/Game/Scripts/BoardInputController.cs', 'script'],
    ['Assets/Game/Scripts/GameManager.cs', 'script'],
    ['Assets/Game/Audio/tap.mp3', 'audio'],
    ['Assets/Services/FirebaseAnalytics.cs', 'script'],
    ['Assets/UI/Shop/ShopPopup.prefab', 'prefab'],
  ].map(([assetPath, type]) => ({ assetPath, path: assetPath.slice('Assets/'.length), type, scope: 'runtime' }));
  return {
    project: {
      packages: {
        'com.unity.inputsystem': '1.0.0',
        'com.google.firebase.analytics': '12.0.0',
      },
    },
    buildScenes: [
      { path: 'Assets/Scenes/Loading.unity', enabled: true, indexed: true, scope: 'runtime' },
      { path: 'Assets/Scenes/MainMenu.unity', enabled: true, indexed: true, scope: 'runtime' },
      { path: 'Assets/Scenes/Gameplay.unity', enabled: true, indexed: true, scope: 'runtime' },
    ],
    assets: { records },
    dependencies: {
      edges: [
        { from: 'Assets/Scenes/Gameplay.unity', to: 'Assets/Game/Board.prefab', kind: 'asset' },
        { from: 'Assets/Game/Board.prefab', to: 'Assets/Game/Scripts/BoardInputController.cs', kind: 'asset' },
        { from: 'Assets/Game/Scripts/BoardInputController.cs', to: 'Assets/Game/Scripts/GameManager.cs', kind: 'code-type-reference' },
        { from: 'Assets/Game/Scripts/GameManager.cs', to: 'Assets/Services/FirebaseAnalytics.cs', kind: 'code-type-reference' },
        { from: 'Assets/Game/Board.prefab', to: 'Assets/Game/Audio/tap.mp3', kind: 'asset' },
        { from: 'Assets/Scenes/MainMenu.unity', to: 'Assets/UI/Shop/ShopPopup.prefab', kind: 'asset' },
      ],
    },
    scriptIndex: {
      scripts: [
        {
          assetPath: 'Assets/Game/Scripts/BoardInputController.cs', scope: 'runtime',
          declaredTypes: ['BoardInputController'], methods: ['OnPointerDown'],
        },
        { assetPath: 'Assets/Game/Scripts/GameManager.cs', scope: 'runtime', declaredTypes: ['GameManager'] },
        { assetPath: 'Assets/Services/FirebaseAnalytics.cs', scope: 'runtime', declaredTypes: ['FirebaseAnalytics'] },
      ],
    },
    features: { blockers: [] },
    views: {
      scenes: [],
      entryPrefabs: [{ assetPath: 'Assets/Game/Board.prefab', scope: 'runtime' }],
    },
  };
}

test('playable-core scope selects gameplay scene and removes menu/shop/online implementations from routes', () => {
  const snapshot = snapshotFixture();
  const first = buildCoreGameplayScope(snapshot);
  const second = buildCoreGameplayScope(snapshot);
  assert.deepEqual(coreGameplayProjection(first), coreGameplayProjection(second));
  assert.equal(first.entry.primary, 'Assets/Scenes/Gameplay.unity');
  assert.equal(first.entry.confidence, 'high');
  assert.equal(first.entry.needsDecision, false);
  assert.equal(first.pathSet.has('Assets/Game/Board.prefab'), true);
  assert.equal(first.pathSet.has('Assets/Game/Scripts/BoardInputController.cs'), true);
  assert.equal(first.adapterPathSet.has('Assets/Services/FirebaseAnalytics.cs'), true);
  assert.equal(first.pathSet.has('Assets/UI/Shop/ShopPopup.prefab'), false);
  assert.equal(first.adapters.some(item => item.id === 'ads-analytics'), true);
  assert.equal(first.excluded.some(item => item.id === 'commerce'), true);
  assert.deepEqual(first.entryPrefabs, ['Assets/Game/Board.prefab']);
  assert.equal(first.features.some(feature => feature.id === 'input'), true);
  assert.equal(first.features.some(feature => feature.id === 'analytics-monetization'), false);
  assert.equal(first.checkpoints.reduce((sum, checkpoint) => sum + checkpoint.weight, 0), 100);
});

test('scene selection fails visibly when no unique gameplay candidate exists', () => {
  const snapshot = snapshotFixture();
  snapshot.buildScenes = snapshot.buildScenes.filter(scene => !scene.path.endsWith('Gameplay.unity'));
  const entry = selectGameplayEntry(snapshot);
  assert.equal(entry.needsDecision, true);
  assert.notEqual(entry.confidence, 'high');
});

test('full-project remains an explicit escape hatch and invalid profiles fail closed', () => {
  const snapshot = snapshotFixture();
  const scope = buildCoreGameplayScope(snapshot, { profile: 'full-project' });
  assert.equal(scope.profile, 'full-project');
  assert.equal(scope.pathSet, null);
  assert.equal(scope.closure.includedCount, snapshot.assets.records.length);
  assert.throws(() => normalizePortProfile('everything'), error => error.code === 'UNITY_PORT_PROFILE_INVALID');
});
