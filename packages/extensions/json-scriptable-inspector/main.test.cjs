'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const extension = require('./main.js');

function createFixture() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'json-inspector-fragments-'));
  const resources = path.join(project, 'assets', 'resources');
  const fragments = path.join(resources, 'playable-config');
  fs.mkdirSync(fragments, { recursive: true });
  const manifestFile = path.join(resources, 'playable-config.json');
  fs.writeFileSync(manifestFile, JSON.stringify({
    title: 'Fragmented',
    gameplay: { difficulty: 'normal' },
    $fragments: {
      cta: 'playable-config/cta',
      'custom.levels': 'playable-config/levels',
    },
  }));
  fs.writeFileSync(path.join(fragments, 'cta.json'), JSON.stringify({ googlePlayUrl: 'old' }));
  fs.writeFileSync(path.join(fragments, 'levels.json'), JSON.stringify([{ id: 1 }]));
  return { project, manifestFile, fragments };
}

test('readCompositeFile presents all fragment data as one config', () => {
  const fixture = createFixture();
  try {
    const result = extension.__test.readCompositeFile(fixture.manifestFile);
    assert.equal(result.merged.cta.googlePlayUrl, 'old');
    assert.deepEqual(result.merged.custom.levels, [{ id: 1 }]);
    assert.equal(result.entries.length, 2);
  } finally {
    fs.rmSync(fixture.project, { recursive: true, force: true });
  }
});

test('writeCompositeFile saves edits back to their owning files', () => {
  const fixture = createFixture();
  try {
    const result = extension.__test.readCompositeFile(fixture.manifestFile);
    result.merged.cta.googlePlayUrl = 'new';
    result.merged.custom.levels.push({ id: 2 });
    result.merged.gameplay.difficulty = 'hard';
    const saved = extension.__test.writeCompositeFile(fixture.manifestFile, result.merged);

    assert.equal(saved.fragmentCount, 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.fragments, 'cta.json'), 'utf8')), {
      googlePlayUrl: 'new',
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.fragments, 'levels.json'), 'utf8')), [
      { id: 1 },
      { id: 2 },
    ]);
    const root = JSON.parse(fs.readFileSync(fixture.manifestFile, 'utf8'));
    assert.equal(root.cta, undefined);
    assert.equal(root.custom?.levels, undefined);
    assert.equal(root.gameplay.difficulty, 'hard');
  } finally {
    fs.rmSync(fixture.project, { recursive: true, force: true });
  }
});

test('editor save refreshes every fragment asset after writing', async () => {
  const fixture = createFixture();
  const calls = [];
  global.Editor = {
    Message: {
      request: async (channel, method, value) => {
        calls.push({ channel, method, value });
        if (method === 'query-asset-info') {
          return { uuid: 'config-uuid', file: fixture.manifestFile, name: 'playable-config.json' };
        }
        return null;
      },
    },
  };
  try {
    const merged = extension.__test.readCompositeFile(fixture.manifestFile).merged;
    const result = await extension.methods.saveJsonAsset('config-uuid', JSON.stringify(merged));
    assert.equal(result.success, true);
    assert.equal(result.fragmentCount, 2);
    assert.deepEqual(
      calls.filter(call => call.method === 'refresh-asset').map(call => call.value).sort(),
      [
        'db://assets/resources/playable-config/cta.json',
        'db://assets/resources/playable-config/levels.json',
      ],
    );
  } finally {
    delete global.Editor;
    fs.rmSync(fixture.project, { recursive: true, force: true });
  }
});

test('a missing requested UUID never falls back to the current selection', async () => {
  const fixture = createFixture();
  const queried = [];
  global.Editor = {
    Selection: { getLastSelected: () => 'current-selection-uuid' },
    Message: {
      request: async (_channel, method, value) => {
        if (method === 'query-asset-info') {
          queried.push(value);
          if (value === 'current-selection-uuid') {
            return { uuid: value, file: fixture.manifestFile, name: 'playable-config.json' };
          }
          return null;
        }
        return null;
      },
    },
  };
  try {
    const result = await extension.methods.saveJsonAsset('stale-fragment-uuid', '{"audio":true}');
    assert.equal(result.success, true);
    assert.deepEqual(queried, ['stale-fragment-uuid']);
    assert.equal(JSON.parse(fs.readFileSync(fixture.manifestFile, 'utf8')).title, 'Fragmented');
  } finally {
    delete global.Editor;
    fs.rmSync(fixture.project, { recursive: true, force: true });
  }
});
