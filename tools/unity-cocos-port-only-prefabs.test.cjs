'use strict';

// Folder batches can be limited to an explicit prefab list (`--only-prefabs`), so one process (and
// one UnityAssetDatabase load, ~500 MB) ports a large curated set such as every level prefab a
// MapConfig references, without porting the unused prefabs that share the folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseArgs, buildPrefabBatchPlan } = require('./unity-cocos-port.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'only-prefabs-'));
  const src = path.join(root, 'Assets', 'Levels');
  fs.mkdirSync(path.join(src, 'Old'), { recursive: true });
  for (const name of ['Level_1.prefab', 'Level_2.prefab', 'Level_3.prefab', 'Old/Level_1.prefab']) {
    fs.writeFileSync(path.join(src, name), '%YAML 1.1\n');
  }
  return { root, src, out: path.join(root, 'out') };
}

function plan(args) {
  const options = parseArgs(['port', ...args]);
  return buildPrefabBatchPlan(options).map(entry => entry.relative);
}

test('comma list keeps base-name matches only', () => {
  const { src, out } = fixture();
  assert.deepEqual(plan(['--src', src, '--out', out, '--only-prefabs', 'Level_3,Level_2']), ['Level_2.prefab', 'Level_3.prefab']);
});

test('a relative path selects one of two same-named prefabs; a base name selects both', () => {
  const { src, out } = fixture();
  assert.deepEqual(plan(['--src', src, '--out', out, '--only-prefabs', 'Old/Level_1']), ['Old/Level_1.prefab']);
  assert.deepEqual(plan(['--src', src, '--out', out, '--only-prefabs', 'Level_1']), ['Level_1.prefab', 'Old/Level_1.prefab']);
});

test('@file accepts a JSON array or one name per line', () => {
  const { root, src, out } = fixture();
  const json = path.join(root, 'list.json');
  fs.writeFileSync(json, JSON.stringify(['Level_1.prefab', 'Level_3']));
  assert.deepEqual(plan(['--src', src, '--out', out, '--only-prefabs', `@${json}`]), ['Level_1.prefab', 'Level_3.prefab', 'Old/Level_1.prefab']);
  const lines = path.join(root, 'list.txt');
  fs.writeFileSync(lines, 'Level_2\r\n\r\nOld/Level_1\r\n');
  assert.deepEqual(plan(['--src', src, '--out', out, '--only-prefabs', `@${lines}`]), ['Level_2.prefab', 'Old/Level_1.prefab']);
});
