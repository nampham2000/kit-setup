'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolveTransformLayout,
  resolveNestedPrefabEffectiveTransform,
} = require('./unity-cocos-port.cjs');

function transform(overrides = {}) {
  return {
    localPosition: { x: 0, y: 0, z: 0 },
    anchoredPosition: null,
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
    euler: { x: 0, y: 0, z: 0 },
    sizeDelta: { x: 100, y: 100 },
    anchorMin: { x: 0.5, y: 0.5 },
    anchorMax: { x: 0.5, y: 0.5 },
    anchor: { x: 0.5, y: 0.5 },
    ...overrides,
  };
}

test('nested prefab inherits source transform fields omitted by Unity modifications', () => {
  const source = transform({
    localPosition: { x: 4, y: 5, z: 6 },
    localRotation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
    localScale: { x: 1.25, y: 1.25, z: 1.25 },
  });
  const result = resolveNestedPrefabEffectiveTransform(transform(), source, {
    'm_LocalPosition.x': 0,
    'm_LocalPosition.y': -0.153,
    'm_LocalPosition.z': 0.167,
  });

  assert.deepEqual(result.localPosition, { x: 0, y: -0.153, z: 0.167 });
  assert.deepEqual(result.localRotation, source.localRotation);
  assert.deepEqual(result.localScale, { x: 1.25, y: 1.25, z: 1.25 });
});

test('nested prefab explicit transform modifications still override source defaults', () => {
  const result = resolveNestedPrefabEffectiveTransform(transform(), transform({
    localScale: { x: 1.25, y: 1.25, z: 1.25 },
  }), {
    'm_LocalScale.x': 0.5,
    'm_LocalScale.y': 0.6,
    'm_LocalScale.z': 0.7,
  });

  assert.deepEqual(result.localScale, { x: 0.5, y: 0.6, z: 0.7 });
});

test('RectTransform anchored position is applied once relative to the effective parent pivot', () => {
  const parent = transform({
    isRect: true,
    sizeDelta: { x: 843, y: 224 },
    anchor: { x: 0.5, y: 1 },
    resolvedLayout: { size: { x: 843, y: 224 }, anchor: { x: 0.5, y: 1 } },
  });
  const child = transform({
    isRect: true,
    anchoredPosition: { x: 67.7, y: -16 },
    localPosition: { x: 0, y: -16, z: 0 },
    anchorMin: { x: 0, y: 0.5 },
    anchorMax: { x: 0, y: 0.5 },
    anchor: { x: 0, y: 0.5 },
    sizeDelta: { x: 234, y: 268 },
  });

  const result = resolveTransformLayout(child, parent);

  assert.deepEqual(result.localPosition, { x: -353.8, y: -128, z: 0 });
});
