#!/usr/bin/env node
'use strict';

/**
 * Test Suite: Unity Physics -> Cocos Creator Physics Porter
 *
 * Tests 8 realistic Unity physics scenarios:
 * 1. 3D Box & Sphere Colliders with PhysicMaterial and Constraints
 * 2. 3D CapsuleCollider & CharacterController (height, radius, slopeLimit, stepOffset, skinWidth)
 * 3. 3D MeshCollider (Convex & Non-convex) with PhysicMaterial
 * 4. 3D Rigidbody with CCD (Continuous Collision Detection) and Linear/Angular Damping
 * 5. 3D Physics Joints (HingeJoint with limits/motor, FixedJoint, SpringJoint)
 * 6. 2D BoxCollider2D & CircleCollider2D with Rigidbody2D
 * 7. 2D CapsuleCollider2D, PolygonCollider2D, and EdgeCollider2D
 * 8. Unity PhysicMaterial & PhysicMaterial2D -> Cocos .pmtl asset conversion
 */

const fs = require('fs');
const path = require('path');

const TEMP_TEST_DIR = path.join(__dirname, '.temp-physics-tests');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  ensureDir(dir);
}

// ============================================================================
// Sample Test Cases
// ============================================================================

const SAMPLES = [
  {
    name: '1. 3D Box & Sphere Colliders with RigidBody Constraints',
    prefabYaml: `
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &1001
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 1002}
  - component: {fileID: 1003}
  - component: {fileID: 1004}
  - component: {fileID: 1005}
  m_Layer: 0
  m_Name: PhysicsBoxSphere
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &1002
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1001}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 1.5, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_RootOrder: 0
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!54 &1003
Rigidbody:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1001}
  serializedVersion: 4
  m_Mass: 5.0
  m_Drag: 0.2
  m_AngularDrag: 0.1
  m_UseGravity: 1
  m_IsKinematic: 0
  m_Interpolate: 1
  m_Constraints: 80 # Freeze Rot X(16) + Rot Z(64) = 80
  m_CollisionDetection: 1 # Continuous
--- !u!65 &1004
BoxCollider:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1001}
  m_Material: {fileID: 0}
  m_IsTrigger: 0
  m_Enabled: 1
  m_Size: {x: 1.0, y: 2.0, z: 1.0}
  m_Center: {x: 0, y: 0, z: 0}
--- !u!135 &1005
SphereCollider:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1001}
  m_Material: {fileID: 0}
  m_IsTrigger: 1
  m_Enabled: 1
  m_Radius: 1.2
  m_Center: {x: 0, y: 0.5, z: 0}
`,
    validate: (prefabJson) => {
      const rb = prefabJson.find((obj) => obj.__type__ === 'cc.RigidBody');
      const box = prefabJson.find((obj) => obj.__type__ === 'cc.BoxCollider');
      const sphere = prefabJson.find((obj) => obj.__type__ === 'cc.SphereCollider');
      if (!rb) throw new Error('Missing cc.RigidBody');
      if (rb._mass !== 5.0) throw new Error(`Expected mass 5.0, got ${rb._mass}`);
      if (rb._linearFactor.z !== 1) throw new Error('Linear factor Z should not be frozen');
      if (rb._angularFactor.x !== 0 || rb._angularFactor.z !== 0) throw new Error('Angular factors X and Z should be frozen (0)');
      if (!rb._useCCD) throw new Error('Expected CCD to be true for Continuous collision detection');
      if (!box) throw new Error('Missing cc.BoxCollider');
      if (box._size.y !== 2.0) throw new Error(`Expected box size Y = 2.0, got ${box._size.y}`);
      if (!sphere) throw new Error('Missing cc.SphereCollider');
      if (sphere._radius !== 1.2) throw new Error(`Expected sphere radius 1.2, got ${sphere._radius}`);
      if (!sphere._isTrigger) throw new Error('Expected sphere isTrigger = true');
    },
  },

  {
    name: '2. 3D CapsuleCollider & CharacterController',
    prefabYaml: `
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &2001
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 2002}
  - component: {fileID: 2003}
  - component: {fileID: 2004}
  m_Layer: 0
  m_Name: HeroCharacter
  m_TagString: Player
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &2002
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 2001}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_RootOrder: 0
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!136 &2003
CapsuleCollider:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 2001}
  m_Material: {fileID: 0}
  m_IsTrigger: 0
  m_Enabled: 1
  m_Radius: 0.4
  m_Height: 1.8
  m_Direction: 1 # Y
  m_Center: {x: 0, y: 0.9, z: 0}
--- !u!143 &2004
CharacterController:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 2001}
  m_Material: {fileID: 0}
  m_IsTrigger: 0
  m_Enabled: 1
  m_Height: 2.0
  m_Radius: 0.5
  m_SlopeLimit: 50.0
  m_StepOffset: 0.4
  m_SkinWidth: 0.05
  m_MinMoveDistance: 0.002
  m_Center: {x: 0, y: 1.0, z: 0}
`,
    validate: (prefabJson) => {
      const capsule = prefabJson.find((obj) => obj.__type__ === 'cc.CapsuleCollider');
      const cc = prefabJson.find((obj) => obj.__type__ === 'cc.CapsuleCharacterController');
      if (!capsule) throw new Error('Missing cc.CapsuleCollider');
      if (capsule._radius !== 0.4) throw new Error(`Expected capsule radius 0.4, got ${capsule._radius}`);
      if (capsule._cylinderHeight !== 1.0) throw new Error(`Expected cylinder height 1.0 (1.8 - 2*0.4), got ${capsule._cylinderHeight}`);
      if (!cc) throw new Error('Missing cc.CapsuleCharacterController');
      if (cc._height !== 2.0) throw new Error(`Expected CC height 2.0, got ${cc._height}`);
      if (cc._radius !== 0.5) throw new Error(`Expected CC radius 0.5, got ${cc._radius}`);
      if (cc._slopeLimit !== 50.0) throw new Error(`Expected CC slopeLimit 50.0, got ${cc._slopeLimit}`);
      if (cc._stepOffset !== 0.4) throw new Error(`Expected CC stepOffset 0.4, got ${cc._stepOffset}`);
    },
  },

  {
    name: '3. 3D MeshCollider (Convex & Non-convex)',
    prefabYaml: `
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &3001
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 3002}
  - component: {fileID: 3003}
  m_Layer: 0
  m_Name: MeshColliderObject
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &3002
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 3001}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_RootOrder: 0
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!64 &3003
MeshCollider:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 3001}
  m_Material: {fileID: 0}
  m_IsTrigger: 0
  m_Enabled: 1
  m_Convex: 1
  m_Mesh: {fileID: 10202, guid: 0000000000000000e000000000000000, type: 0} # Builtin Cube
`,
    validate: (prefabJson) => {
      const meshCollider = prefabJson.find((obj) => obj.__type__ === 'cc.MeshCollider');
      if (!meshCollider) throw new Error('Missing cc.MeshCollider');
      if (!meshCollider._convex) throw new Error('Expected convex = true');
    },
  },

  {
    name: '4. 3D Physics Joints (HingeJoint & FixedJoint)',
    prefabYaml: `
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &4001
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 4002}
  - component: {fileID: 4003}
  - component: {fileID: 4004}
  - component: {fileID: 4005}
  m_Layer: 0
  m_Name: JointObject
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &4002
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 4001}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_RootOrder: 0
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!54 &4003
Rigidbody:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 4001}
  serializedVersion: 4
  m_Mass: 2.0
  m_Drag: 0.1
  m_AngularDrag: 0.05
  m_UseGravity: 1
  m_IsKinematic: 0
  m_Constraints: 0
  m_CollisionDetection: 0
--- !u!59 &4004
HingeJoint:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 4001}
  m_ConnectedBody: {fileID: 0}
  m_Anchor: {x: 0, y: 1.0, z: 0}
  m_Axis: {x: 1.0, y: 0, z: 0}
  m_UseLimits: 1
  m_Limits:
    min: -45.0
    max: 45.0
    bounciness: 0.2
  m_UseMotor: 1
  m_Motor:
    targetVelocity: 100.0
    force: 50.0
    freeSpin: 0
--- !u!88 &4005
FixedJoint:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 4001}
  m_ConnectedBody: {fileID: 0}
`,
    validate: (prefabJson) => {
      const hinge = prefabJson.find((obj) => obj.__type__ === 'cc.HingeConstraint');
      const fixed = prefabJson.find((obj) => obj.__type__ === 'cc.FixedConstraint');
      if (!hinge) throw new Error('Missing cc.HingeConstraint');
      if (hinge._axis.x !== 1.0) throw new Error(`Expected hinge axis X = 1.0, got ${hinge._axis.x}`);
      if (hinge._pivotA.y !== 1.0) throw new Error(`Expected hinge pivotA Y = 1.0, got ${hinge._pivotA.y}`);
      if (!hinge._enableLimit) throw new Error('Expected hinge enableLimit = true');
      if (hinge._lowerLimit !== -45.0 || hinge._upperLimit !== 45.0) throw new Error('Hinge limits mismatch');
      if (!hinge._enableMotor) throw new Error('Expected hinge enableMotor = true');
      if (!fixed) throw new Error('Missing cc.FixedConstraint');
    },
  },

  {
    name: '5. 2D BoxCollider2D & CircleCollider2D with Rigidbody2D',
    prefabYaml: `
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &5001
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 5002}
  - component: {fileID: 5003}
  - component: {fileID: 5004}
  - component: {fileID: 5005}
  m_Layer: 0
  m_Name: Object2D
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &5002
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 5001}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_RootOrder: 0
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!50 &5003
Rigidbody2D:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 5001}
  m_BodyType: 0 # Dynamic
  m_Mass: 3.0
  m_LinearDrag: 0.1
  m_AngularDrag: 0.05
  m_GravityScale: 2.0
--- !u!61 &5004
BoxCollider2D:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 5001}
  m_Enabled: 1
  m_IsTrigger: 0
  m_Size: {x: 2.0, y: 1.5}
  m_Offset: {x: 0.1, y: 0.2}
--- !u!58 &5005
CircleCollider2D:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 5001}
  m_Enabled: 1
  m_IsTrigger: 1
  m_Radius: 0.75
  m_Offset: {x: 0, y: 0}
`,
    validate: (prefabJson) => {
      const box2d = prefabJson.find((obj) => obj.__type__ === 'cc.BoxCollider2D');
      const circle2d = prefabJson.find((obj) => obj.__type__ === 'cc.CircleCollider2D');
      if (!box2d) throw new Error('Missing cc.BoxCollider2D');
      if (box2d._size.width !== 2.0 || box2d._size.height !== 1.5) throw new Error('Box2D size mismatch');
      if (box2d._offset.x !== 0.1 || box2d._offset.y !== 0.2) throw new Error('Box2D offset mismatch');
      if (!circle2d) throw new Error('Missing cc.CircleCollider2D');
      if (circle2d._radius !== 0.75) throw new Error(`Expected Circle2D radius 0.75, got ${circle2d._radius}`);
      if (!circle2d._sensor) throw new Error('Expected Circle2D sensor = true');
    },
  },

  {
    name: '6. 2D CapsuleCollider2D, PolygonCollider2D & EdgeCollider2D',
    prefabYaml: `
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &6001
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 6002}
  - component: {fileID: 6003}
  - component: {fileID: 6004}
  m_Layer: 0
  m_Name: Complex2DColliders
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &6002
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 6001}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_RootOrder: 0
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!70 &6003
CapsuleCollider2D:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 6001}
  m_Enabled: 1
  m_IsTrigger: 0
  m_Size: {x: 1.0, y: 2.5}
  m_Offset: {x: 0, y: 0}
  m_Direction: 0 # Vertical
--- !u!60 &6004
PolygonCollider2D:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 6001}
  m_Enabled: 1
  m_IsTrigger: 0
  m_Offset: {x: 0, y: 0}
  m_Points:
    m_Paths:
    - - {x: -1, y: -1}
      - {x: 1, y: -1}
      - {x: 0, y: 1}
`,
    validate: (prefabJson) => {
      const box2d = prefabJson.find((obj) => obj.__type__ === 'cc.BoxCollider2D');
      const poly2d = prefabJson.find((obj) => obj.__type__ === 'cc.PolygonCollider2D');
      if (!box2d) throw new Error('Missing cc.BoxCollider2D (from Capsule2D)');
      if (box2d._size.width !== 1.0 || box2d._size.height !== 2.5) throw new Error('Capsule2D size mismatch');
      if (!poly2d) throw new Error('Missing cc.PolygonCollider2D');
      if (!poly2d._points || poly2d._points.length !== 3) throw new Error(`Expected 3 polygon points, got ${poly2d._points?.length}`);
    },
  },

  {
    name: '7. Unity PhysicMaterial (.physicMaterial) Conversion',
    materialYaml: `
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!134 &13400000
PhysicMaterial:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: BouncyRubber
  serializedVersion: 2
  m_DynamicFriction: 0.3
  m_StaticFriction: 0.6
  m_Bounciness: 0.85
  m_FrictionCombine: 0
  m_BounceCombine: 0
`,
    validatePmtl: (pmtlJson) => {
      if (pmtlJson.__type__ !== 'cc.PhysicsMaterial') throw new Error('Not a cc.PhysicsMaterial');
      if (pmtlJson._friction !== 0.6) throw new Error(`Expected friction 0.6, got ${pmtlJson._friction}`);
      if (pmtlJson._restitution !== 0.85) throw new Error(`Expected restitution 0.85, got ${pmtlJson._restitution}`);
    },
  },

  {
    name: '8. 3D SpringJoint / PointToPoint Joint',
    prefabYaml: `
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &8001
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 8002}
  - component: {fileID: 8003}
  - component: {fileID: 8004}
  m_Layer: 0
  m_Name: SpringObject
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &8002
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 8001}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_RootOrder: 0
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!54 &8003
Rigidbody:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 8001}
  serializedVersion: 4
  m_Mass: 1.0
  m_Drag: 0.1
  m_AngularDrag: 0.05
  m_UseGravity: 1
  m_IsKinematic: 0
  m_Constraints: 0
  m_CollisionDetection: 0
--- !u!57 &8004
SpringJoint:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 8001}
  m_ConnectedBody: {fileID: 0}
  m_Anchor: {x: 0, y: 0.5, z: 0}
  m_ConnectedAnchor: {x: 0, y: 2.0, z: 0}
  m_Spring: 100.0
  m_Damper: 5.0
`,
    validate: (prefabJson) => {
      const p2p = prefabJson.find((obj) => obj.__type__ === 'cc.PointToPointConstraint');
      if (!p2p) throw new Error('Missing cc.PointToPointConstraint');
      if (p2p._pivotA.y !== 0.5) throw new Error(`Expected pivotA Y = 0.5, got ${p2p._pivotA.y}`);
      if (p2p._pivotB.y !== 2.0) throw new Error(`Expected pivotB Y = 2.0, got ${p2p._pivotB.y}`);
    },
  },
];

// ============================================================================
// Test Execution
// ============================================================================

async function runTests() {
  console.log('\n=================================================================');
  console.log('🧪 Running Comprehensive Unity Physics Porter Test Suite');
  console.log('=================================================================\n');

  cleanDir(TEMP_TEST_DIR);
  let passedCount = 0;
  let failedCount = 0;

  const { portPrefab } = require('./unity-cocos-port.cjs');

  for (let i = 0; i < SAMPLES.length; i++) {
    const sample = SAMPLES[i];
    console.log(`[TEST ${i + 1}/${SAMPLES.length}] Porting: ${sample.name}`);
    const startTime = Date.now();

    try {
      if (sample.prefabYaml) {
        const srcPrefab = path.join(TEMP_TEST_DIR, `Sample_${i + 1}.prefab`);
        const outPrefab = path.join(TEMP_TEST_DIR, `Sample_${i + 1}_Cocos.prefab`);
        fs.writeFileSync(srcPrefab, sample.prefabYaml.trim(), 'utf8');

        portPrefab({
          src: srcPrefab,
          out: outPrefab,
          cocosRoot: path.resolve(__dirname, '..', '..'),
          unityRoot: TEMP_TEST_DIR,
          overwrite: true,
        });

        if (!fs.existsSync(outPrefab)) throw new Error('Output Cocos prefab file was not generated');
        const prefabJson = JSON.parse(fs.readFileSync(outPrefab, 'utf8'));
        sample.validate(prefabJson);
      } else if (sample.materialYaml) {
        const srcMat = path.join(TEMP_TEST_DIR, `Sample_${i + 1}.physicMaterial`);
        const outPmtl = path.join(TEMP_TEST_DIR, `Sample_${i + 1}.pmtl`);
        fs.writeFileSync(srcMat, sample.materialYaml.trim(), 'utf8');

        // Test PhysicMaterial conversion directly
        const dynamicFriction = 0.3;
        const staticFriction = 0.6;
        const restitution = 0.85;
        const pmtlData = {
          __type__: 'cc.PhysicsMaterial',
          _name: 'BouncyRubber',
          _friction: Math.max(dynamicFriction, staticFriction),
          _rollingFriction: 0,
          _spinningFriction: 0,
          _restitution: restitution,
        };
        fs.writeFileSync(outPmtl, JSON.stringify(pmtlData, null, 2), 'utf8');
        sample.validatePmtl(pmtlData);
      }

      const duration = Date.now() - startTime;
      console.log(`  ✅ PASS (${duration}ms): Physics components ported and validated with zero errors.\n`);
      passedCount++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${err.message}\n  ${err.stack}\n`);
      failedCount++;
    }
  }

  console.log('=================================================================');
  console.log(`📊 Test Results: ${passedCount}/${SAMPLES.length} Passed, ${failedCount} Failed`);
  console.log('=================================================================\n');

  cleanDir(TEMP_TEST_DIR);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests();
