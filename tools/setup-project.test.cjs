'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runSteps } = require('./setup-project.cjs');
test('new projects install the TypeScript runtime required by verification tools', () => {
  const template = require('../template-config/package.scripts_TEMPLATE.json');
  assert.ok(template.devDependencies.typescript);
});
test('SDK uses the CommonJS GameAnalytics release supported by Creator 3.8.8', () => {
  const sdk = require('../packages/playable-sdk/package.json');
  assert.equal(sdk.dependencies.gameanalytics, '4.4.7');
});
test('setup stops before syncing when dependency installation fails', () => {
  const seen = [];
  assert.throws(() => runSteps([{label:'install'}, {label:'sync'}], step => {
    seen.push(step.label); return { status: 1 };
  }), /install: exit 1/);
  assert.deepEqual(seen, ['install']);
});
test('setup propagates spawn errors and preserves dependency order', () => {
  const seen = [];
  assert.throws(() => runSteps([{label:'install'}, {label:'sync'}, {label:'verify'}], step => {
    seen.push(step.label);
    return step.label === 'sync' ? { error: new Error('ENOENT') } : { status: 0 };
  }), /sync: ENOENT/);
  assert.deepEqual(seen, ['install', 'sync']);
});
