'use strict';

// Unity wraps long flow mappings in PrefabInstance data. With 19-digit fileIDs the `target:` and
// `objectReference:` references of most modifications spill onto a second line. The porter used to
// match only single-line references, so every such override was dropped silently. Evidence: Screw
// Out Factory BaseBox.prefab instances of screw.prefab are renamed "screw (1)" and set
// `m_IsActive: 0`, yet the port emitted them active and visible in the box slots.
const assert = require('node:assert/strict');
const test = require('node:test');
const { parsePrefabInstanceInfo, parsePrefabInstanceReferenceList } = require('./unity-cocos-port.cjs');

const GUID = '6d49d5e42220fa64bbf7326459e67788';

function doc(text) {
  return { fileId: '8281317451433198093', lines: text.replace(/^\n/, '').split('\n') };
}

test('wrapped modification targets and object references are parsed like single-line ones', () => {
  const info = parsePrefabInstanceInfo(doc(`
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 2280472732589168797}
    m_Modifications:
    - target: {fileID: 6808614170226160139, guid: ${GUID},
        type: 3}
      propertyPath: m_Name
      value: screw (1)
      objectReference: {fileID: 0}
    - target: {fileID: 6808614170226160139, guid: ${GUID},
        type: 3}
      propertyPath: m_IsActive
      value: 0
      objectReference: {fileID: 0}
    - target: {fileID: 4592536538088055199, guid: ${GUID}, type: 3}
      propertyPath: m_LocalPosition.y
      value: 0.1
      objectReference: {fileID: 0}
    - target: {fileID: 4107577884502733399, guid: ${GUID},
        type: 3}
      propertyPath: m_Materials.Array.data[0]
      value:
      objectReference: {fileID: 2100000, guid: 17b28adbacc7582458f9844418586c96,
        type: 2}
    m_RemovedComponents:
    - {fileID: 3706321182809095741, guid: ${GUID},
      type: 3}
    - {fileID: 2432767056347343033, guid: ${GUID}, type: 3}
  m_SourcePrefab: {fileID: 100100000, guid: ${GUID}, type: 3}
`));
  const root = info.overridesByTarget.get(`${GUID}:6808614170226160139`);
  assert.equal(String(root.m_Name), 'screw (1)');
  assert.equal(Number(root.m_IsActive), 0);
  assert.equal(Number(info.overridesByTarget.get(`${GUID}:4592536538088055199`)['m_LocalPosition.y']), 0.1);
  const material = info.overridesByTarget.get(`${GUID}:4107577884502733399`)['m_Materials.Array.data[0]'];
  assert.equal(String(material.guid), '17b28adbacc7582458f9844418586c96');
  assert.deepEqual(info.removedComponentSourceIds.map(String), ['3706321182809095741', '2432767056347343033']);
});

test('a wrapped reference list keeps every entry', () => {
  const ids = parsePrefabInstanceReferenceList(doc(`
  m_Modification:
    m_RemovedGameObjects:
    - {fileID: 919132149155446097, guid: 8c2dd5fd7c4264347bf34d4ae21f097c,
      type: 3}
    - {fileID: -32082535224637221, guid: 8c2dd5fd7c4264347bf34d4ae21f097c, type: 3}
    m_AddedComponents: []
`), 'm_RemovedGameObjects');
  assert.deepEqual(ids.map(String), ['919132149155446097', '-32082535224637221']);
});
