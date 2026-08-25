'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  captureUnityBootstrapFootprint,
  rollbackUnityBootstrapFootprint,
  sealUnityBootstrapFootprint,
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

  const sealed = sealUnityBootstrapFootprint(before);
  const result = rollbackUnityBootstrapFootprint(sealed, { ownershipConfirmed: true });
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
  const sealed = sealUnityBootstrapFootprint(before);
  const result = rollbackUnityBootstrapFootprint(sealed, { ownershipConfirmed: true });
  assert.equal(result.complete, true);
  assert.equal(fs.existsSync(path.join(nuget, 'user.dll')), true);
  assert.equal(fs.existsSync(path.join(nuget, 'new.dll')), true);
  assert.equal(result.steps.nugetDirectory, 'unchanged');
});

test('default rollback preserves artifacts created during the ambiguous capture-to-seal window', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = captureUnityBootstrapFootprint(root);
  const lock = path.join(root, 'Packages', 'packages-lock.json');
  fs.writeFileSync(lock, '{"possibly-concurrent":true}\n');
  const nuget = path.join(root, 'Assets', 'Plugins', 'NuGet');
  fs.mkdirSync(nuget, { recursive: true });
  fs.writeFileSync(path.join(nuget, 'user.dll'), 'user');
  const sealed = sealUnityBootstrapFootprint(before);

  const result = rollbackUnityBootstrapFootprint(sealed);
  assert.equal(result.complete, false);
  assert.equal(result.phase, 'ownership');
  assert.equal(result.errors[0].code, 'UNITY_BOOTSTRAP_FOOTPRINT_OWNERSHIP_AMBIGUOUS');
  assert.equal(fs.readFileSync(lock, 'utf8'), '{"possibly-concurrent":true}\n');
  assert.equal(fs.readFileSync(path.join(nuget, 'user.dll'), 'utf8'), 'user');
});

test('rollback preserves package lock and NuGet files changed after the owned footprint was sealed', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = captureUnityBootstrapFootprint(root);
  const lock = path.join(root, 'Packages', 'packages-lock.json');
  fs.writeFileSync(lock, '{"owned":true}\n');
  const nuget = path.join(root, 'Assets', 'Plugins', 'NuGet');
  fs.mkdirSync(nuget, { recursive: true });
  fs.writeFileSync(path.join(nuget, 'owned.dll'), 'owned');
  const sealed = sealUnityBootstrapFootprint(before);

  fs.writeFileSync(lock, '{"user":true}\n');
  fs.writeFileSync(path.join(nuget, 'user.dll'), 'user');
  const result = rollbackUnityBootstrapFootprint(sealed, { ownershipConfirmed: true });
  assert.equal(result.complete, false);
  assert.equal(result.steps.packagesLock, 'UNITY_BOOTSTRAP_FOOTPRINT_CONFLICT');
  assert.equal(result.steps.nugetDirectory, 'UNITY_BOOTSTRAP_FOOTPRINT_CONFLICT');
  assert.equal(fs.readFileSync(lock, 'utf8'), '{"user":true}\n');
  assert.equal(fs.readFileSync(path.join(nuget, 'user.dll'), 'utf8'), 'user');
});

test('rollback validates every artifact before mutating when Plugins.meta changed after seal', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = captureUnityBootstrapFootprint(root);
  const lock = path.join(root, 'Packages', 'packages-lock.json');
  const plugins = path.join(root, 'Assets', 'Plugins');
  const nuget = path.join(plugins, 'NuGet');
  const settings = path.join(root, 'ProjectSettings', 'ProjectSettings.asset');
  fs.writeFileSync(lock, '{"owned":true}\n');
  fs.mkdirSync(nuget, { recursive: true });
  fs.writeFileSync(path.join(nuget, 'owned.dll'), 'owned');
  fs.writeFileSync(`${nuget}.meta`, 'owned-nuget-meta');
  fs.writeFileSync(`${plugins}.meta`, 'owned-plugins-meta');
  fs.writeFileSync(settings, fs.readFileSync(settings, 'utf8')
    .replace('WebGL: DOTWEEN', 'WebGL: DOTWEEN;UNITY_MCP_READY;UNITY_MCP_DEPS_2'));
  const sealed = sealUnityBootstrapFootprint(before);

  fs.writeFileSync(`${plugins}.meta`, 'user-plugins-meta');
  const settingsAfterSeal = fs.readFileSync(settings, 'utf8');
  const result = rollbackUnityBootstrapFootprint(sealed, { ownershipConfirmed: true });

  assert.equal(result.complete, false);
  assert.equal(result.phase, 'validation');
  assert.equal(result.steps.pluginsDirectory, 'UNITY_BOOTSTRAP_FOOTPRINT_CONFLICT');
  assert.equal(fs.readFileSync(lock, 'utf8'), '{"owned":true}\n');
  assert.equal(fs.readFileSync(path.join(nuget, 'owned.dll'), 'utf8'), 'owned');
  assert.equal(fs.readFileSync(`${nuget}.meta`, 'utf8'), 'owned-nuget-meta');
  assert.equal(fs.readFileSync(`${plugins}.meta`, 'utf8'), 'user-plugins-meta');
  assert.equal(fs.readFileSync(settings, 'utf8'), settingsAfterSeal);
});

test('rollback leaves every earlier artifact untouched when ProjectSettings changed after seal', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = captureUnityBootstrapFootprint(root);
  const lock = path.join(root, 'Packages', 'packages-lock.json');
  const plugins = path.join(root, 'Assets', 'Plugins');
  const nuget = path.join(plugins, 'NuGet');
  const settings = path.join(root, 'ProjectSettings', 'ProjectSettings.asset');
  fs.writeFileSync(lock, '{"owned":true}\n');
  fs.mkdirSync(nuget, { recursive: true });
  fs.writeFileSync(path.join(nuget, 'owned.dll'), 'owned');
  fs.writeFileSync(`${nuget}.meta`, 'owned-nuget-meta');
  fs.writeFileSync(`${plugins}.meta`, 'owned-plugins-meta');
  fs.writeFileSync(settings, fs.readFileSync(settings, 'utf8')
    .replace('WebGL: DOTWEEN', 'WebGL: DOTWEEN;UNITY_MCP_READY;UNITY_MCP_DEPS_2'));
  const sealed = sealUnityBootstrapFootprint(before);

  fs.appendFileSync(settings, 'userConcurrentSetting: true\n');
  const result = rollbackUnityBootstrapFootprint(sealed, { ownershipConfirmed: true });

  assert.equal(result.complete, false);
  assert.equal(result.phase, 'validation');
  assert.equal(result.steps.scriptingDefines, 'UNITY_BOOTSTRAP_FOOTPRINT_CONFLICT');
  assert.equal(fs.readFileSync(lock, 'utf8'), '{"owned":true}\n');
  assert.equal(fs.readFileSync(path.join(nuget, 'owned.dll'), 'utf8'), 'owned');
  assert.equal(fs.readFileSync(`${nuget}.meta`, 'utf8'), 'owned-nuget-meta');
  assert.equal(fs.readFileSync(`${plugins}.meta`, 'utf8'), 'owned-plugins-meta');
  assert.match(fs.readFileSync(settings, 'utf8'), /userConcurrentSetting: true/);
});
