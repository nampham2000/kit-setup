'use strict';

/**
 * Headless Cocos Environment Mock Harness
 *
 * Implements Section 8.2 of the Migration Specification:
 * Mocks core Cocos Creator runtime structures (Node, Vec3, Quat, Component)
 * so P0 (Data/Model) and P1 (Pure Gameplay Logic) can be verified headlessly in Node.js.
 */

class MockVec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    if (typeof x === 'object') {
      this.x = x.x;
      this.y = x.y;
      this.z = x.z;
    } else {
      this.x = x || 0;
      this.y = y || 0;
      this.z = z || 0;
    }
    return this;
  }

  clone() {
    return new MockVec3(this.x, this.y, this.z);
  }

  static add(out, a, b) {
    out.x = a.x + b.x;
    out.y = a.y + b.y;
    out.z = a.z + b.z;
    return out;
  }

  static subtract(out, a, b) {
    out.x = a.x - b.x;
    out.y = a.y - b.y;
    out.z = a.z - b.z;
    return out;
  }

  static multiplyScalar(out, a, scale) {
    out.x = a.x * scale;
    out.y = a.y * scale;
    out.z = a.z * scale;
    return out;
  }

  static scaleAndAdd(out, a, b, scale) {
    out.x = a.x + b.x * scale;
    out.y = a.y + b.y * scale;
    out.z = a.z + b.z * scale;
    return out;
  }

  static distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

class MockQuat {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  set(x, y, z, w) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }
}

class MockNode {
  constructor(name = 'Node') {
    this.name = name;
    this.active = true;
    this.activeInHierarchy = true;
    this.parent = null;
    this.children = [];
    this.components = [];
    this.position = new MockVec3();
    this.worldPosition = new MockVec3();
    this.rotation = new MockQuat();
    this.worldRotation = new MockQuat();
    this.scale = new MockVec3(1, 1, 1);
  }

  setPosition(pos) {
    this.position.set(pos);
    this.worldPosition.set(pos);
  }

  setWorldPosition(pos) {
    this.worldPosition.set(pos);
  }

  setScale(scale) {
    this.scale.set(scale);
  }

  addChild(child) {
    child.parent = this;
    this.children.push(child);
  }

  addComponent(ComponentClass) {
    const comp = new ComponentClass();
    comp.node = this;
    this.components.push(comp);
    if (typeof comp.onLoad === 'function') comp.onLoad();
    if (typeof comp.start === 'function') comp.start();
    return comp;
  }

  getComponent(ComponentClass) {
    return this.components.find(c => c instanceof ComponentClass || c.constructor.name === ComponentClass.name) || null;
  }
}

class MockComponent {
  constructor() {
    this.node = null;
    this.enabled = true;
  }
}

module.exports = {
  MockVec3,
  MockQuat,
  MockNode,
  MockComponent,
};
