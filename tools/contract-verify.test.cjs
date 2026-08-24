'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { CAPABILITIES } = require('../ai/capabilities.def.cjs');
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
