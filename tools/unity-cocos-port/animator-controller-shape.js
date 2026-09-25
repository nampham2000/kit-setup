'use strict';

// An AnimatorController with one layer, at most one state, no transitions,
// no parameters, no blend trees and unit speed only ever plays its default
// clip. Cocos cc.Animation (module `animation`) reproduces that exactly, so
// such controllers need neither an AnimationGraph nor the `marionette`
// module. Anything else keeps the full AnimationController path.
function docCount(text, classId) {
  return (String(text).match(new RegExp(`^--- !u!${classId} `, 'gm')) || []).length;
}

function isSimpleAnimatorControllerText(text) {
  const source = String(text || '');
  if (!/^AnimatorController:/m.test(source)) return false;
  const layers = (/m_AnimatorLayers:\s*\n((?:\s+-[\s\S]*?)(?=\n\S|$))/.exec(source)?.[1].match(/^\s*- serializedVersion:/gm) || []).length;
  return docCount(source, 1107) === 1
    && docCount(source, 1102) <= 1
    && docCount(source, 1101) === 0
    && docCount(source, 1109) === 0
    && docCount(source, 206) === 0
    && layers <= 1
    && /m_AnimatorParameters:\s*\[\]/.test(source)
    && /m_AnyStateTransitions:\s*\[\]/.test(source)
    && /m_EntryTransitions:\s*\[\]/.test(source)
    && !/m_SpeedParameterActive:\s*1/.test(source)
    && !/^\s*m_Speed:\s*(?!1(?:\.0+)?\s*$)\S+/m.test(source);
}

module.exports = { isSimpleAnimatorControllerText };
