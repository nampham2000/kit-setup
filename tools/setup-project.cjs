#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { applyPolicy, inspectPolicy } = require('./portable-npm-policy.cjs');

function runSteps(steps, run) {
  for (const step of steps) {
    const result = run(step);
    if (result.error || result.status !== 0) {
      throw new Error(`Setup stopped at ${step.label}: ${result.error?.message || `exit ${result.status}`}`);
    }
  }
}

function setup(project) {
  const kit = path.join(project, 'playable-shared-kit');
  const pkgFile = path.join(project, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const template = JSON.parse(fs.readFileSync(path.join(kit, 'template-config/package.scripts_TEMPLATE.json'), 'utf8'));
  pkg.scripts = { ...pkg.scripts, ...template.scripts };
  pkg.dependencies = { ...template.dependencies, ...pkg.dependencies };
  pkg.devDependencies = { ...pkg.devDependencies, ...template.devDependencies };
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  applyPolicy(project);
  const lockFile = path.join(project, 'package-lock.json');
  const lock = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : null;
  const current = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const policy = inspectPolicy(current, fs.readFileSync(path.join(project, '.npmrc'), 'utf8'), lock);
  const lockMatches = lock && ['dependencies', 'devDependencies'].every(key =>
    JSON.stringify(Object.entries(current[key] || {}).sort()) ===
    JSON.stringify(Object.entries(lock.packages?.['']?.[key] || {}).sort()));
  const steps = [];
  const npm = (label, args, cwd = project) => steps.push({ label, npm: true, args, cwd });
  const node = (label, file, args = []) => steps.push({ label, args: [path.join(kit, 'tools', file), ...args], cwd: project });
  if (!policy.ok || !lockMatches) npm('regenerate legacy lockfile', ['install', '--package-lock-only', '--ignore-scripts']);
  npm('install locked project dependencies', ['ci']);
  npm('install Cocos MCP runtime', ['ci', '--omit=dev', '--ignore-scripts'], path.join(kit, 'packages/extensions/cocos-mcp'));
  node('sync packages, extensions, scripts and launchers', 'sync-shared-kit.cjs');
  for (const name of fs.readdirSync(path.join(kit, 'packages/extensions'))) {
    const cwd = path.join(project, 'extensions', name);
    if (fs.existsSync(path.join(kit, 'packages/extensions', name, 'package-lock.json'))) npm(`install ${name} runtime`, ['ci', '--omit=dev', '--ignore-scripts'], cwd);
  }
  node('deploy AI skills and command contract', 'ai-knowledge-sync.cjs');
  node('verify Work Memory', 'work-memory.cjs', ['doctor', '--json']);
  node('verify command contract', 'contract-verify.cjs');
  node('check Cocos build environment', 'playable-build.cjs', ['doctor']);
  runSteps(steps, step => {
    console.log(`[setup] ${step.label}`);
    // npm.cmd arguments are fixed here; paths are passed as cwd, never shell text.
    return step.npm && process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...step.args], { cwd: step.cwd, stdio: 'inherit', windowsHide: true })
      : spawnSync(step.npm ? 'npm' : process.execPath, step.args, { cwd: step.cwd, stdio: 'inherit', windowsHide: true });
  });
  console.log('[setup] Complete. Open the project with 1_open-project.bat (Windows) or 1_open-project.sh.');
}

if (require.main === module) {
  if (process.argv.includes('--help')) console.log('Usage: node playable-shared-kit/tools/setup-project.cjs [project-root]\nInstalls locked dependencies, syncs the pinned shared kit and verifies memory/contracts. Does not fetch a newer kit or overwrite game settings.');
  else try { setup(path.resolve(process.argv[2] || path.join(__dirname, '../..'))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { runSteps, setup };
