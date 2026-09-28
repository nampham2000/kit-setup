'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseArgs, runVerificationSuite, checkEngineFeatureCropping } = require('./headless-verifier.cjs');

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
    checkEffectCompile: () => pass('effects'),
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
  assert.equal(skipped.totalChecks, 8);
  assert.equal(skippedCalls.count, 0);

  const normalCalls = { count: 0 };
  const normal = runVerificationSuite({}, fakeChecks(normalCalls));
  assert.equal(normal.status, 'FAIL');
  assert.equal(normal.totalChecks, 9);
  assert.equal(normalCalls.count, 1);
});

function featureAudit(committedProfile) {
  return () => ({
    requiredModules: ['animation', 'marionette', 'skeletal-animation'],
    physicsDecision: { backend: null },
    profile: { complete: true, missing: [] },
    appliedPreview: { available: true, complete: true, missing: [] },
    committedProfile,
  });
}

test('engine feature check fails when the preview works only from an uncommitted engine profile', () => {
  const uncommitted = checkEngineFeatureCropping(featureAudit({
    available: true, tracked: true, complete: false, missing: ['marionette', 'skeletal-animation'], unexpected: [],
    driftFromWorkingCopy: ['+marionette', '+skeletal-animation'],
  }));
  assert.equal(uncommitted.status, 'FAIL');
  assert.match(uncommitted.errors.join('\n'), /Git-tracked settings\/v2\/packages\/engine\.json lacks marionette, skeletal-animation/);

  const untracked = checkEngineFeatureCropping(featureAudit({ available: true, tracked: false, complete: false, missing: [], unexpected: [], driftFromWorkingCopy: [] }));
  assert.equal(untracked.status, 'FAIL');
  assert.match(untracked.errors.join('\n'), /not tracked by Git/);

  const committed = checkEngineFeatureCropping(featureAudit({ available: true, tracked: true, complete: true, missing: [], unexpected: [], driftFromWorkingCopy: [] }));
  assert.equal(committed.status, 'PASS');
  assert.match(committed.details, /git=ready/);

  const noGit = checkEngineFeatureCropping(featureAudit({ available: false, reason: 'not-a-git-work-tree' }));
  assert.equal(noGit.status, 'PASS');
  assert.match(noGit.warnings.join('\n'), /unverified/);
});
