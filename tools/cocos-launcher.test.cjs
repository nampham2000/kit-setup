'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runWindowsProjectLauncher } = require('./cocos-engine-feature-audit.cjs');

test('Windows launcher executes a literal batch path containing spaces and shell punctuation', { skip: process.platform !== 'win32' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos launcher & literal-'));
  try {
    const batch = path.join(directory, 'launch game.bat');
    fs.writeFileSync(batch, '@echo off\r\necho COCOS_FIXTURE_LAUNCHED\r\nexit /b 7\r\n');
    const result = runWindowsProjectLauncher(batch, { cwd: directory, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 7, result.stderr);
    assert.match(result.stdout, /COCOS_FIXTURE_LAUNCHED/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

for (const [port, expected] of [[3015, 3015], [undefined, 3000], [0, null], ['bad', null]]) {
  test(`launcher preserves or validates configured MCP port ${port}`, { skip: process.platform !== 'win32' }, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-port-'));
    try {
      fs.mkdirSync(path.join(directory, 'playable-shared-kit/scripts'), { recursive: true });
      fs.writeFileSync(path.join(directory, 'playable-shared-kit/scripts/1_open-project.bat'), '');
      fs.mkdirSync(path.join(directory, 'settings'));
      fs.writeFileSync(path.join(directory, 'package.json'), '{}');
      fs.writeFileSync(path.join(directory, 'settings/mcp-server.json'), JSON.stringify({ port }));
      const launcher = fs.readFileSync(path.resolve(__dirname, '../scripts/1_open-project.bat'), 'utf8');
      const prefix = launcher.split(/\r?\n#---PS---\r?\n/)[1].split('# blender-mcp')[0];
      const script = '$ScriptDirFromBat=$env:COCOS_FIXTURE_ROOT\n' + prefix + '\n[Console]::Write($CocosMcpPort)';
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        env: { ...process.env, COCOS_FIXTURE_ROOT: directory }, encoding: 'utf8', windowsHide: true, timeout: 15000,
      });
      if (expected === null) { assert.notEqual(result.status, 0); assert.match(result.stderr, /Invalid project Cocos MCP port/); }
      else { assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), String(expected)); }
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
}
