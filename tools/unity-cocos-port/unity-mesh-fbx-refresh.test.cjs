'use strict';

// A Unity Mesh .asset exported by an earlier port resolves as an existing Cocos FBX, so the
// "missing model" export never ran again and exporter fixes never reached it. Candy Pop Sort kept
// Board_Corner/Bumper FBX files with UnitScaleFactor 1 (1/100 size) after the exporter moved to
// 100: the funnel bumpers and board corner fillers vanished and the dark floor showed through.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const createAssetImportPorter = require('./asset-import-porter');
const { exportUnityMeshAssetToFbx } = require('./unity-mesh-fbx-exporter');

function triangleAsset(file) {
  const floats = Buffer.alloc(3 * 32);
  [[0, 0, 0], [1, 0, 0], [0, 1, 0]].forEach((v, i) => {
    v.forEach((value, j) => floats.writeFloatLE(value, i * 32 + j * 4));
    floats.writeFloatLE(1, i * 32 + 20);
  });
  const indices = Buffer.from([0, 0, 1, 0, 2, 0]);
  const channel = (offset, dimension) => `  - stream: 0\n    offset: ${offset}\n    format: 0\n    dimension: ${dimension}\n`;
  fs.writeFileSync(file, `--- !u!43 &4300000\nMesh:\n  m_Name: Triangle\n  m_VertexCount: 3\n  m_Channels:\n${channel(0, 3)}${channel(12, 3)}${channel(0, 0)}${channel(0, 0)}${channel(24, 2)}  m_DataSize: 96\n  _typelessdata: ${floats.toString('hex')}\n  m_IndexFormat: 0\n  m_IndexBuffer: ${indices.toString('hex')}\n  firstByte: 0\n  indexCount: 3\n`, 'utf8');
}

function reporter() {
  const rows = [];
  return { rows, add: (severity, code) => rows.push({ severity, code }), low: (code) => rows.push({ severity: 'low', code }) };
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-mesh-refresh-'));
  const source = path.join(dir, 'unity', 'Assets', 'Mesh', 'Triangle.asset');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  triangleAsset(source);
  const cocosRoot = path.join(dir, 'cocos');
  const dest = path.join(cocosRoot, 'assets', 'unity_imported', 'Mesh', 'Triangle.fbx');
  const meshAsset = { ext: '.asset', path: source, relativePath: 'Mesh/Triangle.asset', stem: 'Triangle' };
  const porter = createAssetImportPorter({ ensureDirectoryMetas() {}, ensurePreparedAssetMeta() {}, recoverModelMetaFromLibrary() {}, waitForImportedModelAsset() { return null; } });
  return { dir, dest, meshAsset, porter, cocosRoot };
}

test('exporter leaves identical bytes untouched and reports changes', () => {
  const { dir, dest, meshAsset } = fixture();
  try {
    assert.equal(exportUnityMeshAssetToFbx(meshAsset.path, dest).changed, true);
    const mtime = fs.statSync(dest).mtimeMs;
    assert.equal(exportUnityMeshAssetToFbx(meshAsset.path, dest).changed, false);
    assert.equal(fs.statSync(dest).mtimeMs, mtime);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a stale earlier export is rewritten on the next port, once per run, and never created', () => {
  const { dir, dest, meshAsset, porter, cocosRoot } = fixture();
  try {
    const options = { cocosRoot };
    // Nothing exported yet: refresh must not create the file (handleMissingModel owns that path).
    assert.equal(porter.refreshExportedUnityMesh(meshAsset, reporter(), options), false);
    assert.equal(fs.existsSync(dest), false);

    exportUnityMeshAssetToFbx(meshAsset.path, dest);
    const current = fs.readFileSync(dest, 'utf8');
    // Simulate the pre-fix export (centimetre unit scale) left on disk by an earlier port.
    fs.writeFileSync(dest, current.replace('"UnitScaleFactor", "double", "Number", "",100', '"UnitScaleFactor", "double", "Number", "",1'));
    assert.notEqual(fs.readFileSync(dest, 'utf8'), current);

    const rep = reporter();
    assert.equal(porter.refreshExportedUnityMesh(meshAsset, rep, options), true);
    assert.equal(fs.readFileSync(dest, 'utf8'), current);
    assert.deepEqual(rep.rows.map(r => r.code), ['UNITY_MESH_ASSET_FBX_REFRESHED']);
    // Memoized for this run; a fresh run finds it identical.
    assert.equal(porter.refreshExportedUnityMesh(meshAsset, reporter(), options), true);
    assert.equal(porter.refreshExportedUnityMesh(meshAsset, reporter(), { cocosRoot }), false);
    // Dry runs and non-.asset meshes are never touched.
    assert.equal(porter.refreshExportedUnityMesh(meshAsset, reporter(), { cocosRoot, dryRun: true }), false);
    assert.equal(porter.refreshExportedUnityMesh({ ...meshAsset, ext: '.fbx' }, reporter(), { cocosRoot }), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
