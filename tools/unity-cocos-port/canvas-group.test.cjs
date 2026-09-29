'use strict';

// UGUI CanvasGroup (class 225) was skipped as unsupported, so popup panels authored at alpha 0 (Fade overlays)
// rendered opaque and the popup fades had no start state. It ports to cc.UIOpacity.
const assert = require('node:assert/strict');
const test = require('node:test');
const { emitCanvasGroup } = require('../unity-cocos-port.cjs');

function run(lines) {
  const added = [];
  const events = [];
  const builder = { addComponent: (nodeId, type, props, unityId, fileId) => added.push({ nodeId, type, props, unityId, fileId }) };
  const reporter = { low: (code) => events.push(['low', code]), medium: (code) => events.push(['medium', code]) };
  emitCanvasGroup(3, '900', { classId: 225, lines: ['CanvasGroup:', ...lines] }, { name: 'Fade' }, { file: 'Popup.prefab' }, builder, reporter);
  return { added, events };
}

test('CanvasGroup alpha becomes cc.UIOpacity opacity', () => {
  const { added, events } = run(['  m_Alpha: 0', '  m_Interactable: 1', '  m_BlocksRaycasts: 1', '  m_IgnoreParentGroups: 0']);
  assert.deepEqual(added, [{ nodeId: 3, type: 'cc.UIOpacity', props: { _opacity: 0 }, unityId: '900', fileId: 'cmp-ui-opacity-900' }]);
  assert.deepEqual(events, [['low', 'CANVAS_GROUP_UI_OPACITY']]);
  assert.equal(run(['  m_Alpha: 0.5']).added[0].props._opacity, 128);
});

test('non-default input flags are reported, not dropped silently', () => {
  const { events } = run(['  m_Alpha: 1', '  m_Interactable: 0', '  m_BlocksRaycasts: 1', '  m_IgnoreParentGroups: 0']);
  assert.deepEqual(events, [['medium', 'CANVAS_GROUP_INPUT_FLAGS_UNMAPPED']]);
});
