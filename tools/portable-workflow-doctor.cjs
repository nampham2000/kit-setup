#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REQUIRED_SCRIPTS = Object.freeze({
  'ai:sync': 'ai-knowledge-sync.cjs',
  'ai:contract:verify': 'contract-verify.cjs',
  'memory:doctor': 'work-memory.cjs doctor',
  'memory:query': 'work-memory.cjs query',
  'ai:port:core:resume': 'core-gameplay-port.cjs resume',
  'ai:verify:regressions': 'port-regression-gate.cjs run',
});
const PORTABLE_FILES = Object.freeze([
  'package.json',
  'package-lock.json',
  '.gitmodules',
  'playable-shared-kit/ai/capabilities.def.cjs',
  'playable-shared-kit/ai/CAPABILITIES.json',
  'playable-shared-kit/ai/CORE.md',
  'playable-shared-kit/ai/skills/unity-to-cocos-porting/SKILL.md',
  'playable-shared-kit/ai/skills/work-memory-workflow/SKILL.md',
  'playable-shared-kit/tools/portable-workflow-doctor.cjs',
  'playable-shared-kit/tools/work-memory/data/shared-memory.db',
]);

const USAGE = `Portable Porting Workflow Doctor

Usage:
  node playable-shared-kit/tools/portable-workflow-doctor.cjs [options]
  npm run ai:portable:doctor

Options:
  --project <dir>  Cocos project root. Default: current shared-kit parent.
  --json           Emit bounded machine-readable JSON.
  --help           Show this help and exit.

Read-only checks for a cross-PC checkout: exact submodule state, generated AI
contract, provider skill deployment, Work Memory integrity, tracked regression
evidence, lockfile dependencies, and non-portable absolute paths.`;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArgs(argv) {
  const options = { project: DEFAULT_PROJECT_ROOT, json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--json') options.json = true;
    else if (token === '--project') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) fail('PORTABLE_DOCTOR_OPTION_VALUE', '--project requires a directory');
      options.project = path.resolve(value);
      index += 1;
    } else if (token.startsWith('--project=')) {
      const value = token.slice('--project='.length);
      if (!value) fail('PORTABLE_DOCTOR_OPTION_VALUE', '--project requires a directory');
      options.project = path.resolve(value);
    } else fail('PORTABLE_DOCTOR_OPTION_INVALID', `Unknown option: ${token}`);
  }
  return options;
}

function parseSubmoduleStatus(output) {
  const line = String(output || '').split(/\r?\n/).find(Boolean) || '';
  const match = line.match(/^([ +\-U])?([0-9a-f]{40})\s+([^\s]+)/i);
  if (!match) return { state: 'unknown', commit: null, path: null, raw: line };
  const marker = match[1] || ' ';
  const states = { ' ': 'exact', '+': 'mismatch', '-': 'uninitialized', U: 'conflict' };
  return { state: states[marker] || 'unknown', commit: match[2], path: match[3], raw: line };
}

function findAbsolutePathTokens(value, pointer = '$', found = []) {
  if (typeof value === 'string') {
    if (/(?:^|[\s"'])(?:[A-Za-z]:[\\/]|\\\\|file:\/\/)/i.test(value)) found.push(pointer);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findAbsolutePathTokens(item, `${pointer}[${index}]`, found));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) findAbsolutePathTokens(item, `${pointer}.${key}`, found);
  }
  return found;
}

function inspectPackageScripts(packageJson, required = REQUIRED_SCRIPTS) {
  const scripts = packageJson && packageJson.scripts && typeof packageJson.scripts === 'object'
    ? packageJson.scripts : {};
  const missing = [];
  const mismatched = [];
  for (const [name, fragment] of Object.entries(required)) {
    if (!scripts[name]) missing.push(name);
    else if (!String(scripts[name]).includes(fragment)) mismatched.push({ name, expectedFragment: fragment, actual: scripts[name] });
  }
  return { ok: missing.length === 0 && mismatched.length === 0, missing, mismatched };
}

function command(file, args, cwd, timeout = 60000) {
  try {
    const stdout = execFileSync(file, args, {
      cwd,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return { ok: true, stdout: stdout || '', exitCode: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: `${error.stdout || ''}${error.stderr || ''}`,
      exitCode: Number.isInteger(error.status) ? error.status : null,
      error: error.message,
    };
  }
}

function isGitTracked(projectRoot, relativeFile, runner = command) {
  return runner('git', ['-C', projectRoot, 'ls-files', '--error-unmatch', '--', relativeFile], projectRoot, 10000).ok;
}

function addCheck(checks, id, ok, severity, summary, details = null, nextAction = null) {
  checks.push({ id, ok: Boolean(ok), severity, summary, ...(details ? { details } : {}), ...(nextAction ? { nextAction } : {}) });
}

function compareGeneratedContract(projectRoot) {
  try {
    const definitionFile = path.join(projectRoot, 'playable-shared-kit', 'ai', 'capabilities.def.cjs');
    const generatedFile = path.join(projectRoot, 'playable-shared-kit', 'ai', 'CAPABILITIES.json');
    delete require.cache[require.resolve(definitionFile)];
    const definition = require(definitionFile);
    const generated = JSON.parse(fs.readFileSync(generatedFile, 'utf8'));
    const expectedIds = (definition.CAPABILITIES || []).map(item => item.id);
    const generatedCapabilities = Array.isArray(generated.capabilities)
      ? generated.capabilities
      : Object.values(generated.capabilities || {}).flat();
    const actualIds = generatedCapabilities.map(item => item.id);
    const expectedRules = (definition.CORE_RULES || []).map(item => item.id);
    const actualRules = (generated.coreRules || []).map(item => item.id);
    const sameIds = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
    const ok = sameIds(expectedIds, actualIds)
      && sameIds(expectedRules, actualRules)
      && generated._meta && generated._meta.count === expectedIds.length;
    return { ok, expectedCapabilities: expectedIds.length, generatedCapabilities: actualIds.length };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function normalizeSkillSource(text) {
  return String(text || '')
    .replace(/<!-- Generated by `npm run ai:sync` from playable-shared-kit\/ai\/capabilities\.def\.cjs\. Do not hand-edit commands\. -->[ \t]*\r?\n/g, '')
    .replace(/(<!-- BEGIN:GENERATED:[^>]+ -->)[\s\S]*?(<!-- END:GENERATED:[^>]+ -->)/g, '$1\n$2')
    .replace(/\r\n/g, '\n')
    .trim();
}

function compareRepoSkills(projectRoot) {
  const names = ['unity-to-cocos-porting', 'work-memory-workflow'];
  const mismatched = [];
  for (const name of names) {
    const source = path.join(projectRoot, 'playable-shared-kit', 'ai', 'skills', name, 'SKILL.md');
    const deployed = path.join(projectRoot, '.agents', 'skills', name, 'SKILL.md');
    if (!fs.existsSync(source) || !fs.existsSync(deployed)
      || normalizeSkillSource(fs.readFileSync(source, 'utf8')) !== normalizeSkillSource(fs.readFileSync(deployed, 'utf8'))) mismatched.push(name);
  }
  return { ok: mismatched.length === 0, mismatched };
}

function runDoctor(options = {}, dependencies = {}) {
  const projectRoot = path.resolve(options.project || DEFAULT_PROJECT_ROOT);
  const runner = dependencies.runner || command;
  const checks = [];
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    fail('PORTABLE_DOCTOR_PROJECT_MISSING', `Project directory does not exist: ${projectRoot}`);
  }

  const missingFiles = PORTABLE_FILES.filter(relative => !fs.existsSync(path.join(projectRoot, relative)));
  addCheck(checks, 'portable-files', missingFiles.length === 0, 'high',
    missingFiles.length ? 'Portable shared-kit files are missing.' : 'Portable shared-kit files are present.',
    missingFiles.length ? { missing: missingFiles } : { count: PORTABLE_FILES.length },
    missingFiles.length ? 'Run git submodule update --init --recursive and restore the lockfile.' : null);

  let packageJson = null;
  try {
    packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  } catch (error) {
    addCheck(checks, 'package-json', false, 'high', 'package.json cannot be parsed.', { error: error.message }, 'Restore package.json from Git.');
  }
  if (packageJson) {
    const scriptCheck = inspectPackageScripts(packageJson);
    addCheck(checks, 'portable-scripts', scriptCheck.ok, 'high',
      scriptCheck.ok ? 'Portable workflow scripts match the shared tool entrypoints.' : 'Portable workflow scripts are missing or drifted.',
      scriptCheck, scriptCheck.ok ? null : 'Restore the generated package scripts from the project template.');
    const dependencyOk = Boolean(packageJson.dependencies && packageJson.dependencies['better-sqlite3']);
    addCheck(checks, 'memory-dependency-declared', dependencyOk, 'high',
      dependencyOk ? 'better-sqlite3 is declared for Node versions without node:sqlite.' : 'better-sqlite3 is not declared.',
      null, dependencyOk ? null : 'Add better-sqlite3 to dependencies and commit the lockfile.');
  }

  let dependencyResolved = false;
  try {
    require.resolve('better-sqlite3', { paths: [projectRoot] });
    dependencyResolved = true;
  } catch {}
  addCheck(checks, 'dependencies-installed', dependencyResolved, 'high',
    dependencyResolved ? 'Runtime dependencies are installed.' : 'better-sqlite3 cannot be resolved from this checkout.',
    { node: process.versions.node }, dependencyResolved ? null : 'Run npm ci on this PC.');

  const submodule = parseSubmoduleStatus(runner('git', ['-C', projectRoot, 'submodule', 'status', '--', 'playable-shared-kit'], projectRoot, 10000).stdout);
  addCheck(checks, 'shared-kit-submodule', submodule.state === 'exact', 'high',
    submodule.state === 'exact' ? 'Shared kit is checked out at the exact parent commit.' : `Shared kit state is ${submodule.state}.`,
    submodule, submodule.state === 'exact' ? null : 'Run git submodule update --init --recursive, then commit the exact parent pointer.');

  const sharedRoot = path.join(projectRoot, 'playable-shared-kit');
  const sharedStatus = fs.existsSync(sharedRoot)
    ? runner('git', ['-C', sharedRoot, 'status', '--porcelain'], projectRoot, 10000) : { ok: false, stdout: '' };
  const sharedDirty = Boolean(sharedStatus.ok && sharedStatus.stdout.trim());
  addCheck(checks, 'shared-kit-clean', sharedStatus.ok && !sharedDirty, 'high',
    sharedStatus.ok && !sharedDirty ? 'Shared kit has no uncommitted portable state.' : 'Shared kit contains uncommitted or unreadable state.',
    sharedDirty ? { changes: sharedStatus.stdout.trim().split(/\r?\n/).slice(0, 12) } : null,
    sharedStatus.ok && !sharedDirty ? null : 'Commit shared tooling, skills, and Work Memory in the shared-kit repository.');

  const sharedPortableFiles = [
    'ai/capabilities.def.cjs',
    'ai/CAPABILITIES.json',
    'ai/CORE.md',
    'ai/skills/unity-to-cocos-porting/SKILL.md',
    'ai/skills/work-memory-workflow/SKILL.md',
    'tools/portable-workflow-doctor.cjs',
    'tools/work-memory/data/shared-memory.db',
  ];
  const sharedUntracked = sharedPortableFiles
    .filter(relative => fs.existsSync(path.join(sharedRoot, relative)) && !isGitTracked(sharedRoot, relative, runner));
  addCheck(checks, 'shared-portable-source-tracked', sharedUntracked.length === 0, 'high',
    sharedUntracked.length ? 'Shared portable source exists but is not tracked.' : 'Shared contract, skills, tool, and global memory are Git-tracked.',
    sharedUntracked.length ? { untracked: sharedUntracked } : { count: sharedPortableFiles.length },
    sharedUntracked.length ? 'Commit every shared portable source file in playable-shared-kit.' : null);

  const trackedMissing = ['package.json', 'package-lock.json', 'tools/port-regressions.json']
    .filter(relative => fs.existsSync(path.join(projectRoot, relative)) && !isGitTracked(projectRoot, relative, runner));
  addCheck(checks, 'project-portable-evidence', trackedMissing.length === 0, 'high',
    trackedMissing.length ? 'Project portability inputs exist but are not tracked.' : 'Project lockfile and regression registry are Git-tracked.',
    trackedMissing.length ? { untracked: trackedMissing } : null,
    trackedMissing.length ? 'Add these files to Git; local receipts and screenshots are not handoff truth.' : null);

  const registryFile = path.join(projectRoot, 'tools', 'port-regressions.json');
  if (fs.existsSync(registryFile)) {
    try {
      const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
      const absolutePointers = findAbsolutePathTokens(registry);
      addCheck(checks, 'registry-relative-paths', absolutePointers.length === 0, 'high',
        absolutePointers.length ? 'Regression registry contains machine-specific absolute paths.' : 'Regression registry uses portable paths.',
        absolutePointers.length ? { pointers: absolutePointers.slice(0, 20) } : null,
        absolutePointers.length ? 'Replace absolute paths with project-relative tracked paths.' : null);
    } catch (error) {
      addCheck(checks, 'registry-relative-paths', false, 'high', 'Regression registry cannot be parsed.', { error: error.message }, 'Repair tools/port-regressions.json.');
    }
  } else {
    addCheck(checks, 'registry-relative-paths', true, 'info', 'No regression registry yet; scaffold/init will create one.', null,
      'Before implementation, run ai:port:core:scaffold or ai:verify:regressions:init and commit the registry.');
  }

  const contract = compareGeneratedContract(projectRoot);
  addCheck(checks, 'generated-contract', contract.ok, 'high',
    contract.ok ? 'CAPABILITIES.json matches the single source definition.' : 'Generated AI contract is stale.', contract,
    contract.ok ? null : 'Run npm run ai:sync, then npm run ai:contract:verify.');

  const skills = compareRepoSkills(projectRoot);
  addCheck(checks, 'provider-skills', skills.ok, 'high',
    skills.ok ? 'Repo-local provider skills match shared skill sources.' : 'Repo-local provider skills are stale or missing.', skills,
    skills.ok ? null : 'Run npm run ai:sync on this PC.');

  const contractRun = runner(process.execPath, [path.join(sharedRoot, 'tools', 'contract-verify.cjs'), '--json'], projectRoot, 120000);
  addCheck(checks, 'command-contract', contractRun.ok, 'high',
    contractRun.ok ? 'CLI command contract verification passes.' : 'CLI command contract verification failed.',
    contractRun.ok ? null : { exitCode: contractRun.exitCode },
    contractRun.ok ? null : 'Run npm run ai:contract:verify and resolve every drift.');

  const memoryRun = runner(process.execPath, [path.join(sharedRoot, 'tools', 'work-memory.cjs'), 'doctor', '--repo-root', projectRoot, '--json'], projectRoot, 120000);
  addCheck(checks, 'work-memory-integrity', memoryRun.ok, 'high',
    memoryRun.ok ? 'Global and repo Work Memory integrity checks pass.' : 'Work Memory integrity check failed.',
    memoryRun.ok ? null : { exitCode: memoryRun.exitCode },
    memoryRun.ok ? null : 'Run npm run memory:doctor -- --json; use dry-run repair if corruption is reported.');

  const resumePacket = path.join(projectRoot, '.ai', 'port', 'resume-packet.json');
  addCheck(checks, 'resume-packet', true, 'info', fs.existsSync(resumePacket)
    ? 'A local resume packet exists; it must be revalidated against source on this PC.'
    : 'No local resume packet exists; resume/scaffold will regenerate it.', null,
  'Do not copy mutation receipts from another PC; run ai:port:core:resume or scaffold locally.');

  const failures = checks.filter(check => !check.ok && check.severity === 'high');
  const nextActions = [...new Set(checks.map(check => check.nextAction).filter(Boolean))];
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? 'ready' : 'blocked',
    projectRoot,
    portablePrinciple: 'Track source, contracts, skills, memory, and regression inputs; regenerate local receipts and caches.',
    checks,
    failureCount: failures.length,
    nextActions,
  };
}

function printHuman(result) {
  console.log(`Portable workflow: ${result.status.toUpperCase()}`);
  for (const check of result.checks) {
    const mark = check.ok ? 'ok' : 'FAIL';
    console.log(`  [${mark}] ${check.id}: ${check.summary}`);
  }
  if (result.nextActions.length) {
    console.log('Next actions:');
    result.nextActions.forEach(action => console.log(`  - ${action}`));
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
      return;
    }
    const result = runDoctor(options);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else printHuman(result);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const output = { ok: false, code: error.code || 'PORTABLE_DOCTOR_FAILED', error: error.message };
    if (options && options.json) console.log(JSON.stringify(output, null, 2));
    else console.error(`${output.code}: ${output.error}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  PORTABLE_FILES,
  REQUIRED_SCRIPTS,
  compareGeneratedContract,
  findAbsolutePathTokens,
  inspectPackageScripts,
  normalizeSkillSource,
  parseArgs,
  parseSubmoduleStatus,
  runDoctor,
};
