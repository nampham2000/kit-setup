'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function matchingEditors(rows, projectRoot) {
  const normalize = value => path.win32.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
  return rows.filter(row => {
    const command = String(row.CommandLine || '');
    const match = /(?:^|\s)--project(?:=|\s+)(?:"([^"]+)"|([^\s]+))/i.exec(command);
    return match && normalize(match[1] || match[2]) === normalize(projectRoot);
  });
}

function assertProjectClosed(projectRoot, options = {}) {
  if ((options.platform || process.platform) !== 'win32') return;
  const result = (options.spawnSync || spawnSync)('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process -Filter \"name='CocosCreator.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
  ], { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Cannot inspect Cocos processes before CLI build. Close the project editor and retry.');
  const parsed = result.stdout.trim() ? JSON.parse(result.stdout) : [];
  const matches = matchingEditors(Array.isArray(parsed) ? parsed : [parsed], projectRoot);
  if (matches.length) throw new Error(`Save and close this project's Cocos editor before CLI build (PID ${matches.map(row => row.ProcessId).join(', ')}). No editor was stopped and no build output was removed.`);
}
module.exports = { matchingEditors, assertProjectClosed };
