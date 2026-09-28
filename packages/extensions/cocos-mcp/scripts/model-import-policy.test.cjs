'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ModelImportPolicy,
  PLAYABLE_FBX_IMPORT_SETTINGS,
  applyPlayableFbxImportSettings,
  hasPlayableFbxImportSettings,
  isFbxModelUrl,
} = require('../dist/model-import-policy.js');

function makeEditor() {
  const assets = [
    { uuid: 'fbx-a', url: 'db://assets/models/a.fbx' },
    { uuid: 'fbx-b', url: 'db://assets/models/B.FBX' },
    { uuid: 'glb', url: 'db://assets/models/excluded.glb' },
  ];
  const byId = new Map(assets.flatMap((asset) => [[asset.uuid, asset], [asset.url, asset]]));
  const metas = new Map(['fbx-a', 'fbx-b'].map((uuid) => [uuid, {
    ver: '2.3.14', importer: 'fbx', imported: true, uuid, files: [], subMetas: {},
    userData: { keepMe: true, meshOptimize: { enable: false } },
  }]));
  const calls = [];
  return {
    editor: {
      Message: {
        async request(packageName, message, ...args) {
          assert.equal(packageName, 'asset-db');
          calls.push([message, ...args]);
          if (message === 'query-ready') return true;
          if (message === 'query-assets') return assets;
          if (message === 'query-asset-info') {
            const asset = byId.get(args[0]);
            return asset ? { ...asset, path: asset.url, isDirectory: false } : null;
          }
          if (message === 'query-asset-meta') return structuredClone(metas.get(args[0]) || null);
          if (message === 'save-asset-meta') {
            metas.set(args[0], JSON.parse(args[1]));
            return { uuid: args[0] };
          }
          throw new Error(`Unexpected Asset DB message: ${message}`);
        },
      },
    },
    metas,
    calls,
  };
}

test('extension policy applies the screenshot FBX importer settings and preserves unrelated metadata', async () => {
  const fixture = makeEditor();
  global.Editor = fixture.editor;
  try {
    const policy = new ModelImportPolicy();
    const first = await policy.enforceAll();
    assert.equal(first.complete, true);
    assert.equal(first.eligible, 2);
    assert.equal(first.updated, 2);
    assert.deepEqual(first.settings, PLAYABLE_FBX_IMPORT_SETTINGS);
    for (const id of ['fbx-a', 'fbx-b']) {
      const meta = fixture.metas.get(id);
      assert.equal(meta.userData.keepMe, true);
      assert.equal(hasPlayableFbxImportSettings(meta), true);
      assert.deepEqual(meta.userData.meshOptimize, PLAYABLE_FBX_IMPORT_SETTINGS.meshOptimize);
      assert.deepEqual(meta.userData.meshSimplify, PLAYABLE_FBX_IMPORT_SETTINGS.meshSimplify);
      assert.deepEqual(meta.userData.meshCluster, PLAYABLE_FBX_IMPORT_SETTINGS.meshCluster);
      assert.deepEqual(meta.userData.meshCompress, PLAYABLE_FBX_IMPORT_SETTINGS.meshCompress);
    }
    const second = await policy.enforceAll();
    assert.equal(second.updated, 0);
    assert.equal(second.unchanged, 2);
  } finally {
    delete global.Editor;
  }
});

test('FBX helpers are case-insensitive and do not mutate source metadata', () => {
  const source = { importer: 'fbx', userData: { custom: 1 } };
  const next = applyPlayableFbxImportSettings(source);
  assert.equal(isFbxModelUrl('db://assets/X.FBX?x=1'), true);
  assert.equal(isFbxModelUrl('db://assets/X.glb'), false);
  assert.equal(source.userData.meshOptimize, undefined);
  assert.equal(next.userData.custom, 1);
  assert.equal(hasPlayableFbxImportSettings(next), true);
});


test('default policy preserves a two-triangle backdrop and repairs destructive legacy simplification', () => {
  const legacy = { importer: 'fbx', uuid: 'map', subMetas: { plane: { uuid: 'map@plane', userData: { triangleCount: 2 } } },
    userData: { meshSimplify: { enable: true, targetRatio: 0.8, errorRate: 1, lockBoundary: false } } };
  const next = applyPlayableFbxImportSettings(legacy);
  assert.equal(next.userData.meshSimplify.targetRatio, 1);
  assert.equal(next.userData.meshOptimize.enable, true);
  assert.equal(next.userData.meshCompress.compress, true);
  assert.deepEqual(next.subMetas, legacy.subMetas);
  assert.equal(next.uuid, legacy.uuid);
  assert.equal(legacy.userData.meshSimplify.targetRatio, 0.8);
  assert.equal(hasPlayableFbxImportSettings(legacy), false);
  assert.equal(hasPlayableFbxImportSettings(next), true);
});

test('models with morph targets keep their source buffers (3.8.8 optimize/compress break morph views)', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { MORPH_FBX_IMPORT_SETTINGS, modelHasMorphTargets } = require('../dist/model-import-policy.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-policy-'));
  const morphJson = path.join(dir, 'beard.json');
  const plainJson = path.join(dir, 'body.json');
  const mesh = (morph) => [{ __type__: 'cc.Mesh', _struct: { vertexBundles: [], primitives: [], morph } }];
  fs.writeFileSync(morphJson, JSON.stringify(mesh({ subMeshMorphs: [{ attributes: ['a_position'], targets: [] }] })));
  fs.writeFileSync(plainJson, JSON.stringify(mesh(null)));
  const info = (files) => ({ subAssets: Object.fromEntries(files.map((file, i) => [String(i), { type: 'cc.Mesh', library: { '.json': file } }])) });
  assert.equal(modelHasMorphTargets(info([plainJson])), false);
  assert.equal(modelHasMorphTargets(info([plainJson, morphJson])), true);
  assert.equal(modelHasMorphTargets({ subAssets: { 0: { type: 'cc.Mesh', library: { '.json': path.join(dir, 'missing.json') } } } }), false);

  const metas = new Map([['chal', { ver: '2.3.14', importer: 'fbx', uuid: 'chal', subMetas: {}, userData: { meshCompress: { enable: true, compress: true } } }]]);
  global.Editor = { Message: { async request(_pkg, message, ...args) {
    if (message === 'query-asset-info') return { uuid: 'chal', url: 'db://assets/Chal_Rig2.fbx', isDirectory: false, ...info([morphJson]) };
    if (message === 'query-asset-meta') return structuredClone(metas.get(args[0]));
    if (message === 'save-asset-meta') { metas.set(args[0], JSON.parse(args[1])); return { uuid: args[0] }; }
    throw new Error(message);
  } } };
  try {
    const policy = new ModelImportPolicy();
    assert.equal((await policy.enforceAsset('chal')).status, 'updated');
    assert.deepEqual(metas.get('chal').userData.meshCompress, { ...MORPH_FBX_IMPORT_SETTINGS.meshCompress });
    assert.deepEqual(metas.get('chal').userData.meshOptimize, { ...MORPH_FBX_IMPORT_SETTINGS.meshOptimize });
    assert.equal(metas.get('chal').userData.meshSimplify.enable, false);
    assert.equal((await policy.enforceAsset('chal')).status, 'unchanged');
    assert.equal(hasPlayableFbxImportSettings(metas.get('chal')), false);
  } finally {
    delete global.Editor;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
