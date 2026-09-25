'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { FBX_BINARY_MAGIC, parseFbxBinary } = require('./lib/fbx-binary.cjs');
const { cocosSlotsForUnitySlots, fbxMaterialLayout, unitySlotIndexForCocosPrimitive } = require('./unity-cocos-port/fbx-submesh-order');
const { collectUnityModelExternalMaterialRemaps } = require('./unity-cocos-port.cjs');
const fixture = require('./unity-cocos-port/fixtures/fbx-submesh-order.json');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx-submesh-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

// Minimal FBX 7400 writer: records with typed properties, uncompressed arrays.
function property(value) {
  if (typeof value === 'bigint') { const raw = Buffer.alloc(9); raw[0] = 76; raw.writeBigInt64LE(value, 1); return raw; }
  if (typeof value === 'string') { const text = Buffer.from(value, 'utf8'); const head = Buffer.alloc(5); head[0] = 83; head.writeUInt32LE(text.length, 1); return Buffer.concat([head, text]); }
  if (Array.isArray(value)) {
    const head = Buffer.alloc(13); head[0] = 105; head.writeUInt32LE(value.length, 1); head.writeUInt32LE(0, 5); head.writeUInt32LE(value.length * 4, 9);
    const data = Buffer.alloc(value.length * 4); value.forEach((v, i) => data.writeInt32LE(v, i * 4));
    return Buffer.concat([head, data]);
  }
  throw new Error(`unsupported ${value}`);
}
function record(name, properties = [], children = []) {
  return { name, properties, children };
}
function encode(node, start) {
  const name = Buffer.from(node.name, 'utf8');
  const props = Buffer.concat(node.properties.map(property));
  let cursor = start + 13 + name.length + props.length;
  const children = node.children.map((child) => { const bytes = encode(child, cursor); cursor += bytes.length; return bytes; });
  const tail = node.children.length ? Buffer.alloc(13) : Buffer.alloc(0);
  const header = Buffer.alloc(13);
  header.writeUInt32LE(cursor + tail.length, 0); header.writeUInt32LE(node.properties.length, 4); header.writeUInt32LE(props.length, 8); header[12] = name.length;
  return Buffer.concat([header, name, props, ...children, tail]);
}
function writeFbx(file, nodes) {
  const version = Buffer.alloc(4); version.writeUInt32LE(7400);
  const chunks = [FBX_BINARY_MAGIC, version];
  let cursor = FBX_BINARY_MAGIC.length + 4;
  for (const node of nodes) { const bytes = encode(node, cursor); chunks.push(bytes); cursor += bytes.length; }
  chunks.push(Buffer.alloc(13), Buffer.alloc(16));
  fs.writeFileSync(file, Buffer.concat(chunks));
}

// A chest-like mesh: index 0 ("01") holds 1 quad, index 1 ("02") holds 2 triangles,
// and the polygon list uses "02" first.
function chestFbx() {
  const file = path.join(temp, 'Chest.fbx');
  const oo = (child, parent) => record('C', ['OO', child, parent]);
  writeFbx(file, [
    record('Objects', [], [
      record('Geometry', [10n, 'Base\u0000\u0001Geometry', 'Mesh'], [
        record('PolygonVertexIndex', [[0, 1, -3, 0, 2, 3, -5, 1, 2, -4]]),
        record('LayerElementMaterial', [0n], [
          record('MappingInformationType', ['ByPolygon']),
          record('Materials', [[1, 0, 1]]),
        ]),
      ]),
      record('Model', [20n, 'Base\u0000\u0001Model', 'Mesh']),
      record('Material', [30n, '01 - Default\u0000\u0001Material', '']),
      record('Material', [31n, '02 - Default\u0000\u0001Material', '']),
    ]),
    record('Connections', [], [oo(10n, 20n), oo(30n, 20n), oo(31n, 20n)]),
  ]);
  return file;
}

test('binary FBX parser reads records and typed arrays', () => {
  const { nodes } = parseFbxBinary(fs.readFileSync(chestFbx()));
  const geometry = nodes.find((node) => node.name === 'Objects').children.find((node) => node.name === 'Geometry');
  assert.deepEqual(geometry.children[0].properties[0], [0, 1, -3, 0, 2, 3, -5, 1, 2, -4]);
  assert.throws(() => parseFbxBinary(Buffer.from('; FBX 7.4.0 project file')), /Not a binary FBX/);
});

test('Cocos primitives follow material index order, Unity sub-meshes first use', () => {
  const file = chestFbx();
  assert.deepEqual(fbxMaterialLayout(file, 'Base'), { cocosPrimitives: ['30', '31'], unitySubmeshes: ['31', '30'] });
  assert.deepEqual(cocosSlotsForUnitySlots(file, 'Base', ['frame', 'panel']), ['panel', 'frame']);
  assert.equal(unitySlotIndexForCocosPrimitive(file, 'Base', 0), 1);
  assert.equal(cocosSlotsForUnitySlots(file, 'Missing', ['a', 'b']), null);
  assert.equal(cocosSlotsForUnitySlots(path.join(temp, 'nope.fbx'), 'Base', ['a', 'b']), null);
});

test('fixture: the rule reproduces Unity and Cocos splits of the measured FBX meshes', () => {
  assert.ok(fixture.meshes.length >= 3);
  for (const mesh of fixture.meshes) {
    // Cocos: one primitive per used index, ascending.
    assert.deepEqual(mesh.cocosPrimitiveTriangles, mesh.trianglesByIndex, `${mesh.model} cocos`);
    // Unity: distinct material objects in first-use order.
    const unity = mesh.firstUseMaterials.map((material) => mesh.materialByIndex
      .reduce((sum, owner, index) => sum + (owner === material ? mesh.trianglesByIndex[index] : 0), 0));
    assert.deepEqual(unity, mesh.unitySubmeshTriangles, `${mesh.model} unity`);
  }
  assert.ok(fixture.meshes.some((mesh) => mesh.unitySubmeshTriangles.length < mesh.cocosPrimitiveTriangles.length), 'repeated material slots must be covered');
});

test('model external material remaps keep 3ds Max names containing #', () => {
  const file = path.join(temp, 'Campfire.FBX');
  fs.writeFileSync(file, 'fbx');
  fs.writeFileSync(`${file}.meta`, [
    'fileFormatVersion: 2',
    'ModelImporter:',
    '  externalObjects:',
    '  - first:',
    '      type: UnityEngine:Material',
    '      assembly: UnityEngine.CoreModule',
    '      name: Material #137',
    '    second: {fileID: 2100000, guid: aaaa, type: 2}',
    '  - first:',
    '      type: UnityEngine:Material',
    '      assembly: UnityEngine.CoreModule',
    '      name: Material #138',
    '    second: {fileID: 2100000, guid: bbbb, type: 2}',
    '  materials:',
    '',
  ].join('\n'));
  const unityDb = { get: (guid) => ({ guid, stem: guid }) };
  const remaps = collectUnityModelExternalMaterialRemaps({ path: file }, unityDb);
  assert.deepEqual(remaps.map((entry) => [entry.name, entry.materialAsset.guid]), [['Material #137', 'aaaa'], ['Material #138', 'bbbb']]);
});
