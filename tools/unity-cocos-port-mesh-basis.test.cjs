'use strict';

// A MeshFilter that references an FBX mesh sub-asset directly (a plain GameObject, not a linked model
// prefab) must render in Unity's import basis. Evidence (Screw Out Factory, Unity 6000.3): Level_201's
// Cube_L1 mesh bounds are x[-1.99, 3.09] z[-1.86, 1.78] in Unity and x[-3.09, 1.99] z[-1.86, 1.78] in
// the Cocos import; with the node conversion (x, y, -z) the renderer needs diag(-1, 1, -1) (a 180-degree
// Y turn), otherwise every shape piece turns about its pivot and the level splays. BaseBox's
// pack_tray_lid_new (1).fbx uses ModelImporter globalScale 2.5, which Unity bakes into its mesh data
// (boxes rendered 2.5x too small without it).
//
// games-port first fixed this with a `__meshBasis` child node; main's measured UnityModelMeshBasis
// adapter (fixtures/model-import-basis.json, unity-cocos-port-model-basis.test.cjs) re-expresses the
// Cocos mesh in the same basis diag(-k, k, -k) and also covers Mesh-mode particles and linked models.
// These cases keep the Screw Out evidence bound to the surviving mechanism.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const createRendererPorter = require('./unity-cocos-port/renderer-porter');
const { attachModelMeshBasisRuntime } = require('./unity-cocos-port/model-mesh-basis-binding');
const { CocosPrefabBuilder } = require('./unity-cocos-port.cjs');

// Unity 6 ModelImporter metas no longer serialize internalIDToNameTable: the mesh file ID is the
// deterministic xxHash64 id, so the porter must pass it to the Cocos mesh lookup.
function writeModel(dir, name, globalScale) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'fbx');
  fs.writeFileSync(`${file}.meta`, [
    'fileFormatVersion: 2',
    'guid: 0123456789abcdef0123456789abcdef',
    'ModelImporter:',
    '  serializedVersion: 22200',
    '  internalIDToNameTable: []',
    '  meshes:',
    '    lODScreenPercentages: []',
    `    globalScale: ${globalScale}`,
    '    meshCompression: 0',
    '    useFileScale: 1',
    '',
  ].join('\n'));
  return { path: file, ext: path.extname(name).toLowerCase(), stem: path.basename(name, path.extname(name)), relativePath: `Assets/Model/${name}` };
}

function porterFor(meshAsset, { builtin = '', lookups = [] } = {}) {
  return createRendererPorter({
    resolveUnityMaterialUuids: () => [],
    resolveUnityMaterialUuid: () => 'material-uuid',
    resolveUnityBuiltinMeshUuid: () => builtin,
    resolveBuiltinPrimitiveMeshUuid: () => '',
    handleMissingModel: () => ({ pendingImport: false, resolved: null }),
    recordPendingMeshRepair() {},
    getField: (doc, key) => (key === 'm_Mesh' ? { fileID: '812695599402130866', guid: 'fbx' } : null),
    getNestedList: () => [],
    unityRefGuid: () => (meshAsset ? 'fbx' : ''),
    unityRefFileId: () => '812695599402130866',
  });
}

function reporterSpy() {
  const reports = [];
  const add = (severity) => (...args) => reports.push([severity, ...args]);
  return { reports, low: add('low'), medium: add('medium'), high: add('high') };
}

function harness(meshAsset, options = {}) {
  const lookups = [];
  const renderers = [];
  const builder = {
    objects: [],
    addMeshRenderer(...args) { renderers.push(args); return 11; },
  };
  const reporter = reporterSpy();
  const model = { file: 'Level_201.prefab', componentDocs: new Map([['mf', { classId: 33 }]]) };
  const cocosDb = {
    resolveModelMeshByStem: (...args) => { lookups.push(args); return { meshUuid: 'mesh-uuid@candy001', source: 'Candy.fbx', fallbackExt: meshAsset && meshAsset.ext }; },
    resolveModelMaterialUuidsByStem: () => null,
  };
  porterFor(meshAsset, options).emitMeshRenderer({ name: 'Cube_L1', components: ['mf'] }, 7, 'renderer', {}, model, builder,
    reporter, {}, { get: () => meshAsset }, cocosDb);
  return { builder, renderers, lookups, reports: reporter.reports };
}

test('an FBX mesh referenced by a MeshFilter stays on the authored node and requests the Unity basis', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-basis-'));
  const { builder, renderers, lookups, reports } = harness(writeModel(dir, 'Candy_new (fixed pivot).fbx', 1));
  assert.equal(renderers.length, 1);
  assert.equal(renderers[0][0], 7, 'the MeshRenderer lives on the authored node; no basis child is created');
  assert.equal(renderers[0][2], 'mesh-uuid@candy001');
  assert.equal(lookups[0][3], '812695599402130866', 'the Unity mesh file ID reaches the deterministic sub-asset lookup');
  assert.deepEqual(builder.modelMeshBasisRequests.map(({ nodeId, rendererId, scale }) => [nodeId, rendererId, scale]), [[7, 11, 1]]);
  assert.ok(!reports.some(r => r[0] === 'high'), JSON.stringify(reports));
});

test('built-in primitives and serialized Mesh .asset exports need no import basis', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-basis-'));
  const builtin = harness(writeModel(dir, 'Cube.fbx', 1), { builtin: 'builtin-cube' });
  assert.equal(builtin.renderers[0][0], 7);
  assert.equal(builtin.builder.modelMeshBasisRequests, undefined);

  const serialized = harness({ ext: '.asset', stem: 'Collider', relativePath: 'ConvexColliders/Cube_12.asset', path: path.join(dir, 'Cube_12.asset') });
  assert.equal(serialized.renderers[0][0], 7);
  assert.equal(serialized.builder.modelMeshBasisRequests, undefined);
});

test('the basis carries the Unity ModelImporter scale factor baked into Unity mesh data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-basis-'));
  const box = harness(writeModel(dir, 'pack_tray_lid_new (1).fbx', 2.5));
  assert.deepEqual(box.builder.modelMeshBasisRequests.map(request => request.scale), [2.5]);
});

test('the authored node keeps its transform and children; the basis adapter binds the renderer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-basis-'));
  const cocosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-basis-cocos-'));
  fs.mkdirSync(path.join(cocosRoot, 'assets/script'), { recursive: true });
  fs.writeFileSync(path.join(cocosRoot, 'assets/script/UnityModelMeshBasis.ts.meta'),
    JSON.stringify({ uuid: '1c2f2d0e-3a4b-4c5d-8e9f-0a1b2c3d4e5f' }));
  const meshAsset = writeModel(dir, 'pack_tray_lid_new (1).fbx', 2.5);
  const reporter = reporterSpy();
  const builder = new CocosPrefabBuilder('Level', null, reporter, {});
  const root = builder.addNode('Level', null, { localPosition: { x: 0, y: 0, z: 0 } }, 1073741824, true, 'root');
  const shape = builder.addNode('Cube_L1', root, {
    localPosition: { x: 0.16, y: 0, z: -5 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
  }, 128, true, 'shape');
  const screw = builder.addNode('screw', shape, { localPosition: { x: -0.418, y: 0.31, z: -0.365 } }, 64, true, 'screw');
  const model = { file: 'Level_201.prefab', componentDocs: new Map([['mf', { classId: 33 }]]) };
  const cocosDb = { resolveModelMeshByStem: () => ({ meshUuid: 'box-mesh' }), resolveModelMaterialUuidsByStem: () => null };
  porterFor(meshAsset).emitMeshRenderer({ name: 'Cube_L1', components: ['mf'] }, shape, 'renderer', {}, model, builder,
    reporter, { cocosRoot }, { get: () => meshAsset }, cocosDb);
  attachModelMeshBasisRuntime(builder, reporter, { cocosRoot });

  const node = builder.objects[shape];
  assert.deepEqual(node._lpos, { __type__: 'cc.Vec3', x: 0.16, y: 0, z: 5 }, 'the authored node keeps Unity\'s converted transform');
  assert.deepEqual(node._children.map(child => child.__id__), [screw], 'no extra child is inserted under the authored node');
  const components = node._components.map(ref => builder.objects[ref.__id__]);
  const renderer = components.find(component => component.__type__ === 'cc.MeshRenderer');
  assert.ok(renderer, 'the MeshRenderer is on the authored node');
  const basis = components.find(component => component.scale === 2.5);
  assert.ok(basis, 'UnityModelMeshBasis is bound on the same node with the import scale');
  assert.equal(builder.objects[basis.source.__id__], renderer);
  assert.ok(reporter.reports.some(r => r[1] === 'UNITY_MODEL_MESH_BASIS_BOUND'));
});
