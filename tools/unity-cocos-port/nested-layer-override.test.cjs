'use strict';

// An outer prefab can re-layer the children of a nested prefab instance (Blast Shooter's conveyors put the
// nested Block tray's Model/Shadow on layer 8, lit by the conveyor light). The override must reach the
// linked Cocos instance's child nodes; the instance root's layer is written by addNestedPrefabInstance.
const assert = require('node:assert/strict');
const test = require('node:test');
const { buildNestedPrefabPropertyOverrides } = require('../unity-cocos-port.cjs');

test('nested child m_Layer overrides become _layer property overrides; the root is left to the instance', () => {
  const sourceGuid = 'cccccccccccccccccccccccccccccccc';
  const rootTransform = { fileId: '400', gameObjectId: '100' };
  const model = {
    roots: [rootTransform],
    transforms: new Map([['400', rootTransform], ['401', { fileId: '401', gameObjectId: '101', parentId: '400' }]]),
    gameObjects: new Map([['100', { name: 'Block80', transformId: '400' }], ['101', { name: 'Model', transformId: '401' }]]),
    componentDocs: new Map(),
  };
  const gameObject = { nestedPrefab: {
    sourceGuid, model,
    overrideInfo: { overridesByTarget: new Map([
      [`${sourceGuid}:100`, { m_Layer: 8 }],
      [`${sourceGuid}:101`, { m_Layer: 8 }],
    ]) },
  } };
  const layers = [];
  const layerResolver = (layer, name) => { layers.push([layer, name]); return 1 << layer; };
  const overrides = buildNestedPrefabPropertyOverrides(gameObject, {}, model, { layerResolver });
  assert.deepEqual(overrides.filter(o => o.propertyPath === '_layer'), [{ localId: 'node-model-401', propertyPath: '_layer', value: 256 }]);
  assert.deepEqual(layers, [[8, 'Model']]);
});
