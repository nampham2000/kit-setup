'use strict';

// A MeshRenderer slot that references a material embedded in a model file (Unity ModelImporter
// "Import via Material Description" + embedded materials) is not a .mat asset: parsing the FBX as
// YAML only produced a misleading `medium MATERIAL_CONVERSION_FAILED`, and the port silently rendered
// the Cocos builtin-standard model sub-asset (black under a ported Unity light rig) or the default
// material when that FBX was never copied (Screw Out Factory Level_5, 63 slots). The porter must
// report it `high` and keep the sub-asset / default binding so the prefab still imports.
const assert = require('node:assert/strict');
const test = require('node:test');
const createMaterialPorter = require('./material-porter.js');
const { BUILTIN_DEFAULT_MESH_MATERIAL_UUID } = require('./constants.js');

function porter() {
  return createMaterialPorter({
    parseUnityScalar: () => { throw new Error('must not parse a model file as a material'); },
    parseUnityYaml: () => { throw new Error('must not parse a model file as a material'); },
    getField: () => null,
    unityRefGuid: () => '',
    importedUnityAssetPath: () => '',
    resolveCurrentStandaloneMaterialUuid: () => '',
    firstSubMetaRecord: () => null,
    copyUnityAssetToCocos: () => '',
    ensureDirectoryMetas: () => {},
    ensureMaterialAssetMeta: () => ({}),
    libraryJsonPathForUuid: () => '',
  });
}

function reporter() {
  const entries = [];
  const push = severity => (code, source, target, message, detail) => entries.push({ severity, code, source, target, message, detail });
  return { entries, high: push('high'), medium: push('medium'), low: push('low') };
}

const fbxMaterial = { ext: '.fbx', stem: 'lvl_67', path: 'E:/unity/Assets/Models/lvl_67.fbx', relativePath: 'Assets/Models/lvl_67.fbx' };

test('an embedded model material keeps the Cocos model material sub-asset and reports high', () => {
  const { resolveUnityMaterialUuid } = porter();
  const report = reporter();
  const cocosDb = { resolveMaterialByStem: stem => (stem === 'lvl_67' ? 'e325edeb-f61a-4038-8673-6a93e82a1eef@a78d1' : '') };
  const uuid = resolveUnityMaterialUuid(fbxMaterial, {}, null, cocosDb, report, 'Shape_3');
  assert.equal(uuid, 'e325edeb-f61a-4038-8673-6a93e82a1eef@a78d1');
  assert.deepEqual(report.entries.map(e => [e.severity, e.code, e.source, e.target, e.detail]),
    [['high', 'MODEL_EMBEDDED_MATERIAL_UNPORTED', 'Assets/Models/lvl_67.fbx', 'Shape_3', 'e325edeb-f61a-4038-8673-6a93e82a1eef@a78d1']]);
  assert.doesNotMatch(report.entries[0].message, /could not be parsed/);
});

test('an embedded material of a model Cocos never imported falls back to the default material and reports high', () => {
  const { resolveUnityMaterialUuid } = porter();
  const report = reporter();
  const uuid = resolveUnityMaterialUuid({ ...fbxMaterial, stem: 'obj_screw_out' }, {}, null, { resolveMaterialByStem: () => '' }, report, 'obj_screw_out');
  assert.equal(uuid, BUILTIN_DEFAULT_MESH_MATERIAL_UUID);
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].severity, 'high');
  assert.equal(report.entries[0].code, 'MODEL_EMBEDDED_MATERIAL_UNPORTED');
  assert.match(report.entries[0].message, /default material/);
});

test('extension match is case-insensitive and covers the model formats Unity imports', () => {
  const { resolveUnityMaterialUuid } = porter();
  for (const ext of ['.FBX', '.glb', '.obj']) {
    const report = reporter();
    resolveUnityMaterialUuid({ ...fbxMaterial, ext }, {}, null, { resolveMaterialByStem: () => 'u@s' }, report, 'go');
    assert.equal(report.entries[0].code, 'MODEL_EMBEDDED_MATERIAL_UNPORTED', ext);
  }
});
