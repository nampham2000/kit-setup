'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseArgs, scanInput } = require('./unity-intel-cli.cjs');

test('scan defaults to auto read-only provider and validates compact query controls', () => {
  const parsed = parseArgs(['scan', '--project', 'D:/Game', '--section', 'features', '--limit', '25']);
  assert.equal(parsed.command, 'scan');
  assert.equal(parsed.provider, 'auto');
  assert.equal(parsed.bootstrap, undefined);
  assert.equal(parsed.limit, 25);
  const input = scanInput(parsed);
  assert.equal(input.bootstrap, false);
  assert.equal(input.cache, true);
});

test('setup is the explicit write boundary and selects strict Unity-MCP', () => {
  const parsed = parseArgs(['setup', '--project=D:/Game', '--unity', 'D:/Unity/Unity.exe']);
  assert.equal(parsed.bootstrap, true);
  assert.equal(parsed.provider, 'unity-mcp');
  assert.equal(parsed.unity, 'D:/Unity/Unity.exe');
});

test('parser rejects accidental unbounded pages and unknown providers', () => {
  assert.throws(() => parseArgs(['query', '--project', 'D:/Game', '--limit', '201']), /1\.\.200/);
  assert.throws(() => parseArgs(['scan', '--project', 'D:/Game', '--provider', 'cloud']), /auto/);
  assert.throws(() => parseArgs(['query', '--project', 'D:/Game', '--section', 'raw-yaml']), /không hỗ trợ/);
});
