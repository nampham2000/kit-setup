'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { collectSchema } = require('./cocos-mcp-schema-refresh.cjs');

test('offline Cocos MCP schema includes portable feature repair and preview reload tools', () => {
  const tools = collectSchema();
  const names = tools.map(tool => tool.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('engineFeature_get_features'));
  assert.ok(names.includes('engineFeature_ensure_features'));
  assert.ok(names.includes('editorRuntime_reload_preview'));
});
