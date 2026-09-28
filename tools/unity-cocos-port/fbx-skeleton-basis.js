'use strict';

// Skeleton frame of an unpacked Unity model instance (scene objects of an FBX, no linked model prefab).
//
// Unity imports an FBX by negating X (F = diag(-1, 1, 1)); the porter converts every Unity transform
// by mirroring Z (S = diag(1, 1, -1)). Cocos imports the same FBX without the mirror, so the mesh and
// the skeleton bind poses stay in FBX space. With S applied to every bone, a joint's world matrix
// relative to the skinning root is S*W_u*S = R*W_fbx*R^-1 (R = S*F = Ry(180)), and the skinning matrix
// W*bindpose = R*W_fbx*R^-1*W_fbx_bind^-1 differs per joint: meshes split at every joint (Epic toon
// hero: detached hands, loose joint caps). Keeping the skeleton in FBX space fixes that:
//   skinning root   T_root * R          (one Ry(180) for the whole model, like fbx-mesh-basis.js)
//   FBX nodes       R^-1 * T_s * R      (= F * T_u * F: joints and the renderer nodes of the model)
//   attachments     R^-1 * T_s          (non-FBX child of an FBX node or of the root: world unchanged)
// Then W*bindpose = R at the bind pose for every joint, animations imported with the FBX (Cocos clip
// sub-assets) drive the bones in their own frame, and Unity-authored bone data (humanoid bakes,
// converted .anim curves) must be converted with fbxBoneLocal instead of the scene conversion.

const R = Object.freeze({ x: 0, y: 1, z: 0, w: 0 }); // Ry(180)

function multiplyQuaternion(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

// cc.Quat.toEuler (degrees, YZX), so _euler stays consistent with _lrot.
function cocosEulerFromQuat({ x, y, z, w }) {
  const deg = 180 / Math.PI;
  const test = x * y + z * w;
  if (test > 0.499999) return { x: 0, y: 2 * Math.atan2(x, w) * deg, z: 90 };
  if (test < -0.499999) return { x: 0, y: -2 * Math.atan2(x, w) * deg, z: -90 };
  return {
    x: Math.atan2(2 * x * w - 2 * y * z, 1 - 2 * x * x - 2 * z * z) * deg,
    y: Math.atan2(2 * y * w - 2 * x * z, 1 - 2 * y * y - 2 * z * z) * deg,
    z: Math.asin(2 * test) * deg,
  };
}

const quat = (q) => ({ x: Number(q?.x) || 0, y: Number(q?.y) || 0, z: Number(q?.z) || 0, w: q?.w == null ? 1 : Number(q.w) });
const vec = (v) => ({ x: Number(v?.x) || 0, y: Number(v?.y) || 0, z: Number(v?.z) || 0 });

/** Scene-converted local (Unity mirrored through Z) -> FBX-frame local: R^-1 * T * R. */
function conjugate(position, rotation) {
  return { position: { x: -position.x, y: position.y, z: -position.z }, rotation: { x: -rotation.x, y: rotation.y, z: -rotation.z, w: rotation.w } };
}

/** Unity bone local (position xyz, quaternion xyzw) -> FBX-frame Cocos local, for bone animation data. */
function fbxBoneLocal(position, rotation) {
  return {
    position: position ? [-position[0], position[1], position[2]] : null,
    rotation: rotation ? [rotation[0], -rotation[1], -rotation[2], rotation[3]] : null,
  };
}

function setRotation(node, rotation) {
  node._lrot = { __type__: 'cc.Quat', ...rotation };
  node._euler = { __type__: 'cc.Vec3', ...cocosEulerFromQuat(rotation) };
}

/**
 * Rebase one skinning root in a serialized prefab/scene object list.
 * fbxNodeIds: node ids of the model's own hierarchy (joints + skinned renderer nodes).
 * Diagonal scales commute with Ry(180), so _lscale is kept.
 */
function rebaseSkinnedSkeleton(objects, rootId, fbxNodeIds) {
  const fbx = new Set(fbxNodeIds);
  fbx.delete(rootId);
  const root = objects[rootId];
  setRotation(root, multiplyQuaternion(quat(root._lrot), R));
  let joints = 0;
  let attachments = 0;
  const visit = (parentId) => {
    for (const ref of objects[parentId]?._children || []) {
      const id = ref?.__id__;
      const node = objects[id];
      if (!node) continue;
      if (fbx.has(id)) {
        const { position, rotation } = conjugate(vec(node._lpos), quat(node._lrot));
        node._lpos = { __type__: 'cc.Vec3', ...position };
        setRotation(node, rotation);
        joints++;
        visit(id);
      } else {
        // R^-1 * T_s: the attachment keeps its world transform under the rebased parent.
        const p = vec(node._lpos);
        node._lpos = { __type__: 'cc.Vec3', x: -p.x, y: p.y, z: -p.z };
        setRotation(node, multiplyQuaternion({ x: 0, y: -1, z: 0, w: 0 }, quat(node._lrot)));
        attachments++;
      }
    }
  };
  visit(rootId);
  return { joints, attachments };
}

module.exports = { rebaseSkinnedSkeleton, fbxBoneLocal, conjugate, SKELETON_ROOT_BASIS: R };
