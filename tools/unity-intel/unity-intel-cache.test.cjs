'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildUnityProjectSnapshot } = require('./index.cjs');
const { createUnityFixture } = require('./test-fixture.cjs');

test('incremental cache is cold, warm, then invalidates only the changed asset', t => {
  const fixture = createUnityFixture(t);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-intel-cache-test-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

  const options = { projectRoot: fixture.root, sourceRoot: fixture.assets, cacheDir };
  const cold = buildUnityProjectSnapshot(options);
  const warm = buildUnityProjectSnapshot(options);

  assert.equal(cold.cache.mode, 'cold');
  assert.equal(cold.cache.hits, 0);
  assert.ok(cold.cache.misses > 0);
  assert.equal(warm.cache.mode, 'warm');
  assert.equal(warm.cache.misses, 0);
  assert.equal(warm.cache.hits, cold.assets.count);
  assert.deepEqual(warm.inventory, cold.inventory);
  assert.deepEqual(warm.dependencies, cold.dependencies);

  const script = path.join(fixture.assets, 'Game', 'Scripts', 'Gameplay.cs');
  fs.appendFileSync(script, '// cache invalidation\n', 'utf8');
  const changed = buildUnityProjectSnapshot(options);
  assert.equal(changed.cache.mode, 'warm');
  assert.equal(changed.cache.misses, 1);
  assert.equal(changed.cache.hits, cold.assets.count - 1);

  const sourceCacheFiles = fs.readdirSync(fixture.root).filter(name => /cache|unity-intel/i.test(name));
  assert.deepEqual(sourceCacheFiles, []);
});

test('--no-cache equivalent does not write persistent state', t => {
  const fixture = createUnityFixture(t);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-intel-no-cache-test-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const snapshot = buildUnityProjectSnapshot({
    projectRoot: fixture.root,
    sourceRoot: fixture.assets,
    cacheDir,
    cache: false,
  });
  assert.equal(snapshot.cache.mode, 'disabled');
  assert.deepEqual(fs.readdirSync(cacheDir), []);
});

test('same-size content replacement with restored mtime cannot reuse stale evidence', t => {
  const fixture = createUnityFixture(t);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-intel-strong-stamp-test-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const options = { projectRoot: fixture.root, sourceRoot: fixture.assets, cacheDir };
  const cold = buildUnityProjectSnapshot(options);
  assert.equal(cold.features.blockers.some(item => item.id === 'dotween'), true);

  const script = path.join(fixture.assets, 'Game', 'Scripts', 'Gameplay.cs');
  const original = fs.readFileSync(script, 'utf8');
  const before = fs.statSync(script);
  const replacementBase = 'public class Gameplay : UnityEngine.MonoBehaviour {}\n';
  const replacement = replacementBase.padEnd(original.length, ' ').slice(0, original.length);
  assert.equal(Buffer.byteLength(replacement), Buffer.byteLength(original));
  fs.writeFileSync(script, replacement, 'utf8');
  fs.utimesSync(script, before.atime, before.mtime);

  const changed = buildUnityProjectSnapshot(options);
  assert.equal(changed.cache.misses, 1);
  assert.equal(changed.features.blockers.some(item => item.id === 'dotween'), false);
});

test('cache recovers from malformed state, tracks deletion, and shares raw index across views', t => {
  const fixture = createUnityFixture(t);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-intel-cache-recovery-test-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  const options = { projectRoot: fixture.root, sourceRoot: fixture.assets, cacheDir };
  const cold = buildUnityProjectSnapshot(options);
  const allView = buildUnityProjectSnapshot({ ...options, includeVendor: true });
  assert.equal(allView.cache.misses, 0);
  assert.equal(allView.cache.hits, cold.assets.count);
  assert.equal(allView.cache.file, cold.cache.file);

  fs.writeFileSync(cold.cache.file, '{broken', 'utf8');
  const recovered = buildUnityProjectSnapshot(options);
  assert.equal(recovered.cache.hits, 0);
  assert.equal(recovered.cache.misses, cold.assets.count);

  const sampleScript = path.join(fixture.assets, 'Samples', 'SampleCoroutine.cs');
  fs.rmSync(sampleScript);
  const deleted = buildUnityProjectSnapshot(options);
  assert.equal(deleted.cache.staleEntries, 1);
  assert.equal(deleted.assets.count, cold.assets.count - 1);
  assert.equal(fs.readdirSync(cacheDir).some(name => name.endsWith('.tmp')), false);
});

test('cache directory inside Unity project is rejected to preserve read-only sources', t => {
  const fixture = createUnityFixture(t);
  assert.throws(() => buildUnityProjectSnapshot({
    projectRoot: fixture.root,
    sourceRoot: fixture.assets,
    cacheDir: path.join(fixture.assets, '.unity-intel-cache'),
  }), /cache must stay outside source\/project/i);
});

test('cache directory junction cannot redirect an external-looking cache back into Unity source', t => {
  const fixture = createUnityFixture(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-intel-cache-junction-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const redirect = path.join(external, 'redirect');
  try {
    fs.symlinkSync(fixture.root, redirect, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('Host does not allow directory symlinks/junctions.');
      return;
    }
    throw error;
  }
  assert.throws(() => buildUnityProjectSnapshot({
    projectRoot: fixture.root,
    sourceRoot: fixture.assets,
    cacheDir: path.join(redirect, 'must-not-exist'),
  }), /symlink\/junction must stay outside source\/project/i);
  assert.equal(fs.existsSync(path.join(fixture.root, 'must-not-exist')), false);
});
