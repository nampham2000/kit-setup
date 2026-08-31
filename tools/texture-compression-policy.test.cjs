'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DEFAULT_PRESET_ID, TOOL_NAME, evaluateResult, parseArgs } = require('./texture-compression-policy.cjs');

test('texture policy CLI has portable defaults', () => {
  const options = parseArgs([]);
  assert.equal(options.directory, 'db://assets');
  assert.equal(options.presetName, 'PlayableTransparent');
  assert.equal(options.presetId, DEFAULT_PRESET_ID);
  assert.equal(options.quality, 50);
  assert.equal(TOOL_NAME, 'assetAdvanced_enforce_texture_compression_policy');
});

test('texture policy verify fails closed on importer drift', () => {
  const result = evaluateResult({
    success: true,
    data: { complete: true, updated: 2, preset: { created: false } },
  }, { verify: true });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TEXTURE_POLICY_DRIFT');
});

test('texture policy apply accepts a complete idempotent report', () => {
  const result = evaluateResult({
    success: true,
    data: { complete: true, updated: 4, preset: { created: true } },
  }, { verify: false });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'TEXTURE_POLICY_OK');
});
