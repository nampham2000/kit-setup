'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rebaseSkinnedSkeleton, fbxBoneLocal } = require('./fbx-skeleton-basis');
const createRendererPorter = require('./renderer-porter');

// Rigid transforms as { p: [x, y, z], q: [x, y, z, w] }.
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qrot = (q, v) => { const r = qmul(qmul(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]); return r.slice(0, 3); };
const compose = (a, b) => ({ p: qrot(a.q, b.p).map((v, i) => v + a.p[i]), q: qmul(a.q, b.q) });
const inverse = (a) => { const q = [-a.q[0], -a.q[1], -a.q[2], a.q[3]]; return { p: qrot(q, a.p).map((v) => -v), q }; };
const norm = (q) => { const l = Math.hypot(...q); return q.map((v) => v / l); };

// FBX-frame bone locals of a small asymmetric chain (Cocos imports these; bind poses come from them).
const FBX = {
  'Alpha:Hips': { p: [0.1, 0.9, -0.05], q: norm([0.1, -0.4, 0.05, 0.9]) },
  'Alpha:Hips/Alpha:LeftArm': { p: [0.12, -0.01, -0.02], q: norm([0.03, 0.09, 0.4, 0.9]) },
  'Alpha:Hips/Alpha:LeftArm/Alpha:LeftHand': { p: [0.28, 0.0, 0.0], q: norm([-0.05, 0.09, -0.08, 0.99]) },
};
// Unity imports the FBX with X negated: T_u = F * T_fbx * F; the porter then mirrors Z: T_s = S * T_u * S.
const toUnity = ({ p, q }) => ({ p: [-p[0], p[1], p[2]], q: [q[0], -q[1], -q[2], q[3]] });
const toScene = ({ p, q }) => ({ p: [p[0], p[1], -p[2]], q: [-q[0], -q[1], q[2], q[3]] });

function prefab() {
  const objects = [];
  const node = (name, parent, t) => {
    const id = objects.push({ __type__: 'cc.Node', _name: name, _children: [], _parent: parent == null ? null : { __id__: parent },
      _lpos: t ? { x: t.p[0], y: t.p[1], z: t.p[2] } : { x: 0, y: 0, z: 0 },
      _lrot: t ? { x: t.q[0], y: t.q[1], z: t.q[2], w: t.q[3] } : { x: 0, y: 0, z: 0, w: 1 }, _lscale: { x: 1, y: 1, z: 1 }, _components: [] }) - 1;
    if (parent != null) objects[parent]._children.push({ __id__: id });
    return id;
  };
  const hero = node('Hero', null, { p: [2, 0, -3], q: norm([0, 0.3, 0, 0.95]) });
  const ids = {};
  for (const [path, local] of Object.entries(FBX)) {
    const parentPath = path.split('/').slice(0, -1).join('/');
    ids[path] = node(path.split('/').pop(), parentPath ? ids[parentPath] : hero, toScene(toUnity(local)));
  }
  const geo = node('Alpha_HighLimbsGeo', hero, toScene(toUnity({ p: [0, 0, 0], q: [0, 0, 0, 1] })));
  // A Unity-authored attachment (effect socket) under the hand, rotated and offset in scene space.
  const socket = node('Socket', ids['Alpha:Hips/Alpha:LeftArm/Alpha:LeftHand'], { p: [0.05, 0.02, 0.1], q: norm([0.2, 0.1, 0, 0.97]) });
  return { objects, hero, ids, geo, socket };
}

const local = (node) => ({ p: [node._lpos.x, node._lpos.y, node._lpos.z], q: [node._lrot.x, node._lrot.y, node._lrot.z, node._lrot.w] });
function world(objects, id) {
  let t = local(objects[id]);
  for (let parent = objects[id]._parent?.__id__; Number.isInteger(parent); parent = objects[parent]._parent?.__id__) t = compose(local(objects[parent]), t);
  return t;
}
const close = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const sameRotation = (a, b) => close(a, b, 1e-9) || close(a, b.map((v) => -v), 1e-9);

test('rebased skeleton skins coherently: W(joint) * bindpose = root * Ry(180) for every joint', () => {
  const { objects, hero, ids, geo } = prefab();
  const heroWorld = local(objects[hero]);
  const fbxWorld = (path) => path.split('/').reduce((acc, _, i, all) => compose(acc, FBX[all.slice(0, i + 1).join('/')]), { p: [0, 0, 0], q: [0, 0, 0, 1] });
  const skin = (path) => compose(world(objects, ids[path]), inverse(fbxWorld(path)));
  // Before: the scene conversion leaves a different skinning matrix per joint (split mesh).
  assert.ok(!close(skin('Alpha:Hips').p, skin('Alpha:Hips/Alpha:LeftArm/Alpha:LeftHand').p, 1e-4));
  const result = rebaseSkinnedSkeleton(objects, hero, [...Object.values(ids), geo]);
  assert.deepEqual(result, { joints: 4, attachments: 1 });
  const expected = compose(heroWorld, { p: [0, 0, 0], q: [0, 1, 0, 0] });
  for (const path of Object.keys(FBX)) {
    const s = skin(path);
    assert.ok(close(s.p, expected.p), `${path} position ${s.p}`);
    assert.ok(sameRotation(s.q, expected.q), `${path} rotation ${s.q}`);
  }
});

test('attachments keep their world transform and _euler follows _lrot', () => {
  const { objects, hero, ids, geo, socket } = prefab();
  const before = world(objects, socket);
  rebaseSkinnedSkeleton(objects, hero, [...Object.values(ids), geo]);
  const after = world(objects, socket);
  assert.ok(close(before.p, after.p, 1e-9));
  assert.ok(sameRotation(before.q, after.q));
  assert.equal(objects[hero]._euler.y.toFixed(3), String((2 * Math.atan2(0.3, 0.95) * 180 / Math.PI + 180 - 360).toFixed(3)));
});

test('fbxBoneLocal converts Unity bone data the same way the skeleton was rebased', () => {
  for (const t of Object.values(FBX)) {
    const unity = toUnity(t);
    const converted = fbxBoneLocal(unity.p, unity.q);
    assert.ok(close(converted.position, t.p));
    assert.ok(close(converted.rotation, t.q));
  }
});

test('the porter rebases each skinning root once, over joints, joint prefixes and renderer nodes', () => {
  const { objects, hero, ids, geo } = prefab();
  objects[hero]._components = [];
  const builder = { objects, addSkinnedMeshRenderer: (nodeId, componentId, mesh, mats, skel, root) => {
    objects.push({ __type__: 'cc.SkinnedMeshRenderer', node: { __id__: nodeId }, _skinningRoot: { __id__: root } });
  }, addComponent: () => {} };
  const codes = [];
  const reporter = Object.fromEntries(['high', 'medium', 'low'].map((level) => [level, (code) => codes.push(code)]));
  const porter = createRendererPorter({
    getField: (doc, key, fallback) => doc[key] ?? fallback,
    getNestedList: (doc, key) => doc[key] || [],
    unityRefGuid: (ref) => ref?.guid || '',
    unityRefFileId: () => '',
    resolveUnityMaterialUuid: () => 'material',
    handleMissingModel: () => ({ resolved: null }),
  });
  const cocosDb = {
    resolveModelMeshByStem: () => ({ meshUuid: 'fbx@limbs', materialUuids: ['fbx@mat'] }),
    resolveModelSkinByMesh: () => ({ skeletonUuid: 'fbx@skeleton', joints: ['Alpha:Hips/Alpha:LeftArm/Alpha:LeftHand'] }),
  };
  const unityDb = { get: (guid) => ({ mesh: { ext: '.fbx', stem: 'Character', relativePath: 'Assets/Character.fbx' } })[guid] };
  porter.emitSkinnedMeshRenderer({ name: 'Alpha_HighLimbsGeo' }, geo, '137', { m_Mesh: { guid: 'mesh' }, m_Materials: [] }, { file: 'scene' }, builder, reporter, {}, unityDb, cocosDb);
  const hipsBefore = { ...objects[ids['Alpha:Hips']]._lpos };
  porter.attachRealtimeSkinning(builder, reporter);
  porter.attachRealtimeSkinning(builder, reporter);
  assert.deepEqual([...builder.fbxSkeletonNodes.get(hero)].sort(), [...Object.values(ids), geo].sort());
  assert.deepEqual(objects[ids['Alpha:Hips']]._lpos, { __type__: 'cc.Vec3', x: -hipsBefore.x, y: hipsBefore.y, z: -hipsBefore.z });
  assert.equal(codes.filter((code) => code === 'SKINNED_SKELETON_FBX_FRAME').length, 1);
});
