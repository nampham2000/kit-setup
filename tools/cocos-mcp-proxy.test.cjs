'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { applyToolProfile, mergeToolLists } = require('./cocos-mcp-proxy.cjs');

test('port profile exposes feature repair and preview reload without unrelated tools', () => {
  const previous = process.env.COCOS_MCP_PROFILE;
  process.env.COCOS_MCP_PROFILE = 'port';
  try {
    const tools = [
      { name: 'scene_get_current_scene' },
      { name: 'engineFeature_ensure_features' },
      { name: 'editorRuntime_reload_preview' },
      { name: 'broadcast_send_message' },
    ];
    const names = applyToolProfile(tools).map(tool => tool.name);
    assert.deepEqual(names, [
      'scene_get_current_scene',
      'engineFeature_ensure_features',
      'editorRuntime_reload_preview',
    ]);
  } finally {
    if (previous === undefined) delete process.env.COCOS_MCP_PROFILE;
    else process.env.COCOS_MCP_PROFILE = previous;
  }
});

test('canonical schema survives an older live cache while live-only tools remain available', () => {
  const canonical = [
    { name: 'engineFeature_ensure_features', description: 'released' },
    { name: 'editorRuntime_reload_preview' },
  ];
  const oldLive = [
    { name: 'engineFeature_ensure_features', description: 'stale' },
    { name: 'project_live_only' },
  ];
  assert.deepEqual(mergeToolLists(canonical, oldLive), [
    { name: 'engineFeature_ensure_features', description: 'released' },
    { name: 'project_live_only' },
    { name: 'editorRuntime_reload_preview' },
  ]);
});
