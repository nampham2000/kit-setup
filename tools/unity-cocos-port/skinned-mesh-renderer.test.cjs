'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createRendererPorter = require('./renderer-porter');

// Hovl "Demo Toon VFX 2" hero: an unpacked Character.fbx instance whose
// SkinnedMeshRenderers sit next to the Alpha:Hips bone chain under "Hero".
function hierarchy() {
  const objects = [];
  const node = (name, parent) => {
    const id = objects.push({ __type__: 'cc.Node', _name: name, _children: [], _parent: parent == null ? null : { __id__: parent } }) - 1;
    if (parent != null) objects[parent]._children.push({ __id__: id });
    return id;
  };
  const scene = node('Scene');
  const hero = node('Hero', scene);
  const hips = node('Alpha:Hips', hero);
  node('Alpha:Spine', hips);
  const geo = node('Alpha_HighTorsoGeo', hero);
  return { objects, hero, geo };
}

function run(skin, extra = {}) {
  const { objects, hero, geo } = hierarchy();
  const added = [], codes = [];
  const builder = { objects, addSkinnedMeshRenderer: (...args) => added.push(args) };
  const reporter = Object.fromEntries(['high', 'medium', 'low'].map((level) => [level, (code) => codes.push(code)]));
  const meshAsset = { ext: '.fbx', stem: 'Character', relativePath: 'Assets/Character.fbx' };
  const porter = createRendererPorter({
    getField: (doc, key, fallback) => doc[key] ?? fallback,
    getNestedList: (doc, key) => doc[key] || [],
    unityRefGuid: (ref) => ref?.guid || '',
    unityRefFileId: (ref) => ref?.fileID || '',
    resolveUnityMaterialUuid: () => 'gray-material',
    handleMissingModel: () => ({ resolved: null }),
    ...extra,
  });
  const cocosDb = {
    resolveModelMeshByStem: () => ({ meshUuid: 'fbx@torso', materialUuids: ['fbx@mat'] }),
    resolveModelSkinByMesh: () => skin,
  };
  const unityDb = { get: (guid) => (guid === 'material' ? {} : meshAsset) };
  porter.emitSkinnedMeshRenderer({ name: 'Alpha_HighTorsoGeo' }, geo, '137',
    { m_Mesh: { guid: 'mesh', fileID: 4300000 }, m_Materials: [{ guid: 'material' }] }, { file: 'scene' }, builder, reporter, {}, unityDb, cocosDb);
  return { added, codes, hero };
}

test('skinning root is the ancestor that resolves every joint path', () => {
  const { added, codes, hero } = run({ skeletonUuid: 'fbx@skeleton', joints: ['Alpha:Hips', 'Alpha:Hips/Alpha:Spine'] });
  assert.deepEqual(codes, ['SKINNED_MESH_BOUND']);
  const [, , meshUuid, materials, skeletonUuid, skinningRoot] = added[0];
  assert.deepEqual([meshUuid, materials, skeletonUuid, skinningRoot], ['fbx@torso', ['gray-material'], 'fbx@skeleton', hero]);
});

test('a bone hierarchy that differs from the model is reported, not bound', () => {
  const { added, codes } = run({ skeletonUuid: 'fbx@skeleton', joints: ['Alpha:Hips/Alpha:Neck'] });
  assert.equal(added.length, 0);
  assert.deepEqual(codes, ['SKINNED_MESH_ROOT_UNRESOLVED']);
  assert.deepEqual(run(null).codes, ['SKINNED_MESH_SKELETON_UNRESOLVED']);
});
