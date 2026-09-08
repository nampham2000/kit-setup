'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const createScriptPorter = require('./script-porter');

function getField(doc, key, fallback) {
  return Object.prototype.hasOwnProperty.call(doc.fields || {}, key) ? doc.fields[key] : fallback;
}

function hasField(doc, key) {
  return Object.prototype.hasOwnProperty.call(doc.fields || {}, key);
}

test('maps legacy Unity Text Best Fit using m_MaxSize', () => {
  const porter = createScriptPorter({ getField, hasField });
  const sizing = porter.resolveUnityLabelSizing({ fields: {
    m_FontData: {
      m_FontSize: 22,
      m_BestFit: 1,
      m_MinSize: 8,
      m_MaxSize: 96,
      m_LineSpacing: 1,
    },
  } });

  assert.deepEqual(sizing, {
    autoSizing: true,
    fontSize: 96,
    lineHeight: 96,
    overflow: 2,
  });
});
