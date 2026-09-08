'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  composeConfig,
  loadMergedConfigFromFile,
  splitMergedConfig,
  validateFragmentMap,
} = require('./config-fragments.cjs');

test('fragment values mount into one merged playable config', () => {
  const manifest = {
    title: 'Example',
    gameplay: { difficulty: 'normal' },
    $fragments: {
      cta: 'playable-config/cta',
      'custom.levels': 'playable-config/levels',
    },
  };
  const values = {
    cta: { googlePlayUrl: 'https://example.test' },
    'custom.levels': [{ id: 1 }, { id: 2 }],
  };
  const { merged } = composeConfig(manifest, entry => values[entry.target]);
  assert.equal(merged.cta.googlePlayUrl, 'https://example.test');
  assert.deepEqual(merged.custom.levels, [{ id: 1 }, { id: 2 }]);
  assert.equal(merged.gameplay.difficulty, 'normal');
});

test('splitting a merged config sends each mounted subtree back to its source', () => {
  const merged = {
    title: 'Example',
    cta: { googlePlayUrl: 'changed' },
    custom: { levels: [{ id: 3 }], inline: true },
    $fragments: {
      cta: 'playable-config/cta',
      'custom.levels': 'playable-config/levels',
    },
  };
  const { root, fragments } = splitMergedConfig(merged);
  assert.equal(root.cta, undefined);
  assert.equal(root.custom.levels, undefined);
  assert.equal(root.custom.inline, true);
  assert.deepEqual(fragments.map(item => item.value), [
    { googlePlayUrl: 'changed' },
    [{ id: 3 }],
  ]);
});

test('file loader resolves fragments relative to assets/resources', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'playable-config-fragments-'));
  try {
    const resources = path.join(tempRoot, 'assets', 'resources');
    const fragmentDir = path.join(resources, 'playable-config');
    fs.mkdirSync(fragmentDir, { recursive: true });
    fs.writeFileSync(path.join(resources, 'playable-config.json'), JSON.stringify({
      $fragments: { audio: 'playable-config/audio' },
    }));
    fs.writeFileSync(path.join(fragmentDir, 'audio.json'), JSON.stringify({ sfxVolume: 0.5 }));

    const result = loadMergedConfigFromFile(path.join(resources, 'playable-config.json'));
    assert.equal(result.merged.audio.sfxVolume, 0.5);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('overlapping targets and traversal paths are rejected', () => {
  assert.throws(() => validateFragmentMap({
    custom: 'playable-config/custom',
    'custom.levels': 'playable-config/levels',
  }), /Overlapping/);
  assert.throws(() => validateFragmentMap({ custom: '../outside' }), /Invalid/);
  assert.throws(() => validateFragmentMap({ 'custom..levels': 'playable-config/levels' }), /Invalid/);
  assert.throws(() => validateFragmentMap({
    cta: 'playable-config/shared',
    audio: 'playable-config/shared',
  }), /more than one owner/);
});
