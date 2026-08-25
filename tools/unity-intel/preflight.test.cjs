'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { scanUnityProject } = require('./service.cjs');
const { createUnityFixture } = require('./test-fixture.cjs');
const {
  PREFLIGHT_MAX_BYTES,
  RECEIPT_MAX_BYTES,
  assertUnityPortPreflight,
  createImplementationBrief,
  createReceipt,
  readReceipt,
  runUnityPortPreflight,
  writePortProvenance,
} = require('./preflight.cjs');

function cacheFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-preflight-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('preflight creates a compact deterministic feature brief and fresh project receipt', async t => {
  const fixture = createUnityFixture(t);
  const cacheDir = cacheFixture(t);
  const input = {
    project: fixture.root,
    provider: 'static',
    cache: false,
    cacheDir,
    now: Date.parse('2026-08-25T00:00:00.000Z'),
  };
  const first = await runUnityPortPreflight(input);
  const second = await runUnityPortPreflight(input);
  assert.equal(first.brief.briefId, second.brief.briefId);
  assert.equal(first.brief.receiptId, second.brief.receiptId);
  assert.equal(first.brief.decision.status, 'ready-with-obligations');
  assert.equal(first.brief.obligations.some(item => item.code === 'UNITY_DOTWEEN' && !item.hard), true);
  assert.ok(Buffer.byteLength(JSON.stringify(first.brief)) <= PREFLIGHT_MAX_BYTES);
  assert.equal(JSON.stringify(first.brief).includes(fixture.root), false);
  assert.equal(first.brief.project.coverage.playModeCapture, false);

  const receipt = readReceipt(fixture.root, { cacheDir });
  assert.equal(receipt.receiptId, first.brief.receiptId);
  assert.equal(JSON.stringify(receipt).includes(fixture.root), false);
  assert.equal(assertUnityPortPreflight(fixture.assets, { cacheDir, now: input.now }).applicable, true);
});

test('static unresolved GUIDs require completion evidence while unknown highs still block implementation', async t => {
  const fixture = createUnityFixture(t);
  const result = await scanUnityProject({ project: fixture.root, provider: 'static', cache: false });
  result.snapshot.diagnostics.push({
    code: 'UNITY_REACHABLE_GUID_UNRESOLVED', severity: 'high', count: 4,
    message: 'missing', action: 'restore', evidence: ['Assets/Game/Scenes/Main.unity'],
  });
  result.snapshot.diagnostics.push({
    code: 'UNITY_FUTURE_UNKNOWN', severity: 'high', count: 1,
    message: 'unknown', action: 'inspect', evidence: [],
  });
  const brief = createImplementationBrief(result, { project: fixture.root, now: 0 });
  assert.equal(brief.decision.status, 'blocked');
  assert.equal(brief.decision.implementationAllowed, false);
  assert.equal(
    brief.obligations.find(item => item.code === 'UNITY_REACHABLE_GUID_UNRESOLVED').hard,
    false,
  );
  assert.deepEqual(
    brief.obligations.filter(item => item.hard).map(item => item.code).sort(),
    ['UNITY_FUTURE_UNKNOWN'],
  );

  result.snapshot.diagnostics.find(item => item.code === 'UNITY_REACHABLE_GUID_UNRESOLVED').source = 'unity-mcp';
  const liveConfirmed = createImplementationBrief(result, { project: fixture.root, now: 0 });
  assert.equal(
    liveConfirmed.obligations.find(item => item.code === 'UNITY_REACHABLE_GUID_UNRESOLVED').hard,
    true,
  );
});

test('brief preserves every high code within 12 KiB by compacting repeated routing details', async t => {
  const fixture = createUnityFixture(t);
  const result = await scanUnityProject({ project: fixture.root, provider: 'static', cache: false });
  for (let index = 0; index < 50; index += 1) {
    result.snapshot.diagnostics.push({
      code: `UNITY_SYNTHETIC_HIGH_${String(index).padStart(2, '0')}`,
      severity: 'high',
      count: index + 1,
      message: 'synthetic',
      action: 'Inspect bounded evidence and disposition this intentionally long synthetic diagnostic before completion.',
      evidence: [`Assets/Game/Synthetic${index}.prefab`],
    });
  }
  const brief = createImplementationBrief(result, { project: fixture.root, now: 0 });
  const codes = new Set(brief.obligationIndex.map(item => item[0]));
  for (let index = 0; index < 50; index += 1) {
    assert.equal(codes.has(`UNITY_SYNTHETIC_HIGH_${String(index).padStart(2, '0')}`), true);
  }
  assert.ok(brief.truncated.obligationDetails > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(brief)) <= PREFLIGHT_MAX_BYTES);
  assert.deepEqual(brief.obligationRoutes.compact.capabilities, ['unity.intel.query']);
  const receipt = createReceipt(fixture.root, brief, { now: 0 });
  assert.ok(Buffer.byteLength(JSON.stringify(receipt)) <= RECEIPT_MAX_BYTES);
  assert.equal(receipt.decision.hardBlockerCount >= receipt.decision.hardBlockerCodes.length, true);
});

test('typed intent router scopes a script brief and fails closed for an unknown target', async t => {
  const fixture = createUnityFixture(t);
  const result = await scanUnityProject({ project: fixture.root, provider: 'static', cache: false });
  const scoped = createImplementationBrief(result, {
    project: fixture.root, intent: 'script', targets: ['Gameplay'], now: 0,
  });
  assert.deepEqual(scoped.intent.matchedTargets, ['Gameplay']);
  assert.deepEqual(scoped.intent.missingTargets, []);
  assert.equal(scoped.receiptId, null);
  assert.equal(scoped.decision.mutationReceiptIssued, false);
  assert.ok(scoped.intent.scopePathCount >= 1);
  assert.equal(scoped.obligations.some(item => item.code === 'UNITY_DOTWEEN'), true);
  assert.equal(scoped.features.some(item => item.id === 'tweening'), true);

  const missing = createImplementationBrief(result, {
    project: fixture.root, intent: 'script', targets: ['DoesNotExist'], now: 0,
  });
  assert.equal(missing.decision.status, 'blocked');
  assert.equal(missing.obligations.some(item => item.code === 'UNITY_PREFLIGHT_TARGET_NOT_FOUND'), true);
});

test('receipt fails closed when missing, expired or stale after Unity source changes', async t => {
  const fixture = createUnityFixture(t);
  const cacheDir = cacheFixture(t);
  assert.throws(
    () => assertUnityPortPreflight(fixture.assets, { cacheDir }),
    error => error.code === 'UNITY_PREFLIGHT_REQUIRED',
  );
  const now = Date.parse('2026-08-25T00:00:00.000Z');
  await runUnityPortPreflight({ project: fixture.root, provider: 'static', cache: false, cacheDir, now, maxAgeMs: 1000 });
  assert.throws(
    () => assertUnityPortPreflight(fixture.assets, { cacheDir, now: now + 1001 }),
    error => error.code === 'UNITY_PREFLIGHT_EXPIRED',
  );

  await runUnityPortPreflight({ project: fixture.root, provider: 'static', cache: false, cacheDir, now });
  const script = path.join(fixture.root, 'Assets', 'Game', 'Scripts', 'Gameplay.cs');
  fs.appendFileSync(script, '// changed after scan\n', 'utf8');
  assert.throws(
    () => assertUnityPortPreflight(script, { cacheDir, now }),
    error => error.code === 'UNITY_PREFLIGHT_STALE',
  );
});

test('isolated Unity-like source remains backwards compatible when no complete project exists', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-isolated-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'Only.cs');
  fs.writeFileSync(source, 'class Only {}\n', 'utf8');
  assert.deepEqual(assertUnityPortPreflight(source), {
    applicable: false,
    reason: 'source-is-not-inside-a-complete-unity-project',
  });
  assert.throws(
    () => assertUnityPortPreflight(source, { requireProject: true }),
    error => error.code === 'UNITY_PREFLIGHT_PROJECT_REQUIRED',
  );
});

test('external closure staging is bound to an exact receipt and per-file hashes', async t => {
  const fixture = createUnityFixture(t);
  const other = createUnityFixture(t);
  const cacheDir = cacheFixture(t);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-port-staging-'));
  t.after(() => fs.rmSync(staging, { recursive: true, force: true }));
  const staged = path.join(staging, 'Game', 'Scripts', 'Gameplay.cs');
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  fs.copyFileSync(path.join(fixture.root, 'Assets', 'Game', 'Scripts', 'Gameplay.cs'), staged);

  const result = await runUnityPortPreflight({
    project: fixture.root, provider: 'static', cache: false, cacheDir,
  });
  assert.throws(
    () => assertUnityPortPreflight(staging, {
      projectRoot: fixture.root, cacheDir, requireProject: true,
    }),
    error => error.code === 'UNITY_PORT_PROVENANCE_REQUIRED',
  );

  const origin = path.join(fixture.root, 'Assets', 'Game', 'Scripts', 'Gameplay.cs');
  const written = writePortProvenance(fixture.root, staging, [{ source: origin, target: staged }], {
    receipt: result.receipt,
  });
  assert.equal(fs.existsSync(written.file), true);
  assert.ok(fs.statSync(written.file).size < 2 * 1024 * 1024);
  const allowed = assertUnityPortPreflight(staging, {
    projectRoot: fixture.root, cacheDir, requireProject: true,
  });
  assert.equal(allowed.binding.kind, 'staging-provenance');
  assert.equal(allowed.binding.fileCount, 1);

  assert.throws(
    () => assertUnityPortPreflight(staging, {
      projectRoot: other.root, cacheDir, requireProject: true,
    }),
    error => ['UNITY_PREFLIGHT_REQUIRED', 'UNITY_PORT_PROVENANCE_STALE'].includes(error.code),
  );

  fs.appendFileSync(staged, '// tampered staging\n', 'utf8');
  assert.throws(
    () => assertUnityPortPreflight(staging, {
      projectRoot: fixture.root, cacheDir, requireProject: true,
    }),
    error => error.code === 'UNITY_PORT_PROVENANCE_CHANGED',
  );

  fs.copyFileSync(origin, staged);
  const injected = path.join(staging, 'Injected.cs');
  fs.writeFileSync(injected, 'class Injected {}\n', 'utf8');
  assert.throws(
    () => assertUnityPortPreflight(staging, {
      projectRoot: fixture.root, cacheDir, requireProject: true,
    }),
    error => error.code === 'UNITY_PORT_PROVENANCE_CHANGED',
  );
  fs.unlinkSync(injected);

  const moved = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-port-staging-moved-'));
  t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
  const movedScript = path.join(moved, 'Game', 'Scripts', 'Gameplay.cs');
  fs.mkdirSync(path.dirname(movedScript), { recursive: true });
  fs.copyFileSync(staged, movedScript);
  fs.copyFileSync(written.file, path.join(moved, '.unity-port-provenance.json'));
  assert.throws(
    () => assertUnityPortPreflight(moved, {
      projectRoot: fixture.root, cacheDir, requireProject: true,
    }),
    error => error.code === 'UNITY_PORT_PROVENANCE_STALE',
  );

  const foreignStaging = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-port-foreign-staging-'));
  t.after(() => fs.rmSync(foreignStaging, { recursive: true, force: true }));
  const foreignOrigin = path.join(other.root, 'Assets', 'Game', 'Scripts', 'Gameplay.cs');
  const foreignTarget = path.join(foreignStaging, 'Gameplay.cs');
  fs.copyFileSync(foreignOrigin, foreignTarget);
  assert.throws(
    () => writePortProvenance(fixture.root, foreignStaging, [{
      source: foreignOrigin, target: foreignTarget,
    }], { receipt: result.receipt }),
    error => error.code === 'UNITY_PORT_PROVENANCE_ORIGIN_UNBOUND',
  );

  fs.unlinkSync(staged);
  assert.throws(
    () => assertUnityPortPreflight(staging, {
      projectRoot: fixture.root, cacheDir, requireProject: true,
    }),
    error => error.code === 'UNITY_PORT_PROVENANCE_CHANGED',
  );
});

test('realpath project comparison rejects a source junction into another Unity project', async t => {
  const first = createUnityFixture(t);
  const second = createUnityFixture(t);
  const cacheDir = cacheFixture(t);
  await runUnityPortPreflight({ project: first.root, provider: 'static', cache: false, cacheDir });
  const junction = path.join(first.root, 'ExternalProjectSource');
  try {
    fs.symlinkSync(second.assets, junction, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('Host does not allow directory symlinks/junctions.');
      return;
    }
    throw error;
  }
  assert.throws(
    () => assertUnityPortPreflight(junction, {
      projectRoot: first.root, cacheDir, requireProject: true,
    }),
    error => error.code === 'UNITY_PREFLIGHT_PROJECT_MISMATCH',
  );
});

test('explicit project root fails closed when invalid or different from the source project', async t => {
  const first = createUnityFixture(t);
  const second = createUnityFixture(t);
  const cacheDir = cacheFixture(t);
  await runUnityPortPreflight({ project: first.root, provider: 'static', cache: false, cacheDir });

  assert.throws(
    () => assertUnityPortPreflight(first.assets, {
      projectRoot: path.join(os.tmpdir(), 'missing-unity-project-root'),
      cacheDir,
    }),
    error => error.code === 'UNITY_PREFLIGHT_PROJECT_INVALID',
  );
  assert.throws(
    () => assertUnityPortPreflight(second.assets, { projectRoot: first.root, cacheDir }),
    error => error.code === 'UNITY_PREFLIGHT_PROJECT_MISMATCH',
  );
});

test('mutation receipts authorize only Assets and package roots selected by the Unity manifest', async t => {
  const fixture = createUnityFixture(t);
  const cacheDir = cacheFixture(t);
  const localPackage = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-declared-local-package-'));
  t.after(() => fs.rmSync(localPackage, { recursive: true, force: true }));
  fs.writeFileSync(path.join(localPackage, 'package.json'), JSON.stringify({
    name: 'com.test.local', version: '1.0.0',
  }), 'utf8');
  const localSource = path.join(localPackage, 'Runtime', 'Local.cs');
  fs.mkdirSync(path.dirname(localSource), { recursive: true });
  fs.writeFileSync(localSource, 'class Local {}\n', 'utf8');
  const manifestPath = path.join(fixture.root, 'Packages', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.dependencies['com.test.local'] = `file:${localPackage.replace(/\\/g, '/')}`;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const embeddedSource = fixture.write('Packages/com.test.embedded/Runtime/Embedded.cs', 'class Embedded {}\n');
  fixture.write('Packages/com.test.embedded/package.json', JSON.stringify({
    name: 'com.test.embedded', version: '1.0.0',
  }));
  const tempSource = fixture.write('Temp/Injected.cs', 'class Injected {}\n');
  const userSettingsSource = fixture.write('UserSettings/Injected.cs', 'class InjectedSettings {}\n');
  const undeclaredCache = fixture.write(
    'Library/PackageCache/com.test.undeclared@1.0.0/Runtime/Injected.cs',
    'class InjectedCache {}\n',
  );
  fixture.write('Library/PackageCache/com.test.undeclared@1.0.0/package.json', JSON.stringify({
    name: 'com.test.undeclared', version: '1.0.0',
  }));
  await runUnityPortPreflight({ project: fixture.root, provider: 'static', cache: false, cacheDir });

  assert.equal(assertUnityPortPreflight(fixture.assets, { cacheDir }).binding.kind, 'project-assets');
  assert.equal(assertUnityPortPreflight(embeddedSource, { cacheDir }).binding.kind, 'embedded-package');
  assert.equal(assertUnityPortPreflight(localSource, {
    projectRoot: fixture.root, cacheDir, requireProject: true,
  }).binding.kind, 'local-package');
  const declaredCache = path.join(
    fixture.root, 'Library', 'PackageCache', 'com.unity.addressables@2.8.1', 'Runtime', 'Config.asset');
  assert.equal(assertUnityPortPreflight(declaredCache, { cacheDir }).binding.kind, 'package-cache');
  for (const source of [tempSource, userSettingsSource, undeclaredCache]) {
    assert.throws(
      () => assertUnityPortPreflight(source, { cacheDir, requireProject: true }),
      error => error.code === 'UNITY_PREFLIGHT_SOURCE_UNBOUND',
    );
  }
});

test('receipt cache rejects an existing symlink or junction that redirects into the Unity project before mkdir', async t => {
  const fixture = createUnityFixture(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-preflight-escape-'));
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
  const cacheDir = path.join(redirect, 'must-not-be-created');
  await assert.rejects(
    runUnityPortPreflight({ project: fixture.root, provider: 'static', cache: false, cacheDir }),
    error => error.code === 'UNITY_PREFLIGHT_CACHE_INSIDE_PROJECT' || error.code === 'UNITY_PREFLIGHT_CACHE_ESCAPE',
  );
  assert.equal(fs.existsSync(path.join(fixture.root, 'must-not-be-created')), false);
});
