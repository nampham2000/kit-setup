'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sharedUnityMcpInstallState, shouldAutoBootstrap } = require('./shared-mcp-install-state.cjs');

function project(dependencies) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-mcp-state-'));
  fs.mkdirSync(path.join(root, 'Packages'));
  if (dependencies) fs.writeFileSync(path.join(root, 'Packages', 'manifest.json'), JSON.stringify({ dependencies }));
  return root;
}

test('a third-party Unity MCP does not count as the shared scanner', () => {
  const state = sharedUnityMcpInstallState(project({ 'com.unity.ai.assistant': '2.8.0-pre.1' }));
  assert.equal(state.installed, false);
  assert.deepEqual(state.thirdPartyMcp, ['com.unity.ai.assistant']);
  assert.equal(shouldAutoBootstrap({ command: 'preflight', provider: 'auto' }, state), true);
  assert.equal(shouldAutoBootstrap({ command: 'scan', provider: 'unity-mcp' }, state), true);
});

test('auto-install stays off when opted out, static, already declared or unreadable', () => {
  const missing = sharedUnityMcpInstallState(project({}));
  assert.equal(shouldAutoBootstrap({ command: 'preflight', provider: 'auto', noBootstrap: true }, missing), false);
  assert.equal(shouldAutoBootstrap({ command: 'preflight', provider: 'static' }, missing), false);
  assert.equal(shouldAutoBootstrap({ command: 'query', provider: 'auto' }, missing), false);
  const declared = sharedUnityMcpInstallState(project({
    'com.ccplayable.unity-intelligence': 'file:x', 'com.ivanmurzak.unity.mcp': 'https://example.invalid',
  }));
  assert.equal(declared.installed, true);
  assert.equal(shouldAutoBootstrap({ command: 'preflight', provider: 'auto' }, declared), false);
  const unreadable = sharedUnityMcpInstallState(project(null));
  assert.equal(unreadable.manifestReadable, false);
  assert.equal(shouldAutoBootstrap({ command: 'preflight', provider: 'auto' }, unreadable), false);
});

test('only the scanner half declared is still missing', () => {
  const state = sharedUnityMcpInstallState(project({ 'com.ccplayable.unity-intelligence': 'file:x' }));
  assert.equal(state.installed, false);
  assert.equal(state.upstreamDeclared, false);
});
