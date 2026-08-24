'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildFeatureSketch } = require('./feature-sketch.cjs');

function featureInput(componentTypes) {
  return {
    project: {
      packages: {
        'com.unity.inputsystem': '1.18.0',
        'com.unity.addressables': '2.8.1',
        'com.unity.render-pipelines.universal': '17.3.0',
      },
    },
    live: {
      facts: {
        componentTypes,
        scripts: [
          { path: 'Assets/Game/Spawner.cs', type: 'ItemSpawner', methods: ['Start', 'OnTriggerEnter'] },
          { path: 'C:\\private\\Secret.cs', type: 'SaveManager', methods: ['Update'] },
        ],
      },
    },
    assets: {
      records: [
        { assetPath: 'Assets/Game/Glow.shader', type: 'shader', blockerIds: ['shaderlab'] },
        { assetPath: 'Assets/Game/Run.controller', type: 'controller', blockerIds: ['animator'] },
      ],
    },
    scriptIndex: { scripts: [] },
    features: {
      blockers: [
        { id: 'dotween', count: 2, examples: ['Assets/Game/Tween.cs'] },
        { id: 'coroutine', count: 1, examples: ['Assets/Game/Routine.cs'] },
      ],
    },
  };
}

test('feature sketch is deterministic, prioritized and bounded to compact evidence', () => {
  const components = [
    { type: 'UnityEngine.ParticleSystem', path: 'Assets/Game/Fx.prefab', count: 3 },
    { type: 'UnityEngine.Rigidbody', path: 'Assets/Game/Hero.prefab' },
    { type: 'UnityEngine.AudioSource', path: 'Assets/Game/Hero.prefab' },
    { type: 'UnityEngine.UI.Button', path: 'Assets/Game/Hud.prefab' },
    { type: 'UnityEngine.Camera', path: 'Assets/Game/Main.unity' },
  ];
  const first = buildFeatureSketch(featureInput(components), { maxEvidence: 2 });
  const second = buildFeatureSketch(featureInput([...components].reverse()), { maxEvidence: 2 });
  assert.deepEqual(first, second);
  assert.equal(first[0].id, 'input');
  for (const feature of first) assert.ok(feature.evidence.length <= 2);
  for (const expected of ['physics-3d', 'ui', 'camera', 'particles-vfx', 'rendering-shaders', 'audio',
    'runtime-loading', 'tweening', 'timing-coroutines', 'spawning-pooling', 'persistence']) {
    assert.equal(first.some(feature => feature.id === expected), true, `missing ${expected}`);
  }
  assert.doesNotMatch(JSON.stringify(first), /C:\\\\private/);
});

test('asset-only evidence stays inferred while direct Unity facts are high confidence', () => {
  const inferred = buildFeatureSketch({
    project: { packages: {} },
    assets: { records: [{ assetPath: 'Assets/Game/Run.controller', type: 'controller' }] },
    features: { blockers: [] },
  });
  assert.equal(inferred.find(feature => feature.id === 'animation').confidence, 'medium');

  const exact = buildFeatureSketch(featureInput([{ type: 'UnityEngine.Animator', path: 'Assets/Game/Hero.prefab' }]));
  assert.equal(exact.find(feature => feature.id === 'animation').confidence, 'high');
});

test('consumes the exact compact facts emitted by the Unity C# scanner', () => {
  const sketch = buildFeatureSketch({
    project: { packages: {} },
    live: {
      facts: {
        componentCensus: [
          { type: 'UnityEngine.ParticleSystem', count: 8 },
          { type: 'UnityEngine.Rigidbody2D', count: 4 },
        ],
        typeCounts: [{ type: 'UnityEngine.AudioClip', count: 3 }],
        packages: [{ name: 'com.unity.inputsystem', version: '1.18.0' }],
      },
    },
    assets: { records: [] },
    scriptIndex: { scripts: [] },
    features: { blockers: [] },
  });
  for (const expected of ['input', 'physics-2d', 'particles-vfx', 'audio']) {
    assert.equal(sketch.some(feature => feature.id === expected), true, `missing ${expected}`);
  }
});
