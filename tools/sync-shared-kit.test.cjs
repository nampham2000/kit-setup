'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sync = require('./sync-shared-kit.cjs');

test('extension reconciliation removes stale artifacts and preserves node_modules', () => {
  const source = fs.mkdtempSync(path.join(sync.SHARED_EXTENSIONS_DIR, '.sync-test-source-'));
  const destination = fs.mkdtempSync(path.join(sync.TARGET_EXTENSIONS_DIR, '.sync-test-destination-'));
  try {
    fs.mkdirSync(path.join(source, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(source, 'dist', 'current.js'), 'current');
    fs.mkdirSync(path.join(destination, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(destination, 'dist', 'current.js'), 'old');
    fs.writeFileSync(path.join(destination, 'dist', 'stale.js'), 'stale');
    fs.mkdirSync(path.join(destination, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(destination, 'node_modules', 'keep.txt'), 'keep');

    const result = sync.reconcileDestinationWithSource(source, destination);

    assert.deepEqual(result.removed, ['dist/stale.js']);
    assert.equal(fs.existsSync(path.join(destination, 'dist', 'stale.js')), false);
    assert.equal(fs.readFileSync(path.join(destination, 'node_modules', 'keep.txt'), 'utf8'), 'keep');
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
  }
});
