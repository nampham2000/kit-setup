'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const {
  SNAPSHOT_SCHEMA_VERSION,
  buildUnityProjectSnapshot,
  classifyPath,
  validateUnityProjectSnapshot,
} = require('./index.cjs');
const { createUnityFixture } = require('./test-fixture.cjs');
const { selectGameplayEntry } = require('./core-gameplay-scope.cjs');

const LEVEL_PREFAB = 'Assets/Game/Levels/Level_Big.prefab';
const MISSING_GUID = '9'.repeat(32);

// Mirrors a puzzle level prefab: thousands of nested prefab instances that all
// repeat the same PPtrs (modification targets, parent and source prefab).
function levelPrefabText(sourceGuid, instances) {
  const parts = ['%YAML 1.1'];
  for (let index = 0; index < instances; index += 1) {
    const id = 1000000 + index;
    parts.push(
      `--- !u!1001 &${id}`,
      'PrefabInstance:',
      '  m_ObjectHideFlags: 0',
      '  m_Modification:',
      '    serializedVersion: 3',
      `    m_TransformParent: {fileID: 400000, guid: ${MISSING_GUID}, type: 3}`,
      '    m_Modifications:',
      `    - target: {fileID: 1111, guid: ${sourceGuid}, type: 3}`,
      '      propertyPath: m_LocalPosition.x',
      `      value: ${index}`,
      '      objectReference: {fileID: 0}',
      `    - target: {fileID: 1111, guid: ${sourceGuid}, type: 3}`,
      '      propertyPath: m_LocalPosition.y',
      `      value: ${index}`,
      '      objectReference: {fileID: 0}',
      '    m_RemovedComponents: []',
      `  m_SourcePrefab: {fileID: 100100000, guid: ${sourceGuid}, type: 3}`,
    );
  }
  parts.push('');
  return parts.join('\n');
}

function writeLevelPrefab(fixture, instances) {
  fixture.write(LEVEL_PREFAB, levelPrefabText(fixture.GUIDS.childPrefab, instances));
  fixture.write(`${LEVEL_PREFAB}.meta`, `fileFormatVersion: 2\nguid: ${'4'.repeat(32)}\n`);
}

test('explicit demo selection consumes the real scanner scene inventory outside Build Settings', t => {
  const fixture = createUnityFixture(t);
  const snapshot = buildUnityProjectSnapshot({ projectRoot: fixture.root, sourceRoot: fixture.assets, cache: false });
  const sample = snapshot.scenes.find(scene => scene.scope === 'sample');
  assert.ok(sample);
  assert.notEqual(sample.path, sample.assetPath);
  snapshot.buildScenes = snapshot.buildScenes.filter(scene => scene.path !== sample.assetPath);
  const entry = selectGameplayEntry(snapshot, { entryScene: sample.assetPath });
  assert.equal(entry.primary, sample.assetPath);
  assert.equal(entry.selection, 'explicit');
  assert.equal(entry.needsDecision, false);
});

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

test('repeated references in large level prefabs keep index evidence, edges and cache bounded', t => {
  const fixture = createUnityFixture(t);
  const instances = 2000;
  writeLevelPrefab(fixture, instances);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-intel-level-cache-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

  const snapshot = buildUnityProjectSnapshot({ projectRoot: fixture.root, sourceRoot: fixture.assets, cacheDir });
  const record = snapshot.assets.records.find(item => item.assetPath === LEVEL_PREFAB);
  assert.ok(record);
  // Scalar checks first: a regression must fail without diffing thousands of records.
  assert.equal(record.referenceEvidence.length, 3, 'one grouped entry per GUID + field path');
  assert.deepEqual(record.referenceEvidence.map(item => [item.fieldPath, item.occurrences]).sort(), [
    ['PrefabInstance.m_Modification.m_TransformParent', instances],
    ['PrefabInstance.m_Modification.target', instances * 2],
    ['PrefabInstance.m_SourcePrefab', instances],
  ]);
  for (const reference of record.referenceEvidence) {
    assert.ok(reference.evidenceLines.length <= 3);
    assert.equal(reference.line, reference.evidenceLines[0]);
    assert.equal(reference.objectId, '1000000');
    assert.equal(reference.classId, 1001);
  }

  const edges = snapshot.dependencies.edges.filter(edge => edge.from === LEVEL_PREFAB);
  assert.equal(edges.length, 2);
  assert.equal(edges.every(edge => edge.to === 'Assets/Game/Prefabs/Child.prefab'), true);
  assert.equal(edges.reduce((sum, edge) => sum + edge.occurrences, 0), instances * 3);
  assert.equal(edges.every(edge => edge.evidenceLines.length > 0 && edge.evidenceLines.length <= 3), true);
  const missing = snapshot.dependencies.unresolved.find(item => item.guid === MISSING_GUID);
  assert.equal(missing.occurrences, instances);
  assert.deepEqual(missing.fields, ['PrefabInstance.m_Modification.m_TransformParent']);

  assert.equal(snapshot.cache.written, true);
  assert.ok(fs.statSync(snapshot.cache.file).size < 128 * 1024, 'index cache grows with occurrence count');
  const warm = buildUnityProjectSnapshot({ projectRoot: fixture.root, sourceRoot: fixture.assets, cacheDir });
  assert.equal(warm.cache.mode, 'warm');
  assert.equal(warm.dependencies.edgeCount, snapshot.dependencies.edgeCount);
  assert.deepEqual(warm.dependencies.edges.filter(edge => edge.from === LEVEL_PREFAB), edges);
});

test('large level prefab index does not retain per-occurrence evidence in memory', () => {
  // 8000 instances x 4 PPtrs = 32000 occurrences (~3 MB of YAML). Occurrence
  // records retained roughly 300 heap bytes each; grouped evidence is O(1).
  const script = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const { createUnityFixture } = require(${JSON.stringify(require.resolve('./test-fixture.cjs'))});
    const { buildUnityProjectSnapshot } = require(${JSON.stringify(require.resolve('./project-index.cjs'))});
    const MISSING_GUID = ${JSON.stringify(MISSING_GUID)};
    const levelPrefabText = ${levelPrefabText.toString()};
    const levelPath = ${JSON.stringify(LEVEL_PREFAB)};
    const fixture = createUnityFixture(null);
    try {
      fixture.write(levelPath, levelPrefabText(fixture.GUIDS.childPrefab, 8000));
      fixture.write(levelPath + '.meta', ${JSON.stringify(`fileFormatVersion: 2\nguid: ${'4'.repeat(32)}\n`)});
      const options = { projectRoot: fixture.root, sourceRoot: fixture.assets, cache: false };
      buildUnityProjectSnapshot(options);
      global.gc();
      const baseline = process.memoryUsage().heapUsed;
      const snapshot = buildUnityProjectSnapshot(options);
      // Clear V8's last-match subject, which is separate from retained records.
      /reset/.test('reset');
      global.gc();
      const retained = process.memoryUsage().heapUsed - baseline;
      const record = snapshot.assets.records.find(item => item.assetPath === levelPath);
      let occurrences = 0;
      for (const item of record.referenceEvidence) occurrences += item.occurrences || 1;
      assert.equal(occurrences, 32000);
      const perOccurrence = retained / occurrences;
      assert.ok(perOccurrence < 24, 'retained heap bytes per reference occurrence: ' + perOccurrence.toFixed(1) +
        ' (' + retained + ' bytes, ' + record.referenceEvidence.length + ' evidence entries)');
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  `;
  const child = spawnSync(process.execPath, ['--max-old-space-size=256', '--expose-gc', '-e', script], {
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
});
