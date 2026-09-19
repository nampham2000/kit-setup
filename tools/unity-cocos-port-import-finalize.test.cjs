'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { findPendingImporterStates, repairFinalizedPrefabRefs } = require('./unity-cocos-port.cjs');

test('final import repairs stale mesh UUID after AssetDB replaces placeholder; readonly meta and idempotent output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'porter-final-refs-'));
  try {
    const out = path.join(root, 'assets', 'prefabs');
    fs.mkdirSync(out, { recursive: true });
    const meta = path.join(root, 'assets', 'Quad.fbx.meta');
    fs.writeFileSync(meta, JSON.stringify({ uuid: 'model', importer: 'fbx', imported: true,
      subMetas: { actual: { uuid: 'model@actual', importer: 'gltf-mesh', imported: true, name: 'Plane.mesh' } } }));
    const prefab = path.join(out, 'Effect.prefab');
    fs.writeFileSync(prefab, JSON.stringify([{ __type__: 'cc.ParticleSystemRenderer',
      _mesh: { __uuid__: 'model@placeholder', __expectedType__: 'cc.Mesh' } }]));
    const beforeMeta = fs.readFileSync(meta);
    const metaTime = fs.statSync(meta).mtimeMs;
    assert.equal(repairFinalizedPrefabRefs({ cocosRoot: root, out }), 1);
    assert.equal(JSON.parse(fs.readFileSync(prefab))[0]._mesh.__uuid__, 'model@actual');
    const time = fs.statSync(prefab).mtimeMs;
    assert.equal(repairFinalizedPrefabRefs({ cocosRoot: root, out }), 0);
    assert.equal(fs.statSync(prefab).mtimeMs, time);
    assert.deepEqual(fs.readFileSync(meta), beforeMeta);
    assert.equal(fs.statSync(meta).mtimeMs, metaTime);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stale mesh reference never picks an arbitrary mesh from a multi-mesh FBX', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'porter-ambiguous-refs-'));
  try {
    const out = path.join(root, 'assets'); fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, 'Multi.fbx.meta'), JSON.stringify({ uuid: 'model', importer: 'fbx', imported: true,
      subMetas: Object.fromEntries(['one', 'two'].map(id => [id, { uuid: `model@${id}`, importer: 'gltf-mesh', imported: true }])) }));
    const prefab = path.join(out, 'Effect.prefab');
    const bytes = JSON.stringify([{ _mesh: { __uuid__: 'model@stale', __expectedType__: 'cc.Mesh' } }]);
    fs.writeFileSync(prefab, bytes);
    assert.throws(() => repairFinalizedPrefabRefs({ cocosRoot: root, out }), { code: 'COCOS_STALE_SUBASSET_UNRESOLVED' });
    assert.equal(fs.readFileSync(prefab, 'utf8'), bytes);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('port finalizer catches a pending nested texture importer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'porter-import-finalize-'));
  try {
    const asset = path.join(root, 'vfx.png');
    fs.writeFileSync(asset, 'fixture');
    fs.writeFileSync(`${asset}.meta`, JSON.stringify({
      imported: true,
      subMetas: {
        texture: { imported: false, importer: 'texture', uuid: 'pending-texture', subMetas: {} },
      },
    }));
    const pending = findPendingImporterStates(root);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].asset, 'vfx.png');
    assert.equal(pending[0].subPath, 'texture');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('port finalizer accepts fully imported root and sub-assets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'porter-import-finalize-'));
  try {
    const asset = path.join(root, 'mesh.glb');
    fs.writeFileSync(asset, 'fixture');
    fs.writeFileSync(`${asset}.meta`, JSON.stringify({
      imported: true,
      subMetas: { mesh: { imported: true, importer: 'gltf-mesh', subMetas: {} } },
    }));
    assert.deepEqual(findPendingImporterStates(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
