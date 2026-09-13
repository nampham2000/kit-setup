'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchingEditors, assertProjectClosed } = require('./cocos-build-preflight.cjs');
test('build ownership matches exact project paths, not sibling names', () => {
  const rows = [
    { ProcessId: 1, CommandLine: 'CocosCreator.exe --project "D:/Games/My Game"' },
    { ProcessId: 2, CommandLine: 'CocosCreator.exe --project "D:/Games/My Game Other"' },
    { ProcessId: 3, CommandLine: 'CocosCreator.exe --type=renderer' },
  ];
  assert.deepEqual(matchingEditors(rows, 'd:\\games\\my game\\').map(row => row.ProcessId), [1]);
});
test('CLI build fails before launch for its own open project, permits foreign editors', () => {
  const spawnSync = () => ({ status: 0, stdout: JSON.stringify({ ProcessId: 42, CommandLine: 'CocosCreator.exe --project D:/Game' }) });
  assert.throws(() => assertProjectClosed('D:/Game', { platform: 'win32', spawnSync }), /Save and close.*42/);
  assert.doesNotThrow(() => assertProjectClosed('D:/Other', { platform: 'win32', spawnSync }));
});
