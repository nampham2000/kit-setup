'use strict';

// Candy Pop Sort evidence: 41 wall prefabs reference different meshes of one multi-mesh FBX
// (wall_lock/pack_base_map.fbx: Unity meshes Wall_Corner, Wall_Corner_001..016). Cocos imports the
// unnamed FBX geometries as "Scene-<n>.mesh", so the Unity mesh fileID matched no Cocos mesh name
// and the porter silently bound every prefab to Scene-0; WallPiece_Full (Wall_Corner_005, one
// submesh) then drew Scene-0's second primitive with the magenta missing-material. The imported
// Cocos scene prefab keeps the FBX node names that Unity names its meshes after, which is the
// deterministic evidence these cases lock. The Environment chute cubes (Cube_14/15/16) disable their
// MeshRenderer (m_Enabled: 0, collider-only) and must not draw in Cocos.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { unitySubAssetFileId } = require('./unity-file-id');
const { sceneMeshNodes, meshUuidByUnitySceneNode, reportModelMeshResolution } = require('./model-mesh-resolution');
const createRendererPorter = require('./renderer-porter');
const {
  CocosAssetDatabase,
  CocosPrefabBuilder,
  nestedRendererEnabledOverride,
  applyNestedRendererEnabledOverrides,
} = require('../unity-cocos-port.cjs');

const FBX_UUID = '294f480a-a381-491c-95ab-c2c0e602c86d';
// Scene-<n> sub-asset ids and primitive index counts of the real import (library/<uuid>@<id>.json).
const MESHES = [
  { id: '99d6c', counts: [168, 117] },
  { id: '6ec10', counts: [168, 117] },
  { id: '3620d', counts: [168, 117] },
  { id: 'cbffa', counts: [168, 117] },
  { id: '3c0d1', counts: [264, 165] },
  { id: '6745b', counts: [24] },
];
const SCENE_ID = '86c63';

function reporterSpy() {
  const reports = [];
  const add = (severity) => (...args) => reports.push([severity, ...args]);
  return { reports, low: add('low'), medium: add('medium'), high: add('high') };
}

// Cocos project fixture: an imported FBX whose meshes are "Scene-<n>.mesh" and whose scene prefab maps
// FBX nodes Wall_Corner, Wall_Corner_001.. to them. `nodeOrder` permutes which node owns which mesh so
// the test proves node-name evidence, not a Scene-<n> index guess.
function writeCocosProject({ nodeOrder = MESHES.map((_, i) => i), withScene = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-resolution-'));
  const assetDir = path.join(root, 'assets/unity_imported/_Game/3DAssets/wall_lock');
  fs.mkdirSync(assetDir, { recursive: true });
  const subMetas = {};
  MESHES.forEach((mesh, i) => {
    subMetas[mesh.id] = { importer: 'gltf-mesh', uuid: `${FBX_UUID}@${mesh.id}`, name: `Scene-${i}.mesh`, userData: { gltfIndex: i }, displayName: '', imported: true, subMetas: {} };
  });
  if (withScene) subMetas[SCENE_ID] = { importer: 'gltf-scene', uuid: `${FBX_UUID}@${SCENE_ID}`, name: 'pack_base_map.prefab', userData: { gltfIndex: 0 }, imported: true, subMetas: {} };
  fs.writeFileSync(path.join(assetDir, 'pack_base_map.fbx'), 'fbx');
  fs.writeFileSync(path.join(assetDir, 'pack_base_map.fbx.meta'), JSON.stringify({ ver: '2.3.14', importer: 'fbx', imported: true, uuid: FBX_UUID, subMetas }));
  const lib = path.join(root, 'library', FBX_UUID.slice(0, 2));
  fs.mkdirSync(lib, { recursive: true });
  for (const mesh of MESHES) {
    fs.writeFileSync(path.join(lib, `${FBX_UUID}@${mesh.id}.json`), JSON.stringify({
      __type__: 'cc.Mesh', _struct: { primitives: mesh.counts.map((count) => ({ indexView: { count } })) },
    }));
  }
  if (withScene) {
    // [0] prefab asset -> [1] root node -> children (one MeshRenderer each)
    const objects = [{ __type__: 'cc.Prefab', data: { __id__: 1 } }, { __type__: 'cc.Node', _name: 'pack_base_map', _children: [] }];
    nodeOrder.forEach((meshIndex, i) => {
      const nodeId = objects.length;
      const name = i === 0 ? 'Wall_Corner' : `Wall_Corner_${String(i).padStart(3, '0')}`;
      objects.push({ __type__: 'cc.Node', _name: name, _children: [], _components: [{ __id__: nodeId + 1 }] });
      objects.push({ __type__: 'cc.MeshRenderer', node: { __id__: nodeId }, _mesh: { __uuid__: `${FBX_UUID}@${MESHES[meshIndex].id}` } });
      objects[1]._children.push({ __id__: nodeId });
    });
    fs.writeFileSync(path.join(lib, `${FBX_UUID}@${SCENE_ID}.json`), JSON.stringify(objects));
  }
  const db = new CocosAssetDatabase(root);
  db.scan({ readOnly: true });
  return db;
}

test('Unity mesh fileIDs of the Candy wall FBX are the xxHash64 of the FBX node names', () => {
  // tools/candy/oracles/unity-wall-meshes.json (Unity Editor readback)
  assert.equal(unitySubAssetFileId('Mesh', 'Wall_Corner_001', 0), '-8021489006503038821');
  assert.equal(unitySubAssetFileId('Mesh', 'Wall_Corner_004', 0), '-7093301996042833780');
});

test('a Unity mesh fileID resolves through the imported scene node names when Cocos names meshes Scene-<n>', () => {
  const db = writeCocosProject();
  const expected = { Wall_Corner: 0, Wall_Corner_001: 1, Wall_Corner_004: 4, Wall_Corner_005: 5 };
  for (const [unityName, sceneIndex] of Object.entries(expected)) {
    const resolved = db.resolveModelMeshByStem('pack_base_map', 'WallPiece', '.fbx', unitySubAssetFileId('Mesh', unityName, 0));
    assert.equal(resolved.meshUuid, `${FBX_UUID}@${MESHES[sceneIndex].id}`, unityName);
    assert.equal(resolved.meshMatch, 'scene-file-id');
    assert.equal(resolved.meshNodeName, unityName);
    assert.equal(resolved.primitiveCount, MESHES[sceneIndex].counts.length);
  }
});

test('node-name evidence wins over the Scene-<n> index when the FBX node order differs from mesh order', () => {
  // Node i carries mesh nodeOrder[i]: Wall_Corner_005 owns Scene-0, Wall_Corner owns Scene-5.
  const db = writeCocosProject({ nodeOrder: [5, 1, 2, 3, 4, 0] });
  const full = db.resolveModelMeshByStem('pack_base_map', 'WallPiece_Full', '.fbx', unitySubAssetFileId('Mesh', 'Wall_Corner_005', 0));
  assert.equal(full.meshUuid, `${FBX_UUID}@${MESHES[0].id}`);
  const corner = db.resolveModelMeshByStem('pack_base_map', 'WallPiece_Corner', '.fbx', unitySubAssetFileId('Mesh', 'Wall_Corner', 0));
  assert.equal(corner.meshUuid, `${FBX_UUID}@${MESHES[5].id}`);
});

test('an unmatched Unity fileID never falls back to the first mesh and is reported high', () => {
  const db = writeCocosProject();
  const resolved = db.resolveModelMeshByStem('pack_base_map', 'WallPiece_X', '.fbx', unitySubAssetFileId('Mesh', 'Wall_Corner_099', 0));
  assert.equal(resolved.meshUuid, '');
  assert.equal(resolved.meshMatch, 'unresolved');
  assert.equal(resolved.meshCount, MESHES.length);
  const reporter = reporterSpy();
  assert.equal(reportModelMeshResolution(reporter, resolved, 'WallPiece_X.prefab', 'WallPiece_X'), true);
  assert.deepEqual(reporter.reports.map((r) => [r[0], r[1]]), [['high', 'MODEL_MESH_SUBASSET_UNRESOLVED']]);

  // Without the scene prefab there is no node evidence either: still unresolved, not Scene-0.
  const noScene = writeCocosProject({ withScene: false });
  const blind = noScene.resolveModelMeshByStem('pack_base_map', 'WallPiece', '.fbx', unitySubAssetFileId('Mesh', 'Wall_Corner_005', 0));
  assert.equal(blind.meshMatch, 'unresolved');
  assert.equal(blind.meshUuid, '');
});

test('a name-only lookup that lands on the first of several meshes is flagged ambiguous', () => {
  const db = writeCocosProject();
  const resolved = db.resolveModelMeshByStem('pack_base_map', 'SomethingElse', '.fbx');
  assert.equal(resolved.meshMatch, 'first-fallback');
  const reporter = reporterSpy();
  assert.equal(reportModelMeshResolution(reporter, resolved, 'X.prefab', 'X'), true);
  assert.equal(reporter.reports[0][1], 'MODEL_MESH_SUBASSET_AMBIGUOUS');
  // An exact scene node name (legacy fileIDToRecycleName tables) is evidence.
  const byNode = db.resolveModelMeshByStem('pack_base_map', 'Wall_Corner_004', '.fbx');
  assert.equal(byNode.meshMatch, 'scene-name');
  assert.equal(byNode.meshUuid, `${FBX_UUID}@${MESHES[4].id}`);
});

test('scene mesh nodes follow depth-first FBX node order and duplicate names use the Unity index', () => {
  const objects = [
    { __type__: 'cc.Prefab', data: { __id__: 1 } },
    { __type__: 'cc.Node', _name: 'root', _children: [{ __id__: 2 }, { __id__: 4 }] },
    { __type__: 'cc.Node', _name: 'Box', _children: [] },
    { __type__: 'cc.MeshRenderer', node: { __id__: 2 }, _mesh: { __uuid__: 'm@a' } },
    { __type__: 'cc.Node', _name: 'Box', _children: [] },
    { __type__: 'cc.MeshRenderer', node: { __id__: 4 }, _mesh: { __uuid__: 'm@b' } },
  ];
  const nodes = sceneMeshNodes(objects);
  assert.deepEqual(nodes.map((n) => n.meshUuid), ['m@a', 'm@b']);
  assert.equal(meshUuidByUnitySceneNode(nodes, unitySubAssetFileId('Mesh', 'Box', 0)).meshUuid, 'm@a');
  assert.equal(meshUuidByUnitySceneNode(nodes, unitySubAssetFileId('Mesh', 'Box', 1)).meshUuid, 'm@b');
});

function rendererHarness({ enabled = 1, materials = 1, resolved }) {
  const renderers = [];
  const missing = [];
  const fields = { m_Mesh: { fileID: '-1', guid: 'fbx' }, m_Enabled: enabled };
  const porter = createRendererPorter({
    resolveUnityMaterialUuids: () => [],
    resolveUnityMaterialUuid: () => 'material-uuid',
    resolveUnityBuiltinMeshUuid: () => '',
    resolveBuiltinPrimitiveMeshUuid: () => '',
    handleMissingModel: (...args) => { missing.push(args); return { pendingImport: false, resolved: null }; },
    recordPendingMeshRepair() {},
    getField: (doc, key, fallback) => (key in fields ? fields[key] : fallback),
    getNestedList: (doc, key) => (key === 'm_Materials' ? Array.from({ length: materials }, () => ({ guid: 'mat' })) : []),
    unityRefGuid: (ref) => ref?.guid || '',
    unityRefFileId: (ref) => String(ref?.fileID ?? ''),
  });
  const builder = new CocosPrefabBuilder('Env', null, reporterSpy(), {});
  const root = builder.addNode('Env', null, { localPosition: { x: 0, y: 0, z: 0 } }, 1073741824, true, 'root');
  const node = builder.addNode('Cube_14', root, { localPosition: { x: 0, y: 0, z: 0 } }, 1, true, 'cube');
  const reporter = reporterSpy();
  const meshAsset = { ext: '.fbx', stem: 'pack_base_map', relativePath: 'Assets/pack_base_map.fbx', path: '' };
  const cocosDb = { resolveModelMeshByStem: () => resolved, resolveModelMaterialUuidsByStem: () => null };
  const model = { file: 'Environment.prefab', componentDocs: new Map([['mf', { classId: 33 }], ['mat', { classId: 21 }]]) };
  porter.emitMeshRenderer({ name: 'Cube_14', components: ['mf'] }, node, '378542439472746775', {}, model, builder,
    reporter, {}, { get: (guid) => (guid === 'fbx' ? meshAsset : { stem: 'mat', ext: '.mat' }) }, cocosDb);
  const renderer = builder.objects.find((object) => object?.__type__ === 'cc.MeshRenderer');
  return { renderer, reports: reporter.reports, missing };
}

test('a Unity MeshRenderer with m_Enabled: 0 is ported disabled', () => {
  const resolved = { meshUuid: 'mesh@a', meshMatch: 'scene-file-id', primitiveCount: 1, materialUuids: [] };
  const disabled = rendererHarness({ enabled: 0, resolved });
  assert.equal(disabled.renderer._enabled, false);
  const enabled = rendererHarness({ enabled: 1, resolved });
  assert.equal(enabled.renderer._enabled, true);
});

test('the renderer reports an unresolved mesh sub-asset once and does not treat the model as missing', () => {
  const { renderer, reports, missing } = rendererHarness({
    resolved: { meshUuid: '', meshMatch: 'unresolved', meshCount: 17, unityFileId: '-1', source: 'pack_base_map.fbx', materialUuids: [] },
  });
  assert.equal(renderer._mesh, null);
  assert.equal(missing.length, 0, 'the imported model exists; it must not be copied/imported again');
  const highs = reports.filter((r) => r[0] === 'high').map((r) => r[1]);
  assert.deepEqual(highs, ['MODEL_MESH_SUBASSET_UNRESOLVED']);
});

test('a bound mesh with more primitives than Unity material slots is reported high', () => {
  const { reports } = rendererHarness({ materials: 1, resolved: { meshUuid: 'mesh@0', meshMatch: 'name', primitiveCount: 2, materialUuids: [] } });
  assert.ok(reports.some((r) => r[0] === 'high' && r[1] === 'MESH_PRIMITIVES_EXCEED_MATERIAL_SLOTS'), JSON.stringify(reports));
});

test('prefab-instance m_Enabled overrides reach linked and flattened nested renderers', () => {
  const props = { m_Enabled: '0' };
  assert.deepEqual(nestedRendererEnabledOverride({ classId: '23' }, '555', props),
    { localId: 'cmp-mesh-renderer-555', propertyPath: '_enabled', value: false });
  assert.equal(nestedRendererEnabledOverride({ classId: '137' }, '7', { m_Enabled: 1 }).localId, 'cmp-skinned-mesh-renderer-7');
  assert.equal(nestedRendererEnabledOverride({ classId: '212' }, '8', { m_Enabled: 0 }).localId, 'cmp-sprite-renderer-8');
  assert.equal(nestedRendererEnabledOverride({ classId: '23' }, '555', { m_CastShadows: 0 }), null);
  assert.equal(nestedRendererEnabledOverride({ classId: '114' }, '9', props), null);

  const builder = new CocosPrefabBuilder('Nested', null, reporterSpy(), {});
  const node = builder.addNode('Cube_15', null, { localPosition: { x: 0, y: 0, z: 0 } }, 1, true, 'cube');
  builder.addMeshRenderer(node, '555', 'mesh@a', [], 'cmp-mesh-renderer-555', {});
  const nestedPrefab = {
    sourceGuid: 'src',
    model: { componentDocs: new Map([['555', { classId: '23' }]]) },
    overrideInfo: { overridesByTarget: new Map([['src:555', props]]) },
  };
  assert.equal(applyNestedRendererEnabledOverrides(builder, nestedPrefab), 1);
  const renderer = builder.objects.find((object) => object?.__type__ === 'cc.MeshRenderer');
  assert.equal(renderer._enabled, false);
});
