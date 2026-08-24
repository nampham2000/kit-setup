'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { extractGuidReferences, isBuiltinGuid } = require('./guid-index.cjs');

const ASSET = 'a'.repeat(32);
const INTERNAL = 'b'.repeat(32);

test('dependency extraction accepts PPtr evidence and ignores internal bare GUID fields', () => {
  const text = [
    'AudioMixerController:',
    `  m_GroupID: {guid: ${INTERNAL}}`,
    `  m_Material: {fileID: 2100000, guid: ${ASSET}, type: 2}`,
  ].join('\n');
  const refs = extractGuidReferences(text);
  assert.deepEqual(refs.map(item => item.guid), [ASSET]);
  assert.equal(refs[0].kind, 'material');
});

test('dependency extraction supports a multiline PPtr mapping', () => {
  const refs = extractGuidReferences([
    '  m_Script:',
    '    fileID: 11500000',
    `    guid: ${ASSET}`,
    '    type: 3',
  ].join('\n'));
  assert.equal(refs.length, 1);
  assert.equal(refs[0].guid, ASSET);
});

test('dependency extraction rejects list GUIDs even when an unrelated fileID is nearby', () => {
  const refs = extractGuidReferences([
    '  m_EffectParameters:',
    '  - {fileID: 24300002}',
    '  m_ExposedParameters:',
    `  - guid: ${INTERNAL}`,
    '    name: BgmVolume',
  ].join('\n'));
  assert.deepEqual(refs, []);
});

test('null and Unity built-in GUIDs are classified as non-missing externals', () => {
  assert.equal(isBuiltinGuid('0'.repeat(32)), true);
  assert.equal(isBuiltinGuid('0000000000000000f000000000000000'), true);
});
