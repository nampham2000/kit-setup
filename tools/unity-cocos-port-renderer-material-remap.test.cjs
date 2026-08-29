'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const createRendererPorter = require('./unity-cocos-port/renderer-porter');

function createHarness() {
  const calls = [];
  const reports = [];
  const porter = createRendererPorter({
    resolveUnityMaterialUuids(assets) {
      return assets.map(asset => `uuid-${asset.stem}`);
    },
    resolveUnityMaterialUuid() { return ''; },
    resolveUnityBuiltinMeshUuid() { return ''; },
    resolveBuiltinPrimitiveMeshUuid() { return ''; },
    importedUnityAssetPath() { return ''; },
    copyUnityAssetToCocos() { return ''; },
    handleMissingModel() { return { pendingImport: false, resolved: null }; },
    resolveLibraryAssetUuid() { return ''; },
    recordPendingMeshRepair() {},
    getField() { return null; },
    getNestedList() { return []; },
    unityRefGuid() { return ''; },
    unityRefFileId() { return ''; },
  });
  return {
    porter,
    calls,
    reports,
    builder: {
      addMeshRenderer(...args) { calls.push(args); },
    },
    reporter: {
      low(...args) { reports.push(args); },
      medium(...args) { reports.push(args); },
    },
  };
}

test('root-flattened FBX uses Unity ModelImporter external material remap', () => {
  const harness = createHarness();
  const material = { stem: 'mat_tray', relativePath: '_Game/3DAssets/Box/mat/mat_tray.mat' };
  const gameObject = {
    fileId: 'root',
    name: 'Tray',
    syntheticModelName: 'Tray',
    syntheticModelAsset: { guid: 'fbx', stem: 'Tray', relativePath: '_Game/3DAssets/Box/Tray.fbx' },
    syntheticModelExternalMaterialRemaps: [{ name: 'Material.002', materialAsset: material }],
  };
  const cocosDb = {
    resolveModelMeshByStem() {
      return {
        meshUuid: 'mesh-tray',
        materialUuids: ['embedded-material'],
        materialNames: ['Material.002.material'],
        source: 'assets/unity_imported/Tray.fbx',
      };
    },
  };

  harness.porter.emitSyntheticModelRenderer(
    gameObject, 7, harness.builder, harness.reporter, {}, {}, cocosDb,
  );

  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0][3], ['uuid-mat_tray']);
  assert.ok(harness.reports.some(entry => entry[0] === 'MODEL_EXTERNAL_MATERIAL_REMAP_WIRED'));
});

test('authored prefab renderer override stays higher priority than ModelImporter remap', () => {
  const harness = createHarness();
  const gameObject = {
    fileId: 'root',
    name: 'Tray',
    syntheticModelName: 'Tray',
    syntheticModelAsset: { guid: 'fbx', stem: 'Tray', relativePath: 'Tray.fbx' },
    syntheticModelMaterialOverrideGroups: [{ materialAssets: [{ stem: 'instance_override' }] }],
    syntheticModelExternalMaterialRemaps: [{ name: 'Material.002', materialAsset: { stem: 'mat_tray' } }],
  };
  const cocosDb = {
    resolveModelMeshByStem() {
      return {
        meshUuid: 'mesh-tray', materialUuids: ['embedded-material'],
        materialNames: ['Material.002.material'], source: 'Tray.fbx',
      };
    },
  };

  harness.porter.emitSyntheticModelRenderer(
    gameObject, 7, harness.builder, harness.reporter, {}, {}, cocosDb,
  );

  assert.deepEqual(harness.calls[0][3], ['uuid-instance_override']);
  assert.equal(harness.reports.some(entry => entry[0] === 'MODEL_EXTERNAL_MATERIAL_REMAP_WIRED'), false);
});
