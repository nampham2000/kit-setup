#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SHARED = path.resolve(__dirname, '../..');
const REGISTRY = path.join(SHARED, 'ai/particle-port-fixes.json');
const USE = 'Usage: node playable-shared-kit/tools/unity-cocos-port/particle-port-fix-audit.cjs [--check|--help]';

function audit(registry, sharedRoot = SHARED) {
  const errors = [];
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.fixes)) errors.push('Invalid particle fix registry schema');
  const ids = new Set();
  const rows = [];
  for (const fix of registry.fixes || []) {
    if (!fix.id || ids.has(fix.id)) errors.push(`Missing or repeated id: ${fix.id}`);
    ids.add(fix.id);
    if (!['automatic', 'conditional', 'recipe'].includes(fix.applicability)) errors.push(`${fix.id}: invalid applicability`);
    if (!/^[0-9a-f]{7}(,[0-9a-f]{7})*$/.test(fix.origin || '')) errors.push(`${fix.id}: missing source commit`);
    if (!fix.acceptance || fix.acceptance.length < 30) errors.push(`${fix.id}: missing acceptance gate`);
    for (const [kind, files] of [['sharedPaths', fix.sharedPaths], ['testPaths', fix.testPaths]]) {
      if (!Array.isArray(files) || !files.length) { errors.push(`${fix.id}: missing ${kind}`); continue; }
      for (const file of files) {
        if (typeof file !== 'string' || path.isAbsolute(file) || file.includes('..') || !file.startsWith('tools/')) {
          errors.push(`${fix.id}: invalid path ${file}`);
        } else if (!fs.existsSync(path.join(sharedRoot, file))) errors.push(`${fix.id}: missing ${file}`);
      }
    }
    rows.push({id:fix.id, applicability:fix.applicability, origin:fix.origin});
  }
  const skill = path.join(sharedRoot, 'ai/skills/unity-to-cocos-porting/SKILL.md');
  const capabilities = path.join(sharedRoot, 'ai/capabilities.def.cjs');
  if (!fs.existsSync(skill) || !fs.readFileSync(skill, 'utf8').includes('particle-port-fixes.json')) errors.push('Skill does not route to registry');
  if (!fs.existsSync(capabilities) || !fs.readFileSync(capabilities, 'utf8').includes("id: 'particle-port-fix-registry'")) errors.push('AGENTS source lacks particle fix rule');
  return {ok:errors.length === 0, count:rows.length, byApplicability:Object.fromEntries(['automatic','conditional','recipe'].map(key=>[key,rows.filter(r=>r.applicability===key).length])), errors, rows};
}

function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length && !['--check','--help'].includes(argv[0]))) {
    process.stderr.write(`${USE}\n`); return 2;
  }
  if (argv[0] === '--help') { process.stdout.write(`${USE}\n`); return 0; }
  const result = audit(JSON.parse(fs.readFileSync(REGISTRY,'utf8')));
  process.stdout.write(`${JSON.stringify(argv[0] === '--check' ? {...result, rows:undefined} : result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main();
module.exports = {audit, main};
