'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  SNAPSHOT_SCHEMA_VERSION,
  buildUnityProjectSnapshot,
  classifyPath,
  validateUnityProjectSnapshot,
} = require('./index.cjs');
const { createUnityFixture } = require('./test-fixture.cjs');

test('canonical static snapshot resolves project, build scenes, GUIDs and runtime view', t => {
  const fixture = createUnityFixture(t);
  const snapshot = buildUnityProjectSnapshot({
    projectRoot: fixture.root,
    sourceRoot: fixture.assets,
    cache: false,
  });

  assert.equal(snapshot.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  assert.deepEqual(validateUnityProjectSnapshot(snapshot), []);
  assert.match(validateUnityProjectSnapshot({
    ...snapshot,
    diagnostics: [{ severity: 'critical' }],
  }).join('; '), /diagnostic severity is invalid/);
  assert.equal(snapshot.project.unityVersion, '6000.0.66f2');
  assert.equal(snapshot.project.packages['com.unity.addressables'], '2.8.1');
  assert.equal(snapshot.inventory.scenes, 1);
  assert.equal(snapshot.assets.rawInventory.scenes, 3);
  assert.equal(snapshot.inventory.prefabs, 2);
  assert.equal(snapshot.inventory.scripts, 1);
  assert.equal(snapshot.dependencies.edgeCount, 4);
  assert.ok(snapshot.assets.packageCount >= 1);
  assert.equal(snapshot.dependencies.unresolvedCount, 0);
  assert.equal(snapshot.dependencies.edges.some(edge =>
    edge.to === 'Packages/com.unity.addressables/Runtime/Config.asset' &&
    edge.kind === 'asset' && edge.resolution === 'exact'), true);
  assert.equal(snapshot.scriptIndex.guidToScript[fixture.GUIDS.script], 'Assets/Game/Scripts/Gameplay.cs');

  const mainScene = snapshot.buildScenes.find(scene => scene.path.endsWith('/Main.unity'));
  const pluginScene = snapshot.buildScenes.find(scene => scene.path.endsWith('/Console.unity'));
  const sampleScene = snapshot.buildScenes.find(scene => scene.path.endsWith('/Test.unity'));
  assert.deepEqual(
    { enabled: mainScene.enabled, indexed: mainScene.indexed, scope: mainScene.scope, candidate: mainScene.gameplayCandidate },
    { enabled: true, indexed: true, scope: 'runtime', candidate: true }
  );
  assert.equal(pluginScene.scope, 'vendor');
  assert.equal(pluginScene.gameplayCandidate, false);
  assert.equal(sampleScene.scope, 'sample');
  assert.equal(sampleScene.enabled, false);

  assert.deepEqual(
    snapshot.views.entryPrefabs.map(prefab => prefab.path),
    ['Game/Prefabs/Main.prefab', 'Game/Prefabs/Child.prefab']
  );
  assert.equal(snapshot.features.blockers.some(blocker => blocker.id === 'dotween'), true);
  assert.equal(snapshot.features.blockers.some(blocker => blocker.id === 'coroutine'), false);
  assert.equal(snapshot.diagnostics.some(item => item.code === 'UNITY_DOTWEEN' && item.severity === 'high'), true);
});

test('path classification is deterministic and keeps plugin/sample evidence separate', () => {
  assert.equal(classifyPath('Assets/Game/Gameplay.cs'), 'runtime');
  assert.equal(classifyPath('Assets/ThirdParties/Runtime.cs'), 'vendor');
  assert.equal(classifyPath('Assets/Spine Examples/Mix.unity'), 'sample');
  assert.equal(classifyPath('Assets/VFX tutorials/Demo.prefab'), 'runtime');
  assert.equal(classifyPath('Assets/Samples~/VFX/Demo.prefab'), 'sample');
  assert.equal(classifyPath('Assets/Animation/Tutorial/handcursor.prefab'), 'runtime');
  assert.equal(classifyPath('Assets/Game/Editor/Tool.cs'), 'editor');
});

test('include-vendor can select an enabled vendor build scene explicitly', t => {
  const fixture = createUnityFixture(t);
  const snapshot = buildUnityProjectSnapshot({
    projectRoot: fixture.root,
    sourceRoot: fixture.assets,
    cache: false,
    includeVendor: true,
  });
  const plugin = snapshot.buildScenes.find(scene => scene.path.endsWith('/Console.unity'));
  assert.equal(plugin.gameplayCandidate, true);
});

test('structural diagnostics cover missing meta, build GUID mismatch, unresolved refs and binary parse gaps', t => {
  const fixture = createUnityFixture(t);
  fixture.write('Assets/Game/Orphan.asset', 'Orphan:\n  value: 1\n');
  fixture.write('Assets/Game/Duplicate.prefab', '%YAML 1.1\n--- !u!1 &1\nGameObject:\n  m_Name: Duplicate\n');
  fixture.write('Assets/Game/Duplicate.prefab.meta',
    `fileFormatVersion: 2\nguid: ${fixture.GUIDS.childPrefab}\n`);

  const settings = path.join(fixture.root, 'ProjectSettings', 'EditorBuildSettings.asset');
  const mismatched = fs.readFileSync(settings, 'utf8').replace(fixture.GUIDS.scene, '9'.repeat(32));
  fs.writeFileSync(settings, mismatched, 'utf8');

  const mainPrefab = path.join(fixture.assets, 'Game', 'Prefabs', 'Main.prefab');
  fs.appendFileSync(mainPrefab,
    `  m_Missing: {fileID: 11400000, guid: ${'8'.repeat(32)}, type: 2}\n`, 'utf8');

  const binary = Buffer.alloc(32);
  binary.writeUInt32BE(20, 0);
  binary.writeUInt32BE(32, 4);
  binary.writeUInt32BE(21, 8);
  binary.writeUInt32BE(20, 12);
  const binaryFile = path.join(fixture.assets, 'Game', 'Broken.asset');
  fs.writeFileSync(binaryFile, binary);
  fixture.write('Assets/Game/Broken.asset.meta', `fileFormatVersion: 2\nguid: ${'7'.repeat(32)}\n`);

  const snapshot = buildUnityProjectSnapshot({
    projectRoot: fixture.root,
    sourceRoot: fixture.assets,
    cache: false,
  });
  const codes = new Set(snapshot.diagnostics.map(item => item.code));
  assert.equal(codes.has('UNITY_ASSET_META_MISSING'), true);
  assert.equal(codes.has('UNITY_DUPLICATE_GUID'), true);
  assert.equal(codes.has('UNITY_BUILD_SCENE_GUID_MISMATCH'), true);
  assert.equal(codes.has('UNITY_REACHABLE_GUID_UNRESOLVED'), true);
  assert.equal(codes.has('UNITY_SERIALIZED_FILE_PARTIAL'), true);
  assert.deepEqual(snapshot.dependencies.unresolved.map(item => item.guid), ['8'.repeat(32)]);
});

test('explicit project metadata cannot be combined with an external source tree', t => {
  const fixture = createUnityFixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-intel-outside-source-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  assert.throws(() => buildUnityProjectSnapshot({
    projectRoot: fixture.root,
    sourceRoot: outside,
    cache: false,
  }), /source must be inside/i);
});
