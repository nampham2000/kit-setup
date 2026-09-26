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
});
