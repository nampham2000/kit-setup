'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createAnimationPorter = require('./animation-porter');

function createPorter(stateSpeed) {
  const docs = [
    { classId: 91, fileId: '1', lines: [], fields: { m_Name: 'Tutorial' } },
    {
      classId: 1107,
      fileId: '2',
      lines: ['m_ChildStates:', '  - m_State: {fileID: 42}'],
      fields: { m_DefaultState: { fileID: '42' } },
    },
    {
      classId: 1102,
      fileId: '42',
      lines: [],
      fields: {
        m_Name: 'TutorialMotion',
        ...(stateSpeed == null ? {} : { m_Speed: stateSpeed }),
        m_Motion: { fileID: '7400000', guid: 'clip-guid' },
      },
    },
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
    getNestedList: () => [],
  });
}

for (const [label, sourceSpeed, expectedSpeed] of [
  ['authored', 0.65, 0.65],
  ['default', null, 1],
]) {
  test(`preserves ${label} Unity Animator state speed in the Cocos motion state`, () => {
    const porter = createPorter(sourceSpeed);
    const controller = porter.parseUnityAnimatorController('unused.controller');
    const clipInfo = new Map([['42', { name: 'TutorialClip', uuid: 'clip-uuid' }]]);
    const graph = porter.buildCocosAnimationGraph(controller, clipInfo);
    const motion = graph.find((entry) => entry.__type__ === 'cc.animation.Motion');
    assert.equal(controller.states.get('42').speed, expectedSpeed);
    assert.equal(motion.speed, expectedSpeed);
  });
}
