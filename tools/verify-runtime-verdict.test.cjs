'use strict';

// The runtime verdict of a target must follow what the page did. A retained temp Chrome profile
// (profileCleanup.ok=false: helper processes still holding first_party_sets.db on a loaded Windows
// machine) is housekeeping after the session closed; it used to flip otherwise-green regression
// cases (Screw glass-hold, tap-raycast) to FAIL and forced whole-suite reruns.
const assert = require('node:assert/strict');
const test = require('node:test');
const { runtimeVerdict } = require('./verify-runtime.cjs');

const green = () => ({
  exceptions: [], consoleErrors: [], consoleWarnings: [],
  previewDeviceError: '', previewDeviceRestoreError: '',
  frames: 1200, fps: 40, uniformFrame: false,
  profileCleanup: { ok: true, removed: true, attempts: 1 },
});
const options = { minFps: 20 };

test('a retained runtime profile does not fail an otherwise green target', () => {
  const result = green();
  result.profileCleanup = { ok: false, removed: false, directory: 'x', error: "EBUSY: resource busy or locked, unlink 'first_party_sets.db'" };
  assert.equal(runtimeVerdict(result, options), true);
});

test('runtime evidence still decides the verdict', () => {
  assert.equal(runtimeVerdict(green(), options), true);
  for (const patch of [
    { exceptions: ['TypeError: boom'] },
    { consoleErrors: ['[javascript] ReferenceError'] },
    { previewDeviceError: 'device not found' },
    { previewDeviceRestoreError: 'restore failed' },
    { frames: 0 },
    { fps: 19.9 },
    { uniformFrame: true },
  ]) {
    assert.equal(runtimeVerdict({ ...green(), ...patch }, options), false, JSON.stringify(patch));
  }
});
