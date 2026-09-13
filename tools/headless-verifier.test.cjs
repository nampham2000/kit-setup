'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseArgs, runVerificationSuite } = require('./headless-verifier.cjs');

function pass(name) {
  return { name, status: 'PASS', errors: [], warnings: [], details: 'ok' };
}

function fakeChecks(buildCalls) {
  return {
    checkTypeScript: () => pass('ts'),
    checkZeroGC: () => pass('gc'),
    checkConfigIntegrity: () => pass('config'),
    checkAssetBindings: () => pass('bindings'),
    checkEngineFeatureCropping: () => pass('features'),
    checkMetaIntegrity: () => pass('meta'),
    checkAssetImport: () => pass('import'),
    checkBuildSize: () => {
      buildCalls.count += 1;
      return { name: 'size', status: 'FAIL', errors: ['old build too large'], warnings: [], details: '' };
    },
  };
}

test('CLI accepts explicit preview size skip and rejects unknown options', () => {
  assert.deepEqual(parseArgs(['--json', '--skip-build-size']), {
    json: true,
    help: false,
    skipBuildSize: true,
  });
  assert.throws(() => parseArgs(['--preview']), /Unknown option/);
});

test('skip-build-size does not read the build-size check while preserving every source/import check', () => {
  const skippedCalls = { count: 0 };
  const skipped = runVerificationSuite({ skipBuildSize: true }, fakeChecks(skippedCalls));
  assert.equal(skipped.status, 'PASS');
  assert.equal(skipped.totalChecks, 7);
  assert.equal(skippedCalls.count, 0);

  const normalCalls = { count: 0 };
  const normal = runVerificationSuite({}, fakeChecks(normalCalls));
  assert.equal(normal.status, 'FAIL');
  assert.equal(normal.totalChecks, 8);
  assert.equal(normalCalls.count, 1);
});
