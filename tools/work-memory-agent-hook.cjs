#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readStdin() {
  try {
    if (process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function print(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function main() {
  const raw = readStdin();
  const hook = raw.trim() ? JSON.parse(raw) : {};
  const transcriptPath = hook.transcript_path ? path.resolve(String(hook.transcript_path)) : null;
  const repoRoot = hook.cwd ? path.resolve(String(hook.cwd)) : process.cwd();
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    print({ continue: true });
    return;
  }
  const args = [
    path.join(__dirname, 'work-memory.cjs'),
    'import-agent-memories',
    '--repo-root', repoRoot,
    '--transcript', transcriptPath,
    '--session-id', String(hook.sessionId || ''),
    '--hook-event', String(hook.hookEventName || ''),
    '--json',
  ];
  const overrides = [
    ['repo_db', '--repo-db'],
    ['global_db', '--global-db'],
    ['cache_file', '--cache-file'],
    ['shared_capture_file', '--shared-capture-file'],
  ];
  for (const [inputKey, argName] of overrides) {
    if (!hook[inputKey]) continue;
    args.push(argName, path.resolve(String(hook[inputKey])));
  }
  const result = spawnSync(
    process.execPath,
    args,
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );
  if (result.status !== 0) {
    print({
      continue: true,
      systemMessage: `[work-memory] agent hook failed: ${(result.stderr || result.stdout || '').trim()}`,
    });
    return;
  }
  print({ continue: true });
}

try {
  main();
} catch (error) {
  print({ continue: true, systemMessage: `[work-memory] agent hook failed: ${error && error.message ? error.message : error}` });
}