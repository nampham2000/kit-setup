'use strict';

/**
 * Cocos Creator 3.8.8+ API Catalog & Migration Reference
 *
 * Fast programmatic lookup for Cocos Creator 3.8.8 core APIs, zero-GC math
 * patterns, node hierarchies, and Unity-to-Cocos equivalence mappings.
 */

const COCOS_API_CATALOG = {
  Vec3: {
    module: 'cc',
    description: '3D Vector in right-handed coordinate system (-Z is forward, Y is up, X is right).',
    constants: {
      ZERO: 'Vec3(0, 0, 0)',
      ONE: 'Vec3(1, 1, 1)',
      UP: 'Vec3(0, 1, 0)',
      DOWN: 'Vec3(0, -1, 0)',
      FORWARD: 'Vec3(0, 0, -1) // Right-handed -Z forward',
      BACK: 'Vec3(0, 0, 1)',
      RIGHT: 'Vec3(1, 0, 0)',
      LEFT: 'Vec3(-1, 0, 0)',
    },
    staticMethods: {
      add: 'Vec3.add(out: Vec3, a: Vec3, b: Vec3): Vec3',
      subtract: 'Vec3.subtract(out: Vec3, a: Vec3, b: Vec3): Vec3',
      multiply: 'Vec3.multiply(out: Vec3, a: Vec3, b: Vec3): Vec3',
      multiplyScalar: 'Vec3.multiplyScalar(out: Vec3, a: Vec3, b: number): Vec3',
      scaleAndAdd: 'Vec3.scaleAndAdd(out: Vec3, a: Vec3, b: Vec3, scale: number): Vec3',
      distance: 'Vec3.distance(a: Vec3, b: Vec3): number',
      dot: 'Vec3.dot(a: Vec3, b: Vec3): number',
      cross: 'Vec3.cross(out: Vec3, a: Vec3, b: Vec3): Vec3',
      lerp: 'Vec3.lerp(out: Vec3, from: Vec3, to: Vec3, ratio: number): Vec3',
      normalize: 'Vec3.normalize(out: Vec3, a: Vec3): Vec3',
    },
  },
  Quat: {
    module: 'cc',
    description: 'Quaternion for 3D rotations.',
    constants: {
      IDENTITY: 'Quat(0, 0, 0, 1)',
    },
    staticMethods: {
      fromEuler: 'Quat.fromEuler(out: Quat, x: number, y: number, z: number): Quat',
      fromViewUp: 'Quat.fromViewUp(out: Quat, view: Vec3, up?: Vec3): Quat',
      fromAxisAngle: 'Quat.fromAxisAngle(out: Quat, axis: Vec3, rad: number): Quat',
      slerp: 'Quat.slerp(out: Quat, a: Quat, b: Quat, t: number): Quat',
      lerp: 'Quat.lerp(out: Quat, a: Quat, b: Quat, t: number): Quat',
      multiply: 'Quat.multiply(out: Quat, a: Quat, b: Quat): Quat',
      invert: 'Quat.invert(out: Quat, a: Quat): Quat',
      dot: 'Quat.dot(a: Quat, b: Quat): number',
      angle: 'Quat.angle(a: Quat, b: Quat): number',
    },
  },
  Node: {
    module: 'cc',
    description: 'Core scene graph entity in Cocos Creator 3.8.8.',
    methods: {
      setPosition: 'this.node.setPosition(val: Vec3 | number, y?: number, z?: number): void',
      setWorldPosition: 'this.node.setWorldPosition(val: Vec3): void',
      setRotation: 'this.node.setRotation(val: Quat): void',
      setWorldRotation: 'this.node.setWorldRotation(val: Quat): void',
      setScale: 'this.node.setScale(val: Vec3 | number, y?: number, z?: number): void',
      addChild: 'this.node.addChild(child: Node): void',
      setParent: 'this.node.setParent(parent: Node | null, keepWorldTransform?: boolean): void',
      getComponent: 'this.node.getComponent<T>(classConstructor: Constructor<T>): T | null',
      getComponentInChildren: 'this.node.getComponentInChildren<T>(classConstructor: Constructor<T>): T | null',
      destroy: 'this.node.destroy(): boolean',
    },
  },
  Component: {
    module: 'cc',
    description: 'Base class for custom scripts attached to Node.',
    lifecycle: {
      onLoad: 'Called when node is loaded',
      onEnable: 'Called when node/component is activated',
      start: 'Called before first frame update',
      update: 'update(dt: number): void - Called every frame',
      lateUpdate: 'lateUpdate(dt: number): void - Called after update',
      onDisable: 'Called when node/component is deactivated',
      onDestroy: 'Called when node/component is destroyed',
    },
  },
};

const COMPONENT_MIGRATION_MAP = {
  MonoBehaviour: { cocos: 'Component', notes: 'Inherit Component, decorate with @ccclass' },
  GameObject: { cocos: 'Node', notes: 'Map to cc.Node' },
  Transform: { cocos: 'Node', notes: 'Transform is part of Node in Cocos' },
  AudioSource: { cocos: 'AudioSource', notes: 'Cocos AudioSource component' },
  Camera: { cocos: 'Camera', notes: 'Cocos 3.8 Camera component' },
  Rigidbody: { cocos: 'RigidBody', notes: 'Cocos RigidBody (capital B)' },
  Collider: { cocos: 'Collider', notes: 'Cocos BoxCollider, SphereCollider, CapsuleCollider' },
  Text: { cocos: 'Label', notes: 'Cocos Label component' },
  Image: { cocos: 'Sprite', notes: 'Cocos Sprite component with SpriteFrame' },
  Button: { cocos: 'Button', notes: 'Cocos Button component' },
};

function getCocosApiSignature(className, methodName = '') {
  const cls = COCOS_API_CATALOG[className];
  if (!cls) return null;
  if (!methodName) return cls;
  return cls.staticMethods?.[methodName] || cls.methods?.[methodName] || cls.constants?.[methodName] || null;
}

function queryMathUtil(operation) {
  const op = operation.toLowerCase();
  const results = [];
  for (const [clsName, cls] of Object.entries(COCOS_API_CATALOG)) {
    for (const [mName, sig] of Object.entries(cls.staticMethods || {})) {
      if (mName.toLowerCase().includes(op) || sig.toLowerCase().includes(op)) {
        results.push({ class: clsName, method: mName, signature: sig });
      }
    }
  }
  return results;
}

function getComponentMigrationDoc(unityComponent) {
  const mapped = COMPONENT_MIGRATION_MAP[unityComponent];
  if (mapped) {
    return {
      unityComponent,
      cocosComponent: mapped.cocos,
      notes: mapped.notes,
      module: 'cc',
    };
  }
  return {
    unityComponent,
    cocosComponent: 'Component',
    notes: 'Generic custom component. Inherit from Component and apply @ccclass decorator.',
    module: 'cc',
  };
}

const { UnityApiCatalog, UNITY_API_ENTRIES } = require('./unity-api-catalog.cjs');

const unityCatalog = new UnityApiCatalog();

function lookupUnityApi(nameOrId) {
  return unityCatalog.lookup(nameOrId);
}

function getUnityZeroGcAlternative(nameOrId) {
  const entry = unityCatalog.lookup(nameOrId);
  return entry ? entry.zeroGcAlternative : null;
}

module.exports = {
  COCOS_API_CATALOG,
  COMPONENT_MIGRATION_MAP,
  UNITY_API_ENTRIES,
  UnityApiCatalog,
  getCocosApiSignature,
  queryMathUtil,
  getComponentMigrationDoc,
  lookupUnityApi,
  getUnityZeroGcAlternative,
};
