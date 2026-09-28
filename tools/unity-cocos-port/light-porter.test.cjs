'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CocosPrefabBuilder } = require('../unity-cocos-port.cjs');

// Unity 6 Light YAML as serialized in a Built-in demo scene (KriptoFX REP v4 PC Demo.unity).
const light = (type, { enabled = 1, shadowType = 0, strength = 1, bias = 0.05, normalBias = 0.4 } = {}) => ({ lines: [
  'Light:',
  `  m_Enabled: ${enabled}`,
  `  m_Type: ${type}`,
  '  m_Color: {r: 1, g: 1, b: 1, a: 1}',
  '  m_Intensity: 1.4',
  '  m_Range: 10',
  '  m_Shadows:',
  `    m_Type: ${shadowType}`,
  '    m_Resolution: -1',
  `    m_Strength: ${strength}`,
  `    m_Bias: ${bias}`,
  `    m_NormalBias: ${normalBias}`,
  '    m_NearPlane: 0.2',
  '  m_Cookie: {fileID: 0}',
] });

function emit(method, doc) {
  const builder = new CocosPrefabBuilder('light-fixture', {}, {}, {});
  const nodeId = builder.addNode('Light', null, null, 0, true, 'light-node');
  const componentId = builder[method](nodeId, 'light-component', doc, 'light-component');
  return builder.objects[componentId];
}

test('a disabled Unity Light component ports disabled (it must not become the Cocos main light)', () => {
  assert.equal(emit('addDirectionalLight', light(1, { enabled: 0 }))._enabled, false);
  assert.equal(emit('addSphereLight', light(2, { enabled: 0 }))._enabled, false);
  assert.equal(emit('addSpotLight', light(0, { enabled: 0 }))._enabled, false);
  assert.equal(emit('addDirectionalLight', light(1))._enabled, true);
});

test('directional shadows follow the nested m_Shadows block', () => {
  const soft = emit('addDirectionalLight', light(1, { shadowType: 2, strength: 0.8, bias: 0.05, normalBias: 0 }));
  assert.equal(soft._shadowEnabled, true);
  assert.equal(soft._shadowPcf, 3);
  assert.equal(soft._shadowSaturation, 0.8);
  assert.equal(soft._shadowBias, 0.05);
  assert.equal(soft._shadowNormalBias, 0);
  const hard = emit('addDirectionalLight', light(1, { shadowType: 1 }));
  assert.equal(hard._shadowEnabled, true);
  assert.equal(hard._shadowPcf, 0);
  assert.equal(emit('addDirectionalLight', light(1))._shadowEnabled, false);
  assert.equal(emit('addSpotLight', light(0, { shadowType: 2 }))._shadowEnabled, true);
});
