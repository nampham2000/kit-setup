'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { CAPABILITIES, CORE_RULES } = require('../ai/capabilities.def.cjs');
const { fullCommand } = require('./capability-manifest.cjs');
const { findEmbeddedArgumentDuplicates } = require('./contract-verify.cjs');

test('capability commands do not duplicate flags or positional placeholders', () => {
  for (const capability of CAPABILITIES) {
    assert.deepEqual(findEmbeddedArgumentDuplicates(capability), [], capability.id);
  }
});

test('duplicate detector catches the command drift shape that affected port.plan', () => {
  const broken = {
    cmd: 'node tool.cjs --src <UnityAssetsFolder>',
    args: ['--src <UnityAssetsFolder>'],
  };
  assert.deepEqual(findEmbeddedArgumentDuplicates(broken), ['--src']);
});

test('port.plan full command contains each required operand once', () => {
  const capability = CAPABILITIES.find(item => item.id === 'port.plan');
  const command = fullCommand(capability);
  assert.equal((command.match(/--project/g) || []).length, 1);
  assert.equal((command.match(/<UnityProjectRoot>/g) || []).length, 1);
});

test('unity preflight agent contract points only at declared compact capabilities', () => {
  const rule = CORE_RULES.find(item => item.id === 'unity-preflight');
  assert.ok(rule);
  assert.deepEqual(rule.agentContract.entrypoints, ['port.preflight']);
  assert.equal(rule.agentContract.evidenceQuery, 'unity.intel.query');
  assert.equal(rule.agentContract.completionHighPolicy, 'core-acceptance-required');
  assert.deepEqual(
    rule.agentContract.mustConsume.filter(id => id.startsWith('core')),
    ['coreGameplay', 'coreObligationIndex'],
  );
  const ids = new Set(CAPABILITIES.map(item => item.id));
  for (const id of [...rule.agentContract.entrypoints, rule.agentContract.evidenceQuery]) {
    assert.equal(ids.has(id), true, id);
  }
});

test('shared-kit package template distributes every Unity intelligence and preflight alias', () => {
  const templatePath = path.resolve(__dirname, '..', 'template-config', 'package.scripts_TEMPLATE.json');
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const rootPackage = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
  const expected = {
    'ai:portable:doctor': 'node playable-shared-kit/tools/portable-workflow-doctor.cjs --json',
    'ai:port:preflight': 'node playable-shared-kit/tools/unity-intel-cli.cjs preflight --json',
    'port:core:init': 'node playable-shared-kit/tools/core-gameplay-port.cjs init',
    'port:core:verify': 'node playable-shared-kit/tools/core-gameplay-port.cjs verify',
    'ai:port:core:init': 'node playable-shared-kit/tools/core-gameplay-port.cjs init --json',
    'ai:port:core:verify': 'node playable-shared-kit/tools/core-gameplay-port.cjs verify --json',
    'ai:verify:regressions': 'node playable-shared-kit/tools/port-regression-gate.cjs run --json',
    'ai:verify:regressions:init': 'node playable-shared-kit/tools/port-regression-gate.cjs init --json',
    'ai:verify:regressions:check': 'node playable-shared-kit/tools/port-regression-gate.cjs check --json',
    'ai:verify:visual': 'node playable-shared-kit/tools/preview-checkpoints.cjs --json',
    'unity:intel:doctor': 'node playable-shared-kit/tools/unity-intel-cli.cjs doctor',
    'unity:intel:setup': 'node playable-shared-kit/tools/unity-intel-cli.cjs setup',
    'unity:intel:scan': 'node playable-shared-kit/tools/unity-intel-cli.cjs scan',
    'unity:intel:preflight': 'node playable-shared-kit/tools/unity-intel-cli.cjs preflight',
    'ai:unity:preflight': 'node playable-shared-kit/tools/unity-intel-cli.cjs preflight --json',
    'ai:unity:scan': 'node playable-shared-kit/tools/unity-intel-cli.cjs scan --json',
    'ai:unity:query': 'node playable-shared-kit/tools/unity-intel-cli.cjs query --json',
    'unity:intel:mcp': 'node playable-shared-kit/tools/unity-intel-mcp.cjs',
  };
  for (const [name, command] of Object.entries(expected)) {
    assert.equal(template.scripts[name], command, name);
    assert.equal(rootPackage.scripts[name], command, `root:${name}`);
  }
  assert.match(template.scripts['test:unity:intel'], /unity-intel\/preflight\.test\.cjs/);
  assert.match(template.scripts['test:unity:intel'], /unity-intel\/core-gameplay-scope\.test\.cjs/);
  assert.match(template.scripts['test:unity:intel'], /tools\/core-gameplay-port\.test\.cjs/);
  assert.match(template.scripts['test:unity:intel'], /tools\/port-regression-gate\.test\.cjs/);
  assert.match(template.scripts['test:unity:intel'], /unity-intel\/diagnostics\.test\.cjs/);
  assert.match(
    template.scripts['test:port'],
    /unity-cocos-port-nested-prefab-transform\.test\.cjs/,
    'portable test:port must protect nested prefab source transform inheritance',
  );
  assert.equal(
    template.scripts['test:unity:intel:samples'],
    'node playable-shared-kit/tools/unity-intel/sample-project-regression.cjs',
  );
});
