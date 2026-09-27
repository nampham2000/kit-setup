'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const createAnimationPorter = require('./animation-porter');

// Hovl "Toon VFX 2.controller": HS_DemoToonVFX drives SetInteger("toDo", n) and every
// transition compares toDo Equals n. Mapping every parameter to a trigger left the
// hero in its entry state forever.
function createPorter() {
  const docs = [
    { classId: 91, fileId: '1', fields: { m_Name: 'Toon VFX 2' }, lines: [
      'm_AnimatorParameters:', '  - m_Name: toDo', '    m_Type: 3', '    m_DefaultInt: 2',
      '  - m_Name: fire', '    m_Type: 9', '  - m_Name: armed', '    m_Type: 4', '    m_DefaultBool: 1', '  - m_Name: heat', '    m_Type: 1', '    m_DefaultFloat: 0.5'] },
    { classId: 1107, fileId: '2', fields: { m_DefaultState: { fileID: '42' } }, lines: ['m_ChildStates:', '  - m_State: {fileID: 42}', '  - m_State: {fileID: 43}'] },
    { classId: 1102, fileId: '42', lines: [], fields: { m_Name: 'Standing', m_Motion: { fileID: '7400000', guid: 'stand' }, m_Transitions: [{ fileID: 't1' }, { fileID: 't2' }, { fileID: 't3' }, { fileID: 't4' }] } },
    { classId: 1102, fileId: '43', lines: [], fields: { m_Name: 'Laser', m_Motion: { fileID: '7400000', guid: 'laser' } } },
    { classId: 1101, fileId: 't1', fields: { m_DstState: { fileID: '43' }, m_TransitionDuration: 0.25 }, lines: ['m_Conditions:', '  - m_ConditionMode: 6', '    m_ConditionEvent: toDo', '    m_EventTreshold: 4'] },
    { classId: 1101, fileId: 't2', fields: { m_DstState: { fileID: '43' } }, lines: ['m_Conditions:', '  - m_ConditionMode: 1', '    m_ConditionEvent: fire', '    m_EventTreshold: 0'] },
    { classId: 1101, fileId: 't3', fields: { m_DstState: { fileID: '43' } }, lines: ['m_Conditions:', '  - m_ConditionMode: 2', '    m_ConditionEvent: armed', '    m_EventTreshold: 0'] },
    { classId: 1101, fileId: 't4', fields: { m_DstState: { fileID: '43' } }, lines: ['m_Conditions:', '  - m_ConditionMode: 3', '    m_ConditionEvent: heat', '    m_EventTreshold: 0.75'] },
  ];
  return createAnimationPorter({
    parseUnityYaml: () => docs,
    getField: (doc, key, fallback) => doc.fields?.[key] ?? fallback,
    parseUnityScalar: (value) => {
      const fileId = String(value).match(/fileID:\s*([^}\s]+)/)?.[1];
      return fileId ? { fileID: fileId } : value;
    },
    unityRefGuid: (value) => value?.guid || '',
    unityRefFileId: (value) => String(value?.fileID || ''),
    ensureDirectoryMetas: () => {},
    getNestedList: (doc, key) => doc.fields?.[key] || [],
  });
}

test('Unity animator parameters keep their type in the Cocos animation graph', () => {
  const porter = createPorter();
  const controller = porter.parseUnityAnimatorController('unused.controller');
  const graph = porter.buildCocosAnimationGraph(controller, new Map([['42', { name: 'Standing', uuid: 'a' }], ['43', { name: 'Laser', uuid: 'b' }]]));
  const variables = graph[0]._variables;
  assert.deepEqual(variables.toDo, { __type__: 'cc.animation.PlainVariable', _type: 3, _value: 2 });
  assert.deepEqual(variables.fire, { __type__: 'cc.animation.TriggerVariable', _flags: 0 });
  assert.deepEqual(variables.armed, { __type__: 'cc.animation.PlainVariable', _type: 1, _value: true });
  assert.deepEqual(variables.heat, { __type__: 'cc.animation.PlainVariable', _type: 0, _value: 0.5 });
  const conditions = graph.filter((o) => o.__type__ === 'cc.animation.AnimationTransition').map((t) => t.conditions[0]);
  assert.deepEqual(conditions, [
    { __type__: 'cc.animation.BinaryCondition', operator: 0, lhs: 0, lhsBinding: { __type__: 'cc.animation.TCVariableBinding', type: 3, variableName: 'toDo' }, rhs: 4 },
    { __type__: 'cc.animation.TriggerCondition', trigger: 'fire' },
    { __type__: 'cc.animation.UnaryCondition', operator: 1, operand: { __type__: 'cc.animation.BindableBoolean', variable: 'armed', value: false } },
    { __type__: 'cc.animation.BinaryCondition', operator: 4, lhs: 0, lhsBinding: { __type__: 'cc.animation.TCVariableBinding', type: 0, variableName: 'heat' }, rhs: 0.75 },
  ]);
});
