'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

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

test('persisted GUID and fileID evidence does not retain large source buffers', () => {
  const script = `
    const assert = require('node:assert/strict');
    const api = require(${JSON.stringify(require.resolve('./guid-index.cjs'))});
    global.gc();
    const baseline = process.memoryUsage().heapUsed;
    function parse() {
      const guid = 'abcdef1234567890abcdef1234567890';
      const padding = 'a'.repeat(24 * 1024 * 1024);
      const yaml = '--- !u!1 &1234567890123456789\\nGameObject:\\n  data: ' + padding
        + '\\n  m_Material: {fileID: 2100000, guid: ' + guid + ', type: 2}\\n';
      return {
        refs: api.extractGuidReferences(yaml),
        guids: api.extractReferencedGuids(yaml),
        meta: api.extractGuidFromMeta('guid: ' + guid + '\\nuserData: ' + padding),
      };
    }
    const result = parse();
    // Clear V8's last-match subject, which is separate from retained records.
    /reset/.test('reset');
    global.gc();
    const retained = process.memoryUsage().heapUsed - baseline;
    assert.ok(retained < 8 * 1024 * 1024, 'retained source bytes: ' + retained);
    assert.equal(result.refs[0].objectId, '1234567890123456789');
    assert.equal(result.refs[0].fieldPath, 'GameObject.m_Material');
    assert.equal(result.refs[0].guid, result.meta);
    assert.deepEqual(result.guids, [result.meta]);
  `;
  const child = spawnSync(process.execPath, ['--expose-gc', '-e', script], { encoding: 'utf8', timeout: 15000 });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
});
