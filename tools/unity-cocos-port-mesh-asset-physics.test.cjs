'use strict';

// Unity Mesh .asset files are serialized YAML that no Cocos importer reads. Evidence (Screw Out
// Factory, Level_27): the MeshCollider path copied ConvexColliders/Lv_27_Hambuger/*.asset raw into
// assets/unity_imported, AssetDB kept 15 importer states pending and the port failed with
// COCOS_ASSET_IMPORT_INCOMPLETE. Renderers and colliders must go through the FBX export
// (handleMissingModel), and a name-matched primitive is only a fallback when that export fails.
// `--skip-physics` drops physics components for playables that replace physics with their own logic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const createRendererPorter = require('./unity-cocos-port/renderer-porter');
const createColliderPorter = require('./unity-cocos-port/collider-porter');
const createComponentDispatcher = require('./unity-cocos-port/component-dispatcher');
const createAssetImportPorter = require('./unity-cocos-port/asset-import-porter');

const MESH_ASSET = { ext: '.asset', stem: 'Cube_10', relativePath: 'ConvexColliders/Lv_27_Hambuger/Cube_10.asset', path: 'unused' };

function reporterSpy() {
  const reports = [];
  const add = (severity) => (...args) => reports.push([severity, ...args]);
  return { reports, low: add('low'), medium: add('medium'), high: add('high'), add: (severity, ...args) => reports.push([severity, ...args]) };
}

function forbiddenRawCopy() {
  throw new Error('a Unity Mesh .asset must never be copied raw into Cocos assets');
}

function renderMeshAsset(missingResult, primitive = '') {
  const calls = { missing: 0, primitive: 0, renderers: [] };
  const porter = createRendererPorter({
    resolveUnityMaterialUuids: () => [],
    resolveUnityMaterialUuid: () => '',
    resolveUnityBuiltinMeshUuid: () => '',
    resolveBuiltinPrimitiveMeshUuid: () => { calls.primitive += 1; return primitive; },
    importedUnityAssetPath: forbiddenRawCopy,
    copyUnityAssetToCocos: forbiddenRawCopy,
    resolveLibraryAssetUuid: forbiddenRawCopy,
    handleMissingModel: (asset, reporter, options, config) => {
      calls.missing += 1;
      assert.equal(asset, MESH_ASSET);
      assert.equal(config.autoCopy, true);
      return missingResult;
    },
    recordPendingMeshRepair() {},
    getField: (doc, key) => (key === 'm_Mesh' ? { fileID: '4300000', guid: 'mesh-asset' } : null),
    getNestedList: () => [],
    unityRefGuid: () => 'mesh-asset',
    unityRefFileId: () => '4300000',
  });
  const builder = {
    addMeshBasisNode() { return 42; },
    addMeshRenderer(...args) { calls.renderers.push(args); },
  };
  const reporter = reporterSpy();
  const model = { file: 'Level_27.prefab', componentDocs: new Map([['mf', { classId: 33 }]]) };
  porter.emitMeshRenderer({ name: 'Cube_10', components: ['mf'] }, 7, 'r', {}, model, builder, reporter, {},
    { get: () => MESH_ASSET }, { resolveModelMeshByStem: () => null, resolveModelMaterialUuidsByStem: () => null });
  return { calls, reports: reporter.reports };
}

test('a MeshRenderer on a Unity Mesh .asset uses the exported FBX mesh, not a raw copy or a primitive', () => {
  const { calls } = renderMeshAsset({ pendingImport: false, resolved: { meshUuid: 'exported@mesh' } }, 'builtin-cube');
  assert.equal(calls.missing, 1);
  assert.equal(calls.primitive, 0, 'the primitive guess must not preempt the exact exported mesh');
  assert.equal(calls.renderers.length, 1);
  assert.equal(calls.renderers[0][2], 'exported@mesh');
});

test('a name-matched primitive is used only when the FBX export failed, never while it is importing', () => {
  const failed = renderMeshAsset({ pendingImport: false, resolved: null }, 'builtin-cube');
  assert.equal(failed.calls.primitive, 1);
  assert.equal(failed.calls.renderers[0][2], 'builtin-cube');
  assert.ok(failed.reports.some(r => r[1] === 'MODEL_PRIMITIVE_FALLBACK_USED'));

  const pending = renderMeshAsset({ pendingImport: true, resolved: null }, 'builtin-cube');
  assert.equal(pending.calls.primitive, 0);
  assert.equal(pending.calls.renderers[0][2], '');
});

function colliderMeshAsset(missingResult, primitive = '') {
  const calls = { missing: 0, primitive: 0, colliders: [] };
  const porter = createColliderPorter({
    getField: (doc, key, fallback) => (key in doc ? doc[key] : fallback),
    parseUnityPolygonColliderPaths: () => [],
    boundsForUnityPolygonPaths: () => null,
    unityRefGuid: ref => ref?.guid || '',
    resolveUnityPhysicsMaterialUuid: () => '',
    resolveUnityBuiltinMeshUuid: () => '',
    resolveBuiltinPrimitiveMeshUuid: () => { calls.primitive += 1; return primitive; },
    importedUnityAssetPath: forbiddenRawCopy,
    copyUnityAssetToCocos: forbiddenRawCopy,
    resolveLibraryAssetUuid: forbiddenRawCopy,
    handleMissingModel: (asset) => {
      calls.missing += 1;
      assert.equal(asset, MESH_ASSET);
      return missingResult;
    },
  });
  const builder = {
    componentMap: new Map(),
    objects: [],
    addMeshCollider(nodeId, componentId, config) { calls.colliders.push(config); },
  };
  const reporter = reporterSpy();
  const doc = { m_Mesh: { fileID: '4300000', guid: 'mesh-asset' }, m_Convex: 1, m_Enabled: 1 };
  const model = { file: 'Level_27.prefab', componentDocs: new Map() };
  porter.emitMeshCollider(3, 'c', doc, { name: 'Cube_10', components: [] }, model, builder, reporter, {},
    { get: guid => (guid === 'mesh-asset' ? MESH_ASSET : null) }, { resolveModelMeshByStem: () => null });
  return { calls, reports: reporter.reports };
}

test('a MeshCollider on a Unity Mesh .asset exports FBX instead of copying the YAML mesh', () => {
  const exported = colliderMeshAsset({ pendingImport: false, resolved: { meshUuid: 'hull@mesh' } }, 'builtin-cube');
  assert.equal(exported.calls.missing, 1);
  assert.equal(exported.calls.primitive, 0);
  assert.equal(exported.calls.colliders[0].meshUuid, 'hull@mesh');
  assert.equal(exported.calls.colliders[0].convex, true);

  const failed = colliderMeshAsset({ pendingImport: false, resolved: null }, 'builtin-cube');
  assert.equal(failed.calls.colliders[0].meshUuid, 'builtin-cube');

  const pending = colliderMeshAsset({ pendingImport: true, resolved: null }, 'builtin-cube');
  assert.equal(pending.calls.primitive, 0);
  assert.equal(pending.calls.colliders[0].meshUuid, '');
  assert.ok(pending.reports.some(r => r[1] === 'MESH_COLLIDER_UNRESOLVED'));
});

test('handleMissingModel never falls back to a raw copy when the FBX export fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-asset-raw-'));
  try {
    const source = path.join(root, 'Broken.asset');
    fs.writeFileSync(source, '--- !u!43 &4300000\nMesh:\n  m_Name: Broken\n', 'utf8');
    const porter = createAssetImportPorter({
      ensureDirectoryMetas() {},
      ensurePreparedAssetMeta() {},
      recoverModelMetaFromLibrary() {},
      waitForImportedModelAsset: () => null,
    });
    const reporter = reporterSpy();
    const cocosRoot = path.join(root, 'cocos');
    const result = porter.handleMissingModel(
      { ext: '.asset', stem: 'Broken', relativePath: 'Meshes/Broken.asset', path: source },
      reporter, { cocosRoot, copyAssets: true }, { autoCopy: true, severity: 'medium' },
    );
    assert.equal(result.resolved, null);
    assert.equal(result.pendingImport, false);
    assert.equal(fs.existsSync(path.join(cocosRoot, 'assets', 'unity_imported', 'Meshes', 'Broken.asset')), false);
    const codes = reporter.reports.map(r => r[1]);
    assert.ok(codes.includes('UNITY_MESH_ASSET_FBX_EXTRACT_FAILED'));
    assert.ok(codes.includes('MODEL_UNRESOLVED'));
    assert.ok(!codes.includes('ASSET_COPIED_NEEDS_IMPORT'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function dispatch(options) {
  const called = [];
  const record = name => () => called.push(name);
  const dispatcher = createComponentDispatcher({
    emitMeshRenderer: record('MeshRenderer'),
    emitRigidbody: record('Rigidbody'),
    emitMeshCollider: record('MeshCollider'),
    emitBoxCollider: record('BoxCollider'),
    emitRigidbody2D: record('Rigidbody2D'),
    emitParticleSystem: record('ParticleSystem'),
    emitMonoBehaviour: record('MonoBehaviour'),
  });
  const docs = new Map([
    ['rb', { classId: 54 }], ['mc', { classId: 64 }], ['bc', { classId: 65 }], ['mr', { classId: 23 }],
    ['rb2d', { classId: 50 }], ['joint', { classId: 153 }],
  ]);
  const model = {
    file: 'Shape.prefab',
    gameObjects: new Map([['go', { fileId: 'go', name: 'Shape', components: [...docs.keys()] }]]),
    transforms: new Map(),
    componentDocs: docs,
  };
  const builder = { nodeMapByGameObject: new Map([['go', 1]]) };
  const reporter = reporterSpy();
  dispatcher.emitComponents(model, builder, reporter, options, {}, {});
  return { called, reports: reporter.reports };
}

test('--skip-physics drops bodies, colliders and joints with a low report and keeps renderers', () => {
  const skipped = dispatch({ skipPhysics: true });
  assert.deepEqual(skipped.called, ['MeshRenderer']);
  const physicsReports = skipped.reports.filter(r => r[1] === 'PHYSICS_COMPONENT_SKIPPED');
  assert.equal(physicsReports.length, 5);
  assert.ok(physicsReports.every(r => r[0] === 'low'));
  assert.ok(!skipped.reports.some(r => r[0] === 'high'), 'a skipped ConfigurableJoint is not an unsupported-component high');

  const kept = dispatch({});
  assert.deepEqual(kept.called, ['Rigidbody', 'MeshCollider', 'BoxCollider', 'MeshRenderer', 'Rigidbody2D']);
  assert.ok(kept.reports.some(r => r[0] === 'high' && r[1] === 'COMPONENT_UNSUPPORTED'), 'without the flag the joint stays a high');
});

test('--skip-physics is parsed, conflicts with a physics backend and changes the port cache key', () => {
  const { parseArgs } = require('./unity-cocos-port.cjs');
  assert.equal(typeof parseArgs, 'function');
  assert.equal(parseArgs(['port', '--src', 'a.prefab', '--out', 'b.prefab', '--skip-physics']).skipPhysics, true);
  assert.equal(parseArgs(['port', '--src', 'a.prefab', '--out', 'b.prefab']).skipPhysics, false);
  assert.throws(() => parseArgs(['port', '--src', 'a.prefab', '--out', 'b.prefab', '--skip-physics', '--physics-backend', 'physics-cannon']),
    /--skip-physics conflicts/);
  assert.throws(() => parseArgs(['port', '--src', 'a.prefab', '--out', 'b.prefab', '--force-physics-backend', '--skip-physics']),
    /--skip-physics conflicts/);
  const { PortCache } = require('./unity-cocos-port/port-cache');
  const file = path.join(os.tmpdir(), `port-cache-${process.pid}.json`);
  const a = new PortCache(file, { skipPhysics: true }, false);
  const b = new PortCache(file, { skipPhysics: false }, false);
  assert.notEqual(a.optionsKey, b.optionsKey);
});
