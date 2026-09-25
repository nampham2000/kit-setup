'use strict';

// Prefab variants that remove a nested child and add a nested instance referenced by a script field (Tanks! Demo
// shell variants: m_RemovedGameObjects -> the base CompleteShellExplosion instance, m_ExplosionParticles -> the
// ParticleSystem of the added Demo_CompleteShellExplosion Variant instance).
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  unityDerivedFileId,
  registerDerivedNestedIds,
  nestedPrefabHasExternallyReferencedObjects,
  resolveDeferredObjectRefs,
} = require('./unity-cocos-port.cjs');

test('Unity derives ids of objects inside a PrefabInstance as (instance ^ source) & 0x7fff...', () => {
  // CompleteShell.prefab: explosion instance 6950372259491175068, CompleteShellExplosion root GameObject 195792;
  // the variant's m_RemovedGameObjects names 6950372259491063372.
  assert.equal(unityDerivedFileId('6950372259491175068', '195792'), '6950372259491063372');
  // Negative (signed 64-bit) ids are XORed as unsigned and masked to 63 bits.
  const derived = BigInt(unityDerivedFileId('-927890215427519120', '11426614'));
  assert.ok(derived >= 0n && derived < (1n << 63n));
  assert.equal(unityDerivedFileId('12:go', '4'), '', 'synthetic ids have no Unity counterpart');
});

test('flattened nested ids are registered in the outer builder under their derived Unity ids', () => {
  const outer = { nodeMapByGameObject: new Map(), nodeMapByTransform: new Map(), componentMap: new Map() };
  const nested = {
    nodeMapByGameObject: new Map([['195792', 1]]),
    nodeMapByTransform: new Map([['498018', 1]]),
    componentMap: new Map([['19802334', 5], ['synthetic:go', 6]]),
  };
  const idMap = new Map([[1, 101], [5, 105], [6, 106]]);
  const count = registerDerivedNestedIds(outer, nested, '6950372259491175068', idMap);
  assert.equal(count, 3);
  assert.equal(outer.nodeMapByGameObject.get('6950372259491063372'), 101);
  assert.equal(outer.componentMap.get(unityDerivedFileId('6950372259491175068', '19802334')), 105);
});

test('an instance whose objects are serialized as stripped non-Transform docs is externally referenced', () => {
  const doc = (classId, instance) => ({ classId, stripped: true, lines: [`  m_PrefabInstance: {fileID: ${instance}}`] });
  const model = { componentDocs: new Map([['3748297161477850278', doc(4, '744056624600594322')], ['3748297161492092154', doc(198, '744056624600594322')]]) };
  assert.equal(nestedPrefabHasExternallyReferencedObjects({ overrideInfo: { fileId: '744056624600594322' } }, model), true);
  const transformsOnly = { componentDocs: new Map([['3748297161477850278', doc(4, '744056624600594322')]]) };
  assert.equal(nestedPrefabHasExternallyReferencedObjects({ overrideInfo: { fileId: '744056624600594322' } }, transformsOnly), false,
    'a stripped Transform alone only anchors added children');
});

test('deferred object-reference overrides resolve against the finished builder and are then cleared', () => {
  const reports = [];
  const reporter = { low: (...args) => reports.push(['low', ...args]), medium: (...args) => reports.push(['medium', ...args]) };
  const builder = {
    objects: { 7: { m_ExplosionParticles: { __id__: 11 } }, 30: {} },
    componentMap: new Map([['3748297161492092154', 30]]),
    nodeMapByGameObject: new Map(),
    nodeMapByTransform: new Map(),
    deferredObjectRefs: [
      { componentId: 7, propertyPath: 'm_ExplosionParticles', unityRef: { fileID: '3748297161492092154' }, source: 'CompleteShell.prefab' },
      { componentId: 7, propertyPath: 'm_Missing', unityRef: { fileID: '42' }, source: 'CompleteShell.prefab' },
    ],
  };
  resolveDeferredObjectRefs(builder, reporter);
  assert.deepEqual(builder.objects[7].m_ExplosionParticles, { __id__: 30 });
  assert.equal(builder.deferredObjectRefs.length, 0);
  assert.ok(reports.some((r) => r[0] === 'medium' && r[1] === 'NESTED_SCRIPT_REF_OVERRIDE_UNRESOLVED'));
});
