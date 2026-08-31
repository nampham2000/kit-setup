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
