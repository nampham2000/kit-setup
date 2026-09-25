'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyNestedParticlePrefabOverrides, CocosPrefabBuilder } = require('./unity-cocos-port.cjs');

const reporter = () => {
  const entries = [];
  return { entries, ...Object.fromEntries(['high', 'medium', 'low'].map(level => [level, (...args) => entries.push({ level, args })])) };
};

// ARPG GroundFog: a Mesh-mode (built-in Quad) emitter whose scene instance only
// overrides startColor and enables the Velocity module. The flatten path
// re-applies the merged source data, and the converter clears renderer._mesh.
function fogFixture(rendererProps = {}) {
  const mesh = { __uuid__: '1263d74c-8167-4928-91a6-4e2672411f47@fc873', __expectedType__: 'cc.Mesh' };
  const builder = {
    objects: [
      { __type__: 'cc.Node', _name: 'GroundFog', _components: [] },
      { __type__: 'cc.ParticleSystem', node: { __id__: 0 }, _textureAnimationModule: { __id__: 2 }, renderer: { __id__: 3 } },
      { _enable: false, _numTilesX: 1, _numTilesY: 1 },
      { __type__: 'cc.ParticleSystemRenderer', _mesh: mesh },
    ],
    componentMap: new Map([['ps', 1]]),
    nodeMapByTransform: new Map(),
    nodeMapByGameObject: new Map([['go', 0]]),
  };
  const model = {
    transforms: new Map(),
    gameObjects: new Map([['go', { fileId: 'go', name: 'GroundFog', components: ['ps', 'pr'] }]]),
    componentDocs: new Map([
      ['ps', { classId: 198, fileId: 'ps', lines: ['ParticleSystem:', '  looping: 1'] }],
      ['pr', { classId: 199, fileId: 'pr', lines: ['ParticleSystemRenderer:', '  m_RenderMode: 4', '  m_RenderAlignment: 2'] }],
    ]),
  };
  const overrides = new Map([['guid:ps', { 'InitialModule.startColor.maxColor.r': 0.83, 'VelocityModule.enabled': 1 }]]);
  if (Object.keys(rendererProps).length) overrides.set('guid:pr', rendererProps);
  const nestedPrefab = { model, sourceGuid: 'guid', overrideInfo: { overridesByTarget: overrides, removedGameObjectSourceIds: [] } };
  return { builder, nestedPrefab, mesh };
}

test('a particle override on a flattened Mesh-mode emitter keeps its mesh', () => {
  const { builder, nestedPrefab, mesh } = fogFixture();
  applyNestedParticlePrefabOverrides(builder, nestedPrefab, reporter(), {}, new Map(), {});
  assert.deepEqual(builder.objects[3]._mesh, mesh);
  assert.equal(builder.objects[3]._renderMode, 4);
});

test('a scene-level built-in mesh override is resolved instead of cleared', () => {
  const { builder, nestedPrefab } = fogFixture({ m_Mesh: { fileID: 10202, guid: '0000000000000000e000000000000000', type: 0 } });
  const report = reporter();
  applyNestedParticlePrefabOverrides(builder, nestedPrefab, report, {}, new Map(), {});
  assert.ok(builder.objects[3]._mesh?.__uuid__, 'override mesh resolved');
  assert.notEqual(builder.objects[3]._mesh.__uuid__, '1263d74c-8167-4928-91a6-4e2672411f47@fc873', 'Cube, not the Quad');
});

test('a source-bound adapter is added once per node, type and source', () => {
  const builder = new CocosPrefabBuilder('Fx', null, reporter(), {});
  const nodeId = builder.objects.push({ __type__: 'cc.Node', _name: 'Fx', _components: [] }) - 1;
  const first = builder.addComponent(nodeId, 'prewarm-adapter', { source: { __id__: 7 } }, null, 'a');
  const second = builder.addComponent(nodeId, 'prewarm-adapter', { source: { __id__: 7 } }, null, 'b');
  const other = builder.addComponent(nodeId, 'prewarm-adapter', { source: { __id__: 8 } }, null, 'c');
  assert.equal(second, first);
  assert.notEqual(other, first);
  assert.equal(builder.objects[nodeId]._components.length, 2);
});
