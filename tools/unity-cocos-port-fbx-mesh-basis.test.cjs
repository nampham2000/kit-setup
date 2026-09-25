'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveFbxMeshPivot,
  fbxMeshCarrierTransform,
  isFbxModelAsset,
  unityMeshBoundsFromObjectMap,
} = require('./unity-cocos-port/fbx-mesh-basis');

// Apply the carrier (Cocos space) to a Cocos mesh-local point: Ry(180) then translate.
function carrierApply(carrier, p) {
  return { x: -p.x + carrier.position.x, y: p.y + carrier.position.y, z: -p.z + carrier.position.z };
}
const mirrorZ = (p) => ({ x: p.x, y: p.y, z: -p.z });
const close = (a, b) => ['x', 'y', 'z'].forEach((k) => assert.ok(Math.abs(a[k] - b[k]) < 1e-3, `${k}: ${a[k]} vs ${b[k]}`));

// Tanks! RockyPath.FBX (Unity-MCP evidence vs Cocos library): pure handedness flip, stones along +Z.
test('pure negX mesh gets Ry(180) and no pivot', () => {
  const pivot = deriveFbxMeshPivot({
    unityBounds: { min: [-4.876, -3.2, 0], max: [3.064, 3.19, 0.063] },
    cocosBounds: { minPosition: { x: -3.064, y: -3.2, z: 0 }, maxPosition: { x: 4.876, y: 3.19, z: 0.063 } },
  });
  assert.equal(pivot.verified, true);
  close(pivot.translation, { x: 0, y: 0, z: 0 });
  const carrier = fbxMeshCarrierTransform(pivot.translation);
  assert.deepEqual(carrier.rotation, { x: 0, y: 1, z: 0, w: 0 });
  // A Unity vertex on top of a stone must stay on top (+Y after the level's -90X) in Cocos: check in mesh space.
  const unityVertex = { x: 1.178, y: 2.179, z: 0.049 };
  const cocosVertex = { x: -unityVertex.x, y: unityVertex.y, z: unityVertex.z };
  close(carrierApply(carrier, cocosVertex), mirrorZ(unityVertex));
});

// Tanks! Concrete.fbx Tarmac and Shell.fbx: Cocos bakes a node pivot into the vertices.
test('baked pivot is recovered from the bounds and cancelled by the carrier', () => {
  const unityBounds = { min: [-0.149, -0.149, -0.065], max: [0.149, 0.149, 0.461] };
  const cocosBounds = { min: [-0.2125, -0.019, 1.553], max: [0.0855, 0.279, 2.079] };
  const pivot = deriveFbxMeshPivot({ unityBounds, cocosBounds });
  assert.equal(pivot.verified, true);
  close(pivot.translation, { x: -0.0635, y: 0.13, z: 1.618 });
  const carrier = fbxMeshCarrierTransform(pivot.translation);
  for (const unityVertex of [{ x: 0.149, y: -0.149, z: 0.461 }, { x: -0.1, y: 0.05, z: -0.065 }]) {
    const cocosVertex = { x: -unityVertex.x + pivot.translation.x, y: unityVertex.y + pivot.translation.y, z: unityVertex.z + pivot.translation.z };
    close(carrierApply(carrier, cocosVertex), mirrorZ(unityVertex));
  }
});

test('missing evidence or disagreeing extents fall back to a zero pivot', () => {
  const cocosBounds = { min: [-1, -1, -1], max: [1, 1, 1] };
  assert.equal(deriveFbxMeshPivot({ cocosBounds }).reason, 'unity-evidence-missing');
  assert.equal(deriveFbxMeshPivot({ unityBounds: cocosBounds }).reason, 'cocos-bounds-missing');
  const rotated = deriveFbxMeshPivot({ unityBounds: { min: [-1, -2, -1], max: [1, 2, 1] }, cocosBounds });
  assert.equal(rotated.verified, false);
  assert.match(rotated.reason, /^extent-mismatch/);
  close(rotated.translation, { x: 0, y: 0, z: 0 });
});

test('Unity mesh bounds are looked up by exact fileID, single mesh or unique name', () => {
  const map = {
    g1: { objects: { 4300000: { type: 'Mesh', name: 'Tarmac', bounds: { min: [0, 0, 0], max: [1, 1, 1] } } } },
    g2: {
      objects: {
        11: { type: 'Mesh', name: 'Object037', bounds: { min: [1, 1, 1], max: [2, 2, 2] } },
        12: { type: 'Mesh', name: 'Box020', bounds: { min: [3, 3, 3], max: [4, 4, 4] } },
        13: { type: 'MeshRenderer', name: 'Box020' },
      },
    },
  };
  assert.deepEqual(unityMeshBoundsFromObjectMap(map, 'g1', {}).max, [1, 1, 1]);
  assert.deepEqual(unityMeshBoundsFromObjectMap(map, 'g2', { fileId: '12' }).min, [3, 3, 3]);
  assert.deepEqual(unityMeshBoundsFromObjectMap(map, 'g2', { meshName: 'Object037.mesh' }).min, [1, 1, 1]);
  assert.equal(unityMeshBoundsFromObjectMap(map, 'g2', { meshName: 'Nope' }), null);
  assert.equal(unityMeshBoundsFromObjectMap(map, 'missing', {}), null);
});

test('only FBX sources get the carrier', () => {
  assert.equal(isFbxModelAsset({ ext: '.fbx' }), true);
  assert.equal(isFbxModelAsset({ path: 'Assets/Models/RockyPath.FBX' }), true);
  assert.equal(isFbxModelAsset({ ext: '.asset' }), false);
  assert.equal(isFbxModelAsset(null), false);
});

test('builder mounts FBX mesh components on one shared carrier child with the evidenced basis', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { CocosPrefabBuilder, fbxMeshOwnerNode } = require('./unity-cocos-port.cjs');
  const cocosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx-basis-'));
  const meshUuid = 'ab12cd34-0000-4000-8000-000000000000@09b47';
  fs.mkdirSync(path.join(cocosRoot, 'library', 'ab'), { recursive: true });
  fs.writeFileSync(path.join(cocosRoot, 'library', 'ab', `${meshUuid}.json`), JSON.stringify({
    __type__: 'cc.Mesh',
    _struct: { minPosition: { x: -2.036, y: -0.016, z: -3.395 }, maxPosition: { x: 4.048, y: 0.025, z: 2.965 } },
  }));
  const reports = [];
  const reporter = { low: (code) => reports.push(code), medium: (code) => reports.push(code), high: (code) => reports.push(code) };
  const options = {
    cocosRoot,
    unityObjectMap: { g: { objects: { 4300000: { type: 'Mesh', name: 'Tarmac', bounds: { min: [-3.042, -0.016, -3.18], max: [3.042, 0.025, 3.18] } } } } },
  };
  const builder = new CocosPrefabBuilder('ConcreteMoon', null, reporter, options);
  const root = builder.addNode('ConcreteMoon', null, null, 1, true, 'node-root');
  const args = { builder, nodeId: root, gameObject: { name: 'ConcreteMoon' }, modelAsset: { ext: '.fbx', guid: 'g', relativePath: 'Concrete.fbx' }, meshUuid, unityMeshFileId: '4300000', seed: '123', reporter, options };
  const carrierId = fbxMeshOwnerNode(args);
  assert.notEqual(carrierId, root);
  const carrier = builder.objects[carrierId];
  assert.equal(carrier._name, 'ConcreteMoon (FBX mesh)');
  assert.equal(carrier._parent.__id__, root);
  assert.deepEqual([carrier._lrot.x, carrier._lrot.y, carrier._lrot.z, carrier._lrot.w], [0, 1, 0, 0]);
  close(carrier._lpos, { x: 1.006, y: 0, z: -0.215 });
  // A MeshCollider on the same mesh reuses the carrier; other meshes or non-FBX sources do not.
  assert.equal(fbxMeshOwnerNode(args), carrierId);
  assert.equal(fbxMeshOwnerNode({ ...args, modelAsset: { ext: '.asset', guid: 'g' } }), root);
  assert.deepEqual(reports, ['FBX_MESH_BASIS_APPLIED']);
  fs.rmSync(cocosRoot, { recursive: true, force: true });
});
