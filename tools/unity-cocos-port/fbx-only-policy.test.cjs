'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { exportUnityMeshAssetToFbx } = require('./unity-mesh-fbx-exporter');

test('Unity YAML mesh export produces FBX rather than glTF/GLB', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-mesh-fbx-'));
  const source = path.join(dir, 'Triangle.asset');
  const target = path.join(dir, 'Triangle.fbx');
  const floats = Buffer.alloc(3 * 32);
  const vertices = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  for (let i = 0; i < vertices.length; i += 1) {
    vertices[i].forEach((value, j) => floats.writeFloatLE(value, i * 32 + j * 4));
    floats.writeFloatLE(0, i * 32 + 12);
    floats.writeFloatLE(0, i * 32 + 16);
    floats.writeFloatLE(1, i * 32 + 20);
  }
  const indices = Buffer.from([0, 0, 1, 0, 2, 0]);
  fs.writeFileSync(source, `--- !u!43 &4300000\nMesh:\n  m_Name: Triangle\n  m_VertexCount: 3\n  m_Channels:\n  - stream: 0\n    offset: 0\n    format: 0\n    dimension: 3\n  - stream: 0\n    offset: 12\n    format: 0\n    dimension: 3\n  - stream: 0\n    offset: 0\n    format: 0\n    dimension: 0\n  - stream: 0\n    offset: 0\n    format: 0\n    dimension: 0\n  - stream: 0\n    offset: 24\n    format: 0\n    dimension: 2\n  m_DataSize: 96\n  _typelessdata: ${floats.toString('hex')}\n  m_IndexFormat: 0\n  m_IndexBuffer: ${indices.toString('hex')}\n  firstByte: 0\n  indexCount: 3\n`, 'utf8');
  try {
    const result = exportUnityMeshAssetToFbx(source, target);
    assert.equal(result.destFile, target);
    const output = fs.readFileSync(target, 'utf8');
    assert.match(output, /FBXVersion: 7400/);
    assert.match(output, /Geometry::Triangle/);
    assert.equal(fs.existsSync(path.join(dir, 'Triangle.gltf')), false);
    assert.equal(fs.existsSync(path.join(dir, 'Triangle.glb')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
