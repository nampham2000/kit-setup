'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  captureUnityBootstrapFootprint,
  rollbackUnityBootstrapFootprint,
  stripAddedMcpDefines,
} = require('./unity-bootstrap-footprint.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-bootstrap-footprint-'));
  for (const directory of ['Assets', 'Packages', 'ProjectSettings']) fs.mkdirSync(path.join(root, directory));
  fs.writeFileSync(path.join(root, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.3.1f1\n');
  fs.writeFileSync(path.join(root, 'Packages', 'packages-lock.json'), '{"before":true}\n');
  fs.writeFileSync(path.join(root, 'ProjectSettings', 'ProjectSettings.asset'), [
    'PlayerSettings:',
    '  scriptingDefineSymbols:',
    '    WebGL: DOTWEEN',
    '    Android: KEEP;UNITY_MCP_READY',
    '  scriptingBackend: {}',
    '',
  ].join('\n'));
  return root;
}

test('define cleanup removes only MCP gates added by this bootstrap', () => {
  const source = [
    '  scriptingDefineSymbols:',
    '    WebGL: KEEP;UNITY_MCP_READY;UNITY_MCP_DEPS_2;LAST',
    '    Android: UNITY_MCP_DEPS_2',
    '  scriptingBackend: {}',
  ].join('\n');
  const result = stripAddedMcpDefines(source, ['UNITY_MCP_READY']);
  assert.match(result, /WebGL: KEEP;UNITY_MCP_READY;LAST/);
  assert.match(result, /Android: $/m);
  assert.doesNotMatch(result, /UNITY_MCP_DEPS_2/);
});

test('rollback restores packages-lock and removes only newly generated reserved NuGet footprint/defines', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = captureUnityBootstrapFootprint(root);
  fs.writeFileSync(path.join(root, 'Packages', 'packages-lock.json'), '{"after":true}\n');
  const nuget = path.join(root, 'Assets', 'Plugins', 'NuGet');
  fs.mkdirSync(nuget, { recursive: true });
  fs.writeFileSync(path.join(nuget, '.nuget-installed.json'), '{}');
  fs.writeFileSync(`${nuget}.meta`, 'generated');
  const settings = path.join(root, 'ProjectSettings', 'ProjectSettings.asset');
  fs.writeFileSync(settings, fs.readFileSync(settings, 'utf8')
    .replace('WebGL: DOTWEEN', 'WebGL: DOTWEEN;UNITY_MCP_READY;UNITY_MCP_DEPS_2'));

  const result = rollbackUnityBootstrapFootprint(before);
  assert.equal(result.complete, true);
  assert.equal(fs.readFileSync(path.join(root, 'Packages', 'packages-lock.json'), 'utf8'), '{"before":true}\n');
  assert.equal(fs.existsSync(nuget), false);
  assert.equal(fs.existsSync(`${nuget}.meta`), false);
  const restoredSettings = fs.readFileSync(settings, 'utf8');
  assert.match(restoredSettings, /Android: KEEP;UNITY_MCP_READY/);
  assert.doesNotMatch(restoredSettings, /UNITY_MCP_DEPS_2/);
  assert.match(restoredSettings, /WebGL: DOTWEEN$/m);
});

test('pre-existing NuGet directory is preserved on rollback', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nuget = path.join(root, 'Assets', 'Plugins', 'NuGet');
  fs.mkdirSync(nuget, { recursive: true });
  fs.writeFileSync(path.join(nuget, 'user.dll'), 'before');
  const before = captureUnityBootstrapFootprint(root);
  fs.writeFileSync(path.join(nuget, 'new.dll'), 'package');
  const result = rollbackUnityBootstrapFootprint(before);
  assert.equal(result.complete, true);
  assert.equal(fs.existsSync(path.join(nuget, 'user.dll')), true);
  assert.equal(fs.existsSync(path.join(nuget, 'new.dll')), true);
  assert.equal(result.steps.nugetDirectory, 'unchanged');
});
