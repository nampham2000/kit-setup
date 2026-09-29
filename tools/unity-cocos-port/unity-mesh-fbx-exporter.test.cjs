'use strict';

// Unity Mesh .asset -> ASCII FBX must import in Cocos. Screw Out Factory: 61 exported meshes imported
// as empty scenes because Definitions used single-line `ObjectType: "Model" { Count: 1 }` blocks,
// which the FBX SDK ASCII reader skips (no object definitions -> every Geometry/Model dropped).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { writeUnityMeshAssetAsFbx } = require('./unity-mesh-fbx-exporter.js');

const quad = {
  meshName: 'Quad',
  positions: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
  normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]],
  uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  indices: [0, 1, 2, 0, 2, 3],
};

function writeQuad() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-mesh-fbx-'));
  const file = path.join(dir, 'Quad.fbx');
  writeUnityMeshAssetAsFbx(quad, file);
  return { dir, file, text: fs.readFileSync(file, 'utf8') };
}

test('every FBX block opens and closes on its own lines', () => {
  const { text } = writeQuad();
  assert.doesNotMatch(text, /\{[^\n{}]*\S[^\n{}]*\}/, 'single-line { ... } block');
  assert.match(text, /ObjectType: "Geometry" \{\r?\n\s+Count: 1\r?\n\s+\}/);
  assert.match(text, /ObjectType: "Model" \{\r?\n\s+Count: 1\r?\n\s+\}/);
});

function findConverter() {
  const roots = [
    process.env.COCOS_FBX_GLTF_CONV,
    'C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/@cocos/fbx-gltf-conv/bin/win32/FBX-glTF-conv.exe',
  ].filter(Boolean);
  return roots.find(file => fs.existsSync(file)) || null;
}

test('the FBX holds the Unity mesh in the ported (Z-reflected) frame with front faces kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-mesh-fbx-'));
  const file = path.join(dir, 'Tray.fbx');
  // Unity: a triangle 2 m in front of its pivot (+Z), clockwise from +Y, normal +Y.
  writeUnityMeshAssetAsFbx({
    meshName: 'Tray', positions: [[0, 0, 2], [1, 0, 3], [1, 0, 2]], normals: [[0, 1, 0.5], [0, 1, 0.5], [0, 1, 0.5]],
    uvs: [[0, 0], [1, 1], [1, 0]], indices: [0, 1, 2],
  }, file);
  const text = fs.readFileSync(file, 'utf8');
  const array = (label) => text.match(new RegExp(`${label}: \\*\\d+ \\{\\s*a: ([^\\n]+)`))[1].split(',').map(Number);
  assert.deepEqual(array('Vertices'), [0, 0, -2, 1, 0, -3, 1, 0, -2]);
  assert.deepEqual(array('Normals'), [0, 1, -0.5, 0, 1, -0.5, 0, 1, -0.5]);
  assert.deepEqual(array('PolygonVertexIndex'), [0, 2, -2]);
  // Counter-clockwise seen from +Y in the right-handed frame: the face still points up.
  const v = array('Vertices');
  const [a, b, c] = [0, 2, 1].map(i => v.slice(i * 3, i * 3 + 3));
  const cross = (u, w) => [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const n = cross(b.map((x, i) => x - a[i]), c.map((x, i) => x - a[i]));
  assert.ok(n[1] > 0, `face normal ${n}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Cocos FBX-glTF-conv imports the exported mesh (skipped without a local Cocos install)', (t) => {
  const converter = findConverter();
  if (!converter) { t.skip('FBX-glTF-conv not installed'); return; }
  const { dir, file } = writeQuad();
  const out = path.join(dir, 'out.gltf');
  const result = spawnSync(converter, [file, '--out', out], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
  const gltf = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal((gltf.nodes || []).length, 1);
  assert.deepEqual((gltf.meshes || []).map(mesh => mesh.name), ['Quad']);
  // Unity mesh data is in metres. With UnitScaleFactor 1 (centimetres) the converter divided every
  // vertex by 100 (Candy Pop Sort funnel bumpers and board corners rendered 1/100 size).
  const position = gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION];
  const extent = Math.max(...position.max.map((v, i) => v - position.min[i]));
  const scale = (gltf.nodes[0].scale || [1, 1, 1]).map(Math.abs);
  assert.ok(Math.abs(extent * Math.max(...scale) - 1) < 1e-4, `quad extent ${extent} x node scale ${scale}`);
});

// Meshes extracted from a built player (m_MeshCompression > 0, as in ripped "HijackSource" folders)
// keep an empty vertex stream and store PackedBitVectors in m_CompressedMesh. Candy Pop Sort's
// funnel Bumper and Board_Corner failed with UNITY_MESH_ASSET_FBX_EXTRACT_FAILED before this path.
function packBits(values, bitSize) {
  const bytes = [];
  let bitPos = 0;
  let acc = 0;
  let accBits = 0;
  for (const value of values) {
    for (let b = 0; b < bitSize; b += 1) {
      acc |= ((value >> b) & 1) << accBits;
      accBits += 1;
      bitPos += 1;
      if (accBits === 8) { bytes.push(acc); acc = 0; accBits = 0; }
    }
  }
  if (accBits) bytes.push(acc);
  return Buffer.from(bytes).toString('hex');
}

function packFloats(values, bitSize, start, range) {
  const max = (2 ** bitSize) - 1;
  return packBits(values.map(v => Math.round(((v - start) / range) * max)), bitSize);
}

test('m_CompressedMesh (CRLF YAML) decodes positions, UVs, normals and triangles', () => {
  const { parseUnityMeshAsset } = require('./unity-mesh-fbx-exporter.js');
  const positions = [[-1, 0, 0], [1, 0, 0], [1, 2, 0], [-1, 2, 0]];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const normals = [[0, 0, -1], [0, 0, -1], [0.6, 0, 0.8], [0, 0, 1]];
  const indices = [0, 1, 2, 0, 2, 3];
  const vector = (name, numItems, bitSize, data, start, range) => [
    `    ${name}:`, `      m_NumItems: ${numItems}`,
    ...(range === undefined ? [] : [`      m_Range: ${range}`, `      m_Start: ${start}`]),
    `      m_Data: ${data}`, `      m_BitSize: ${bitSize}`,
  ];
  const yaml = [
    '%YAML 1.1', '--- !u!43 &4300000', 'Mesh:', '  m_Name: Ramp', '  m_MeshCompression: 1',
    '  m_VertexData:', '    m_VertexCount: 0', '    m_DataSize: 0', '    _typelessdata:',
    '  m_CompressedMesh:',
    ...vector('m_Vertices', 12, 20, packFloats(positions.flat(), 20, -1, 3), -1, 3),
    ...vector('m_UV', 8, 16, packFloats(uvs.flat(), 16, 0, 1), 0, 1),
    ...vector('m_Normals', 8, 10, packFloats(normals.map(n => [n[0], n[1]]).flat(), 10, -1, 2), -1, 2),
    ...vector('m_NormalSigns', 4, 1, packBits(normals.map(n => (n[2] >= 0 ? 1 : 0)), 1)),
    ...vector('m_Triangles', 6, 3, packBits(indices, 3)),
    '    m_UVInfo: 5',
    '  m_LocalAABB:', '    m_Center: {x: 0, y: 1, z: 0}',
  ].join('\r\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-compressed-mesh-'));
  const file = path.join(dir, 'Ramp.asset');
  fs.writeFileSync(file, `${yaml}\r\n`);
  const mesh = parseUnityMeshAsset(file);
  assert.ok(mesh, 'compressed mesh parsed');
  assert.equal(mesh.meshName, 'Ramp');
  assert.deepEqual(mesh.indices, indices);
  mesh.positions.forEach((p, i) => p.forEach((v, a) => assert.ok(Math.abs(v - positions[i][a]) < 1e-5, `position ${i}.${a}`)));
  mesh.uvs.forEach((p, i) => p.forEach((v, a) => assert.ok(Math.abs(v - uvs[i][a]) < 1e-4, `uv ${i}.${a}`)));
  mesh.normals.forEach((n, i) => n.forEach((v, a) => assert.ok(Math.abs(v - normals[i][a]) < 5e-3, `normal ${i}.${a}`)));
  fs.rmSync(dir, { recursive: true, force: true });
});

// Blast Shooter's conveyor trays store normals as Float16 x4 ("format: 1, dimension: 52" - the dimension
// byte carries flags above its low nibble). A Float32-only reader exported every normal as (0, 0, 1).
test('Float16 normals (flagged dimension) are decoded from the vertex stream', () => {
  const { parseUnityMeshAsset } = require('./unity-mesh-fbx-exporter.js');
  const half = (v) => { const b = Buffer.alloc(2); const s = v < 0 ? 0x8000 : 0; const a = Math.abs(v);
    if (a === 0) { b.writeUInt16LE(s); return b; }
    const e = Math.floor(Math.log2(a)); b.writeUInt16LE(s | ((e + 15) << 10) | Math.round((a / 2 ** e - 1) * 1024)); return b; };
  const vertex = (p, n) => { const f = Buffer.alloc(12); p.forEach((v, i) => f.writeFloatLE(v, i * 4)); return Buffer.concat([f, ...n.map(half)]); };
  const data = Buffer.concat([vertex([0, 0, 0], [0, 1, 0, 0]), vertex([1, 0, 0], [0, 1, 0, 0]), vertex([0, 0, 1], [0, -0.5, 0, 0])]);
  const channel = (offset, format, dimension) => [`    - stream: 0`, `      offset: ${offset}`, `      format: ${format}`, `      dimension: ${dimension}`];
  const yaml = ['%YAML 1.1', '--- !u!43 &4300000', 'Mesh:', '  m_Name: Tray', '  m_MeshCompression: 0', '  m_IndexFormat: 0',
    '  m_SubMeshes:', '  - firstByte: 0', '    indexCount: 3', '  m_IndexBuffer: 000001000200', '  m_VertexData:', '    m_VertexCount: 3',
    '    m_Channels:', ...channel(0, 0, 3), ...channel(12, 1, 52), ...Array.from({ length: 12 }, () => channel(0, 0, 0)).flat(),
    `    m_DataSize: ${data.length}`, `    _typelessdata: ${data.toString('hex')}`, ''].join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-mesh-half-'));
  const file = path.join(dir, 'Tray.asset');
  fs.writeFileSync(file, yaml);
  const mesh = parseUnityMeshAsset(file);
  assert.deepEqual(mesh.positions, [[0, 0, 0], [1, 0, 0], [0, 0, 1]]);
  assert.deepEqual(mesh.normals, [[0, 1, 0], [0, 1, 0], [0, -0.5, 0]]);
  fs.rmSync(dir, { recursive: true, force: true });
});
