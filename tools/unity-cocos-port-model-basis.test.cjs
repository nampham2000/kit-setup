'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  correctNestedModelForwardAxis,
  mergedModelRootTransform,
  multiplyQuaternion,
  rebaseNestedModelMountedChildTransform,
  transformOverrideFlags,
} = require('./unity-cocos-port.cjs');
const { unityModelImportBasis, unityModelMeshName } = require('./unity-cocos-port/model-import-basis');
const {
  attachModelMeshBasisRuntime,
  removeModelMeshBasis,
  requestModelMeshBasis,
} = require('./unity-cocos-port/model-mesh-basis-binding');

const fixture = require('./unity-cocos-port/fixtures/model-import-basis.json');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'model-basis-'));
}

function writeModel(dir, name, metaBody) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'fbx');
  fs.writeFileSync(`${file}.meta`, `fileFormatVersion: 2\nguid: 0123\nModelImporter:\n${metaBody}`);
  return { path: file, ext: path.extname(name).toLowerCase(), stem: path.basename(name, path.extname(name)), relativePath: `Assets/${name}` };
}

const LEGACY_CHEST = [
  '  serializedVersion: 19',
  '  fileIDToRecycleName:',
  '    100000: //RootNode',
  '    100002: Cylinder001',
  '    4300000: Cylinder001',
  '    4300002: Object001',
  '    4300004: Details',
  '  meshes:',
  '    lODScreenPercentages: []',
  '    globalScale: 2.15',
  '    useFileScale: 1',
  '  humanDescription:',
  '    globalScale: 7',
  '',
].join('\n');

const NAME_TABLE_GLOW = [
  '  serializedVersion: 19300',
  '  internalIDToNameTable:',
  '  - first:',
  '      1: 100000',
  '    second: //RootNode',
  '  - first:',
  '      43: 4300000',
  '    second: RPGFXVerticalGlow',
  '  externalObjects: {}',
  '  meshes:',
  '    globalScale: 1',
  '    preserveHierarchy: 0',
  '    useFileScale: 1',
  '',
].join('\n');

test('fixture: every Cocos FBX vertex is Unity\'s reflected through X and divided by globalScale', () => {
  assert.equal(fixture.meshes.length, 10);
  for (const mesh of fixture.meshes) {
    assert.ok(mesh.maxRelativeError < 1e-6, `${mesh.mesh}: ${mesh.maxRelativeError}`);
    for (const { unity, cocos } of mesh.pairs) {
      const k = mesh.globalScale;
      assert.ok(Math.abs(cocos[0] + unity[0] / k) < 2e-6, `${mesh.mesh} x`);
      assert.ok(Math.abs(cocos[1] - unity[1] / k) < 2e-6, `${mesh.mesh} y`);
      assert.ok(Math.abs(cocos[2] - unity[2] / k) < 2e-6, `${mesh.mesh} z`);
      // The runtime basis diag(-k, k, -k) turns the Cocos vertex into the
      // Z-reflected Unity vertex, which is what converted transforms expect.
      const drawn = [-k * cocos[0], k * cocos[1], -k * cocos[2]];
      assert.ok(Math.abs(drawn[0] - unity[0]) < 5e-6 && Math.abs(drawn[1] - unity[1]) < 5e-6 && Math.abs(drawn[2] + unity[2]) < 5e-6);
    }
  }
  assert.ok(fixture.meshes.some((mesh) => mesh.globalScale !== 1), 'fixture must cover a non-unit globalScale');
});

test('ModelImporter meta: mesh names by file ID from both name tables, basis from the meshes section', () => {
  const dir = tempDir();
  const chest = writeModel(dir, 'RPGFXChest.FBX', LEGACY_CHEST);
  const glow = writeModel(dir, 'RPGFXVerticalGlow.FBX', NAME_TABLE_GLOW);
  assert.equal(unityModelMeshName(chest, '4300002'), 'Object001');
  assert.equal(unityModelMeshName(chest, 4300000), 'Cylinder001');
  assert.equal(unityModelMeshName(chest, '100002'), '');
  assert.equal(unityModelMeshName(glow, '4300000'), 'RPGFXVerticalGlow');
  // humanDescription also has a globalScale; only the meshes section counts.
  assert.deepEqual(unityModelImportBasis(chest), { supported: true, scale: 2.15, preserveHierarchy: false, reasons: [] });
  assert.equal(unityModelImportBasis(glow).scale, 1);
  assert.equal(unityModelImportBasis({ ...chest, ext: '.asset' }), null);
});

test('unmeasured ModelImporter settings are reported instead of guessed', () => {
  const dir = tempDir();
  const raw = writeModel(dir, 'Raw.fbx', '  meshes:\n    globalScale: 1\n    useFileScale: 0\n');
  const baked = writeModel(dir, 'Baked.fbx', '  meshes:\n    globalScale: 1\n    useFileScale: 1\n    bakeAxisConversion: 1\n');
  assert.equal(unityModelImportBasis(raw).supported, false);
  assert.equal(unityModelImportBasis(baked).supported, false);
  const reports = [];
  const builder = { objects: [] };
  const reporter = { high: (...args) => reports.push(args) };
  assert.equal(requestModelMeshBasis(builder, reporter, {}, 1, 2, baked, 'Node'), null);
  assert.equal(reports[0][0], 'UNITY_MODEL_IMPORT_BASIS_UNMEASURED');
  assert.equal(builder.modelMeshBasisRequests, undefined);
});

function fakeBuilder() {
  const objects = [
    { __type__: 'cc.Prefab' },
    { __type__: 'cc.Node', _name: 'Lid', _components: [{ __id__: 2 }] },
    { __type__: 'cc.MeshRenderer', node: { __id__: 1 } },
  ];
  return {
    objects,
    cocosDb: null,
    addComponent(nodeId, type, body, unityComponentId, fileId) {
      const infoId = objects.push({ __type__: 'cc.CompPrefabInfo', fileId }) - 1;
      const id = objects.push({ __type__: type, node: { __id__: nodeId }, __prefab: { __id__: infoId }, ...body }) - 1;
      objects[nodeId]._components.push({ __id__: id });
      return id;
    },
  };
}

test('FBX renderer gets one basis adapter bound to it; a mesh override detaches it', () => {
  const dir = tempDir();
  const chest = writeModel(dir, 'RPGFXChest.FBX', LEGACY_CHEST);
  const cocosRoot = tempDir();
  fs.mkdirSync(path.join(cocosRoot, 'assets/script'), { recursive: true });
  fs.writeFileSync(path.join(cocosRoot, 'assets/script/UnityModelMeshBasis.ts.meta'),
    JSON.stringify({ uuid: '1c2f2d0e-3a4b-4c5d-8e9f-0a1b2c3d4e5f' }));
  const builder = fakeBuilder();
  const lows = [];
  const reporter = { high: () => assert.fail('unexpected high'), low: (...args) => lows.push(args) };
  const options = { cocosRoot };
  assert.equal(requestModelMeshBasis(builder, reporter, options, 1, 2, chest, 'Lid').scale, 2.15);
  attachModelMeshBasisRuntime(builder, reporter, options);
  const basis = builder.objects.find((object) => object.scale === 2.15);
  assert.deepEqual(basis.source, { __id__: 2 });
  assert.equal(builder.objects[1]._components.length, 2);
  assert.equal(lows[0][0], 'UNITY_MODEL_MESH_BASIS_BOUND');
  assert.equal(fs.readFileSync(path.join(cocosRoot, 'assets/script/UnityModelMeshBasis.ts'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'unity-cocos-port/runtime/UnityModelMeshBasis.ts'), 'utf8'));
  assert.equal(removeModelMeshBasis(builder, 2), 1);
  assert.equal(builder.objects[1]._components.length, 1);
});

function near(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

test('merged FBX root: non-overridden fields come from the Cocos node in Unity basis', () => {
  // ARPGDemo06 campfire: the scene overrides position and rotation only; Unity's
  // effective scale 4 is the FBX node's. Cocos keeps that node below an identity root.
  const flags = transformOverrideFlags({
    'm_LocalPosition.x': '8.365086', 'm_LocalPosition.y': '4.949497', 'm_LocalPosition.z': '8.619428',
    'm_LocalRotation.x': '0', 'm_LocalRotation.y': '0', 'm_LocalRotation.z': '0', 'm_LocalRotation.w': '1',
  });
  assert.deepEqual(flags, { position: [true, true, true], rotation: true, scale: [false, false, false] });
  const root = mergedModelRootTransform({
    localPosition: { x: 8.365086, y: 4.949497, z: 8.619428 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
  }, flags, {
    position: { x: 1.2964, y: 0.0418, z: 0.0173 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 4, y: 4, z: 4 },
  });
  assert.deepEqual(root.localPosition, { x: 8.365086, y: 4.949497, z: 8.619428 });
  assert.deepEqual(root.localScale, { x: 4, y: 4, z: 4 });

  // Nothing overridden: the node transform is Unity's reflected through X.
  const bare = mergedModelRootTransform({}, transformOverrideFlags({}), {
    position: { x: 0, y: 0.1657, z: 0.0015 },
    rotation: { x: -0.5, y: -0.5, z: 0.5, w: 0.5 },
    scale: { x: 1, y: 1, z: 1 },
  }, 2.15);
  near(bare.localPosition.y, 0.356255);
  near(bare.localPosition.z, 0.003225);
  assert.deepEqual(bare.localRotation, { x: -0.5, y: 0.5, z: -0.5, w: 0.5 });
});

test('model basis carries globalScale and the mounted-child inverse divides it out', () => {
  const root = {
    localPosition: { x: 1, y: 2, z: 3 },
    localRotation: { x: 0.182574, y: 0.365148, z: -0.182574, w: 0.894427 },
    localScale: { x: 1, y: 2, z: 1 },
  };
  const corrected = correctNestedModelForwardAxis(root, 2.15);
  assert.deepEqual(corrected.localScale, { x: 2.15, y: 4.3, z: 2.15 });
  assert.deepEqual(corrected.localPosition, root.localPosition);
  const child = rebaseNestedModelMountedChildTransform({
    localPosition: { x: 2, y: 3, z: 4 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 2.15, y: 2.15, z: 2.15 },
  }, 2.15);
  near(child.localPosition.x, -2 / 2.15);
  near(child.localPosition.y, 3 / 2.15);
  near(child.localPosition.z, -4 / 2.15);
  assert.deepEqual(child.localScale, { x: 1, y: 1, z: 1 });
  // (root * B) * (B^-1 * child) keeps the authored child rotation.
  const world = multiplyQuaternion(corrected.localRotation, child.localRotation);
  const expected = root.localRotation;
  const same = Math.hypot(world.x - expected.x, world.y - expected.y, world.z - expected.z, world.w - expected.w);
  const negated = Math.hypot(world.x + expected.x, world.y + expected.y, world.z + expected.z, world.w + expected.w);
  assert.ok(Math.min(same, negated) < 1e-6);
});
