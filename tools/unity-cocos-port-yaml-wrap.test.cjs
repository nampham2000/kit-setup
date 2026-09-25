'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUnityYamlText, parsePrefabInstanceInfo } = require('./unity-cocos-port.cjs');

// Shape of ARPG Effects ARPGDemo03.unity (Unity 6000.3): 19-digit fileIDs make
// Unity wrap flow mappings onto a second line.
const SCENE = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1001 &6544115797360844609
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 197800611}
    m_Modifications:
    - target: {fileID: 6544115798007152704, guid: 917df3afaec917c44bd1968b6079fbbb,
        type: 3}
      propertyPath: m_LocalPosition.x
      value: 4.883
      objectReference: {fileID: 0}
    - target: {fileID: 6544115798007152704, guid: 917df3afaec917c44bd1968b6079fbbb,
        type: 3}
      propertyPath: m_LocalRotation.x
      value: -0.7071068
      objectReference: {fileID: 0}
    - target: {fileID: 6544115798007152705, guid: 917df3afaec917c44bd1968b6079fbbb,
        type: 3}
      propertyPath: m_Name
      value: GroundFog
      objectReference: {fileID: 0}
    m_RemovedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: 917df3afaec917c44bd1968b6079fbbb, type: 3}
--- !u!4 &380110878 stripped
Transform:
  m_CorrespondingSourceObject: {fileID: 6544115798007152704, guid: 917df3afaec917c44bd1968b6079fbbb,
    type: 3}
  m_PrefabInstance: {fileID: 6544115797360844609}
  m_PrefabAsset: {fileID: 0}
--- !u!114 &11400000
MonoBehaviour:
  m_Text: "brace { inside a quoted scalar"
  m_Next: 1
`;

test('wrapped flow mappings stay one logical line per key', () => {
  const docs = parseUnityYamlText(SCENE);
  const stripped = docs.find(doc => doc.stripped);
  const source = stripped.lines.find(line => line.includes('m_CorrespondingSourceObject'));
  assert.match(source, /guid: 917df3afaec917c44bd1968b6079fbbb, type: 3\}$/);
  assert.equal(stripped.lines.some(line => /^\s*type: 3\}\s*$/.test(line)), false, 'continuation line removed');
  const text = docs.find(doc => doc.fileId === '11400000').lines;
  assert.deepEqual(text.filter(line => line.trim()).map(line => line.trim().split(':')[0]), ['MonoBehaviour', 'm_Text', 'm_Next'],
    'a brace inside quotes does not swallow the next key');
});

test('instance overrides with wrapped targets are kept (position, rotation, name)', () => {
  const docs = parseUnityYamlText(SCENE);
  const info = parsePrefabInstanceInfo(docs.find(doc => doc.className === 'PrefabInstance' || doc.classId === 1001));
  assert.equal(info.parentTransformId, '197800611');
  const transform = info.overridesByTarget.get('917df3afaec917c44bd1968b6079fbbb:6544115798007152704');
  assert.ok(transform, 'transform overrides present');
  assert.equal(Number(transform['m_LocalPosition.x']), 4.883);
  assert.equal(Number(transform['m_LocalRotation.x']), -0.7071068);
  assert.equal(info.overridesByTarget.get('917df3afaec917c44bd1968b6079fbbb:6544115798007152705')['m_Name'], 'GroundFog');
});
