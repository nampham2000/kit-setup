'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runSteps } = require('./setup-project.cjs');
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
