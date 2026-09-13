#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PACKAGES = ['playable-core', 'playable-sdk'];

function inspectPolicy(pkg, npmrc, lock) {
  const issues = [];
  for (const name of PACKAGES) {
    const expected = `file:playable-shared-kit/packages/${name}`;
    if (pkg.dependencies?.[name] !== expected) issues.push(`${name}: expected ${expected}`);
    if (lock?.packages?.[`node_modules/${name}`]?.link) issues.push(`${name}: lockfile still requests a symlink`);
  }
  const settings = npmrc.split(/\r?\n/).filter(line => /^\s*install-links\s*=/.test(line));
  if (!settings.length || !/^\s*install-links\s*=\s*true\s*$/.test(settings.at(-1))) issues.push('project .npmrc must set install-links=true');
  return { ok: issues.length === 0, issues };
}

function applyPolicy(project) {
  const file = path.join(project, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Only migrate the standard shared-kit paths. Preserve custom dependency sources.
  for (const name of PACKAGES) {
    const current = pkg.dependencies?.[name];
    if (current && ![`file:./playable-shared-kit/packages/${name}`, `file:playable-shared-kit/packages/${name}`].includes(current)) {
      throw new Error(`Custom ${name} dependency; refusing to replace it automatically.`);
    }
  }
  let changed = false;
  pkg.dependencies ||= {};
  for (const name of PACKAGES) {
    const expected = `file:playable-shared-kit/packages/${name}`;
    if (pkg.dependencies[name] !== expected) { pkg.dependencies[name] = expected; changed = true; }
  }
  const rcFile = path.join(project, '.npmrc');
  const original = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, 'utf8') : '';
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/).filter(line => !/^\s*install-links\s*=/.test(line));
  while (lines.at(-1) === '') lines.pop();
  const next = [...lines, 'install-links=true', ''].join(newline);
  if (changed) fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  if (original !== next) fs.writeFileSync(rcFile, next);
  return { changed: changed || original !== next, nextAction: 'Regenerate a legacy link lockfile with npm install --package-lock-only --ignore-scripts, then npm ci. Commit package.json, package-lock.json and .npmrc.' };
}

function main(argv) {
  if (argv.includes('--help')) {
    console.log('Portable npm policy: node playable-shared-kit/tools/portable-npm-policy.cjs [--project <dir>] [--write]\nRead-only by default. --write normalizes standard file dependencies and .npmrc before npm ci on exFAT/NTFS. Never edits lockfile entries or installs dependencies.');
    return;
  }
  let project = path.resolve(__dirname, '..', '..');
  let write = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write') write = true;
    else if (argv[i] === '--project' && argv[i + 1]) project = path.resolve(argv[++i]);
    else throw new Error(`Unsupported option: ${argv[i]}`);
  }
  if (write) console.log(JSON.stringify(applyPolicy(project)));
  const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
  const rc = path.join(project, '.npmrc');
  const lock = path.join(project, 'package-lock.json');
  const result = inspectPolicy(pkg, fs.existsSync(rc) ? fs.readFileSync(rc, 'utf8') : '', fs.existsSync(lock) ? JSON.parse(fs.readFileSync(lock, 'utf8')) : null);
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { inspectPolicy, applyPolicy };
