'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSimpleAnimatorControllerText } = require('./animator-controller-shape');
const { detectUnityEngineFeatureEvidence } = require('../unity-intel/engine-feature-closure.cjs');

function controller({ states = 1, transitions = 0, parameters = '[]', speed = 1, layers = 1, blend = false } = {}) {
  const layerEntries = Array.from({ length: layers }, () => '  - serializedVersion: 5\n    m_Name: Base Layer\n').join('');
  let text = `%YAML 1.1
--- !u!91 &9100000
AnimatorController:
  m_Name: Test
  serializedVersion: 5
  m_AnimatorParameters: ${parameters}
  m_AnimatorLayers:
${layerEntries}--- !u!1107 &1
AnimatorStateMachine:
  m_AnyStateTransitions: []
  m_EntryTransitions: []
`;
  for (let i = 0; i < states; i++) text += `--- !u!1102 &${10 + i}\nAnimatorState:\n  m_Speed: ${speed}\n  m_SpeedParameterActive: 0\n`;
  for (let i = 0; i < transitions; i++) text += `--- !u!1101 &${20 + i}\nAnimatorStateTransition:\n  m_Name: t\n`;
  if (blend) text += '--- !u!206 &30\nBlendTree:\n  m_Name: b\n';
  return text;
}

test('single-state controllers without transitions or parameters are simple', () => {
  assert.equal(isSimpleAnimatorControllerText(controller()), true);
  assert.equal(isSimpleAnimatorControllerText(controller({ states: 0 })), true, 'a state-less controller animates nothing');
});

test('anything that can change state or speed keeps the AnimationController path', () => {
  assert.equal(isSimpleAnimatorControllerText(controller({ states: 2 })), false);
  assert.equal(isSimpleAnimatorControllerText(controller({ transitions: 1 })), false);
  assert.equal(isSimpleAnimatorControllerText(controller({ parameters: '\n  - m_Name: Open' })), false);
  assert.equal(isSimpleAnimatorControllerText(controller({ speed: 2 })), false);
  assert.equal(isSimpleAnimatorControllerText(controller({ layers: 2 })), false);
  assert.equal(isSimpleAnimatorControllerText(controller({ blend: true })), false);
});

test('engine feature closure only asks marionette for non-simple controllers', () => {
  const simple = detectUnityEngineFeatureEvidence({ assetPath: 'Assets/a.controller', extension: '.controller', text: controller() });
  const complex = detectUnityEngineFeatureEvidence({ assetPath: 'Assets/b.controller', extension: '.controller', text: controller({ transitions: 1 }) });
  const text = JSON.stringify;
  assert.match(text(simple), /animator-simple/);
  assert.doesNotMatch(text(simple), /"animator-controller"/);
  assert.match(text(complex), /animator-controller/);
});
