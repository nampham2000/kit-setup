'use strict';

// A MeshFilter that references an FBX mesh sub-asset directly (a plain GameObject, not a linked model
// prefab) must render with the Unity-to-Cocos model basis. Evidence (Screw Out Factory, Unity
// 6000.3): Level_201's Cube_L1 mesh bounds are x[-1.99, 3.09] z[-1.86, 1.78] in Unity and
// x[-3.09, 1.99] z[-1.86, 1.78] in the Cocos import; with the node conversion (x, y, -z) the renderer
// needs a 180-degree Y basis, otherwise every shape piece turns about its pivot and the level splays.
const assert = require('node:assert/strict');
const test = require('node:test');
const createRendererPorter = require('./unity-cocos-port/renderer-porter');
const { CocosPrefabBuilder } = require('./unity-cocos-port.cjs');

function harness(meshAsset, { builtin = '' } = {}) {
  const calls = { renderers: [], basis: [] };
  const reports = [];
  const porter = createRendererPorter({
    resolveUnityMaterialUuids: () => [],
    resolveUnityMaterialUuid: () => 'material-uuid',
    resolveUnityBuiltinMeshUuid: () => builtin,
    resolveBuiltinPrimitiveMeshUuid: () => '',
    importedUnityAssetPath: () => '',
    copyUnityAssetToCocos: () => '',
    handleMissingModel: () => ({ pendingImport: false, resolved: null }),
    resolveLibraryAssetUuid: () => 'library-mesh',
    recordPendingMeshRepair() {},
    getField: (doc, key) => (key === 'm_Mesh' ? { fileID: '812695599402130866', guid: 'fbx' } : null),
    getNestedList: () => [],
    unityRefGuid: () => (meshAsset ? 'fbx' : ''),
    unityRefFileId: () => '812695599402130866',
  });
  const builder = {
    addMeshBasisNode(nodeId, fileId) { calls.basis.push([nodeId, fileId]); return 99; },
    addMeshRenderer(...args) { calls.renderers.push(args); },
  };
  const reporter = { low: (...a) => reports.push(a), medium: (...a) => reports.push(a), high: (...a) => reports.push(a) };
  const model = { file: 'Level.prefab', componentDocs: new Map([['mf', { classId: 33 }]]) };
  const gameObject = { name: 'Cube_L1', components: ['mf'] };
  const unityDb = { get: () => meshAsset };
  const cocosDb = {
    resolveModelMeshByStem: () => ({ meshUuid: 'mesh-uuid@candy001', source: 'Candy.fbx', fallbackExt: meshAsset && meshAsset.ext }),
    resolveModelMaterialUuidsByStem: () => null,
  };
  porter.emitMeshRenderer(gameObject, 7, 'renderer', {}, model, builder, reporter, {}, unityDb, cocosDb);
  return { calls, reports };
}

test('an FBX mesh referenced by a MeshFilter renders on a basis child, not the authored node', () => {
  const { calls, reports } = harness({ ext: '.fbx', stem: 'Candy_new (fixed pivot)', relativePath: 'Model/Candy.fbx' });
  assert.deepEqual(calls.basis, [[7, 'cmp-mesh-renderer-renderer']]);
  assert.equal(calls.renderers.length, 1);
  assert.equal(calls.renderers[0][0], 99, 'the MeshRenderer must live on the basis child');
  assert.equal(calls.renderers[0][2], 'mesh-uuid@candy001');
  assert.ok(reports.some(r => r[0] === 'MODEL_MESH_FORWARD_AXIS_CORRECTED'));
});

test('built-in primitives and non-model meshes keep the renderer on the authored node', () => {
  const builtin = harness({ ext: '.fbx', stem: 'Cube', relativePath: 'Library/unity default resources' }, { builtin: 'builtin-cube' });
  assert.deepEqual(builtin.calls.basis, []);
  assert.equal(builtin.calls.renderers[0][0], 7);

  const serialized = harness({ ext: '.asset', stem: 'Collider', relativePath: 'ConvexColliders/Cube_12.asset' });
  assert.deepEqual(serialized.calls.basis, []);
  assert.equal(serialized.calls.renderers[0][0], 7);
});

test('the basis child is a 180-degree Y turn with identity position/scale under the authored node', () => {
  const builder = new CocosPrefabBuilder('Level', null, { low() {}, medium() {}, high() {} }, {});
  const root = builder.addNode('Level', null, { localPosition: { x: 0, y: 0, z: 0 } }, 1073741824, true, 'root');
  const shape = builder.addNode('Cube_L1', root, {
    localPosition: { x: 0.16, y: 0, z: -5 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
  }, 128, true, 'shape');
  const screw = builder.addNode('screw', shape, { localPosition: { x: -0.418, y: 0.31, z: -0.365 } }, 64, true, 'screw');
  const basis = builder.addMeshBasisNode(shape, 'cmp-mesh-renderer-shape');
  const node = builder.objects[basis];
  assert.equal(node._name, '__meshBasis');
  assert.equal(node._parent.__id__, shape);
  assert.equal(node._layer, 128, 'the renderer child keeps the authored layer (raycast masks)');
  assert.ok([node._lpos.x, node._lpos.y, node._lpos.z].every(v => Math.abs(v) < 1e-12));
  assert.deepEqual([node._lscale.x, node._lscale.y, node._lscale.z], [1, 1, 1]);
  const q = node._lrot;
  assert.ok(Math.abs(q.x) < 1e-9 && Math.abs(Math.abs(q.y) - 1) < 1e-9 && Math.abs(q.z) < 1e-9 && Math.abs(q.w) < 1e-9);
  assert.ok(Math.abs(Math.abs(node._euler.y) - 180) < 1e-6);
  // The authored node and its children are untouched.
  assert.deepEqual(builder.objects[shape]._lpos, { __type__: 'cc.Vec3', x: 0.16, y: 0, z: 5 });
  assert.deepEqual(builder.objects[shape]._children.map(child => child.__id__), [screw, basis]);
});
