'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildUnityProjectSnapshot } = require('./index.cjs');
const {
  EXTRACTOR_FILES,
  EXTRACTOR_FINGERPRINT,
  INDEXER_VERSION,
  extractorFingerprint,
} = require('./cache.cjs');
const { buildUnityEngineFeatureClosure } = require('./engine-feature-closure.cjs');
const { createUnityFixture, isLinkUnavailableError } = require('./test-fixture.cjs');

test('cached engine feature evidence fingerprints its detector producer', () => {
  assert.ok(EXTRACTOR_FILES.includes('engine-feature-closure.cjs'));
  assert.equal(extractorFingerprint(), EXTRACTOR_FINGERPRINT);
  const changedDetector = extractorFingerprint((file, name) => {
    const bytes = fs.readFileSync(file);
    return name === 'engine-feature-closure.cjs'
      ? Buffer.concat([bytes, Buffer.from('\n// detector-regression-sentinel\n')])
      : bytes;
  });
  assert.notEqual(changedDetector, EXTRACTOR_FINGERPRINT);
});

test('a stale detector fingerprint cannot resurrect poisoned engine feature evidence', t => {
  const fixture = createUnityFixture(t);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-intel-feature-cache-test-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture.assets, 'Game', 'Scripts', 'FeatureGate.cs'), `
public sealed class FeatureGate : UnityEngine.MonoBehaviour {
  private void Update() { Poll(); }
  private void Poll() { UnityEngine.Physics2D.RaycastAll(UnityEngine.Vector2.zero, UnityEngine.Vector2.right); }
  private void DeadDebugHelper() { UnityEngine.Debug.DrawLine(UnityEngine.Vector3.zero, UnityEngine.Vector3.one); }
}
`);
  fs.writeFileSync(path.join(fixture.assets, 'Game', 'Billboard.prefab'), `--- !u!199 &1
ParticleSystemRenderer:
  m_RenderMode: 0
  m_Mesh: {fileID: 10202, guid: 00000000000000000000000000000000, type: 0}
`);
  const options = { projectRoot: fixture.root, sourceRoot: fixture.assets, cacheDir };
  const cold = buildUnityProjectSnapshot(options);
  const expected = buildUnityEngineFeatureClosure(cold, { profile: 'full-project' });
  assert.ok(expected.requiredModules.includes('physics-2d-box2d'));
  assert.ok(!expected.requiredModules.includes('primitive'));
  assert.ok(!expected.requiredModules.includes('debug-renderer'));

  const payload = JSON.parse(fs.readFileSync(cold.cache.file, 'utf8'));
  payload.indexerVersion = INDEXER_VERSION;
  payload.extractorFingerprint = 'legacy-detector';
  for (const entry of Object.values(payload.entries)) {
    if (!entry || !entry.record) continue;
    entry.record.engineFeatureEvidence = [
      { feature: 'primitive', signal: 'legacy-dormant-mesh-token' },
      { feature: 'debug-renderer', signal: 'legacy-dead-debug-token' },
    ];
  }
  fs.writeFileSync(cold.cache.file, `${JSON.stringify(payload)}\n`);

  const rebuilt = buildUnityProjectSnapshot(options);
  const uncached = buildUnityProjectSnapshot({ ...options, cache: false });
  const rebuiltClosure = buildUnityEngineFeatureClosure(rebuilt, { profile: 'full-project' });
  const uncachedClosure = buildUnityEngineFeatureClosure(uncached, { profile: 'full-project' });
  assert.equal(rebuilt.cache.mode, 'cold');
  assert.equal(rebuilt.cache.hits, 0);
  assert.equal(rebuilt.cache.misses, cold.assets.count);
  assert.deepEqual(rebuiltClosure, uncachedClosure);
  assert.deepEqual(rebuiltClosure, expected);
});

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
    if (isLinkUnavailableError(error)) {
      t.skip(`Host filesystem does not support directory symlinks/junctions: ${error.code}`);
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
