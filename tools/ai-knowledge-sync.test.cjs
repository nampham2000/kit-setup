'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { insertGeneratedStamp, shouldDeployUserHome } = require('./ai-knowledge-sync.cjs');

test('generated stamp preserves SKILL.md YAML frontmatter at byte zero', () => {
  const source = '---\nname: unity-to-cocos-porting\ndescription: test\n---\n\n# Skill\n';
  const output = insertGeneratedStamp(source, '<!-- generated -->');
  assert.equal(output.startsWith('---\n'), true);
  assert.match(output, /^---\n[\s\S]*?\n---\n<!-- generated -->\n/);
});

test('generated stamp remains the first line for ordinary agent instruction files', () => {
  assert.equal(insertGeneratedStamp('# Agent\n', '<!-- generated -->'), '<!-- generated -->\n# Agent\n');
});

test('project-only sync skips machine-local skill deployment without changing the default', () => {
  assert.equal(shouldDeployUserHome({}), true);
  assert.equal(shouldDeployUserHome({ CC_PLAYABLE_AI_SYNC_PROJECT_ONLY: '0' }), true);
  assert.equal(shouldDeployUserHome({ CC_PLAYABLE_AI_SYNC_PROJECT_ONLY: '1' }), false);
});
