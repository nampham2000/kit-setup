'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CocosAssetDatabase,
  convertRotation,
  multiplyQuaternion,
  correctNestedModelForwardAxis,
  rebaseNestedModelMountedChildTransform,
  hasExplicitNestedModelForwardBasisRotation,
} = require('./unity-cocos-port.cjs');

test('model lookup never fuzzy-matches numeric level-name prefixes', () => {
  const database = new CocosAssetDatabase(process.cwd());
  const level2 = { ext: '.fbx', stem: 'level_2' };
  const level20 = { ext: '.fbx', stem: 'level_20' };
  database.byStem.set('level2', [level2]);
  assert.deepEqual(database.findModelRecordsByStem('level_20'), []);
  assert.deepEqual(database.findModelRecordsByStem('level_1'), []);
  database.byStem.set('level20', [level20]);
  assert.deepEqual(database.findModelRecordsByStem('level_20'), [level20]);
});

function near(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

function nearQuaternion(actual, expected) {
  const direct = Math.hypot(
    actual.x - expected.x, actual.y - expected.y,
    actual.z - expected.z, actual.w - expected.w,
  );
  const negated = Math.hypot(
    actual.x + expected.x, actual.y + expected.y,
    actual.z + expected.z, actual.w + expected.w,
  );
  assert.ok(Math.min(direct, negated) <= 1e-6,
    `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

test('nested FBX identity transform receives the model forward-axis basis', () => {
  const source = {
    localPosition: { x: 0, y: 0, z: 0 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
    euler: { x: 0, y: 0, z: 0 },
  };
  const corrected = correctNestedModelForwardAxis(source);
  assert.deepEqual(convertRotation(corrected.localRotation), {
    __type__: 'cc.Quat', x: -0, y: -1, z: 0, w: 0,
  });
  near(Math.abs(corrected.cocosEuler.y), 180);
});

test('explicit Unity 180-degree Y model rotation cancels the imported FBX basis', () => {
  const source = {
    localRotation: { x: 0, y: 1, z: 0, w: 0 },
    euler: { x: 180, y: 0, z: -180 },
  };
  const corrected = correctNestedModelForwardAxis(source);
  assert.deepEqual(convertRotation(corrected.localRotation), {
    __type__: 'cc.Quat', x: -0, y: -0, z: 0, w: -1,
  });
  near(corrected.cocosEuler.x, 0);
  near(corrected.cocosEuler.y, 0);
  near(corrected.cocosEuler.z, 0);
});

test('immediate mounted children receive the inverse basis including position', () => {
  const rebased = rebaseNestedModelMountedChildTransform({
    localPosition: { x: 2, y: 3, z: 4 },
    localRotation: { x: 0, y: -1, z: 0, w: 0 },
    localScale: { x: 1, y: 2, z: 3 },
  });
  near(rebased.localPosition.x, -2);
  near(rebased.localPosition.y, 3);
  near(rebased.localPosition.z, -4);
  nearQuaternion(rebased.localRotation, { x: 0, y: 0, z: 0, w: 1 });
  assert.deepEqual(rebased.localScale, { x: 1, y: 2, z: 3 });
});

test('model basis plus mounted-child inverse preserves authored composition', () => {
  const root = { x: 0.182574, y: 0.365148, z: -0.182574, w: 0.894427 };
  const child = { x: -0.270598, y: 0.653281, z: 0.270598, w: 0.653281 };
  const originalWorld = multiplyQuaternion(root, child);
  const correctedRoot = correctNestedModelForwardAxis({ localRotation: root }).localRotation;
  const rebasedChild = rebaseNestedModelMountedChildTransform({ localRotation: child }).localRotation;
  const correctedWorld = multiplyQuaternion(correctedRoot, rebasedChild);
  nearQuaternion(correctedWorld, originalWorld);
});

test('authored mounted-child Y180 still receives the inverse model basis', () => {
  assert.equal(hasExplicitNestedModelForwardBasisRotation({
    localRotation: { x: 0, y: 1, z: 0, w: 6.123234e-17 },
  }), true);
  const rebased = rebaseNestedModelMountedChildTransform({
    localPosition: { x: 0, y: 0, z: 0 },
    localRotation: { x: 0, y: 1, z: 0, w: 0 },
    localScale: { x: 1, y: 1, z: 1 },
  });
  nearQuaternion(rebased.localRotation, { x: 0, y: 0, z: 0, w: -1 });
});
