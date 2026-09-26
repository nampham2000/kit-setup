'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CocosPrefabBuilder } = require('../unity-cocos-port.cjs');

function emitCamera(lines) {
  const builder = new CocosPrefabBuilder('camera-fixture', {}, {}, {});
  const nodeId = builder.addNode('Camera', null, null, 0, true, 'camera-node');
  const componentId = builder.addCamera(nodeId, 'camera-component', { lines }, 'camera-component');
  return builder.objects[componentId];
}

test('camera porter preserves a nested Unity culling-mask bitset', () => {
  const camera = emitCamera([
    'Camera:',
    '  m_ClearFlags: 1',
    '  m_CullingMask:',
    '    serializedVersion: 2',
    '    m_Bits: 11',
    '  m_Orthographic: 0',
  ]);

  assert.equal(camera._visibility, 11);
});

test('camera porter defaults to all layers when Unity omits the culling mask', () => {
  const camera = emitCamera([
    'Camera:',
    '  m_ClearFlags: 1',
    '  m_Orthographic: 0',
  ]);

  assert.equal(camera._visibility, 0xffffffff);
});
