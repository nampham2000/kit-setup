'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { TOOL_NAME, evaluateResult, parseArgs } = require('./model-import-policy.cjs');

test('FBX policy CLI has portable defaults', () => {
  const options = parseArgs([]);
  assert.equal(options.directory, 'db://assets');
  assert.equal(options.verify, false);
  assert.equal(TOOL_NAME, 'assetAdvanced_enforce_fbx_import_policy');
});

test('FBX policy verify fails closed on importer drift', () => {
  const result = evaluateResult({ success: true, data: { complete: true, updated: 1 } }, { verify: true });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'FBX_POLICY_DRIFT');
});

test('FBX policy accepts complete idempotent report', () => {
  const result = evaluateResult({ success: true, data: { complete: true, updated: 0 } }, { verify: true });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'FBX_POLICY_OK');
});
