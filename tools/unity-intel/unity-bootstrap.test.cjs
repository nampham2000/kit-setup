'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  UPSTREAM_PACKAGE_NAME,
  UPSTREAM_PACKAGE_SPEC,
  SCANNER_PACKAGE_NAME,
  SCANNER_PACKAGE_VERSION,
  OPENUPM_URL,
  OPENUPM_REQUIRED_SCOPES,
  validateScannerPackageSpec,
  acquireProjectBootstrapLock,
  setupUnityMcpPackages,
  rollbackUnityMcpPackages,
} = require('./unity-bootstrap.cjs');
const { validateUnityProject } = require('./unity-editor.cjs');
const { createUnityFixture } = require('./test-fixture.cjs');

function createTempDir(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createScannerPackage(t, overrides = {}) {
  const root = createTempDir(t, 'unity-intelligence-package-');
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: overrides.name || SCANNER_PACKAGE_NAME,
    version: overrides.version || SCANNER_PACKAGE_VERSION,
  }, null, 2)}\n`, 'utf8');
  return { root, spec: `file:${root.replace(/\\/g, '/')}` };
}

function listBackups(storageRoot) {
  if (!fs.existsSync(storageRoot)) return [];
  return fs.readdirSync(storageRoot).filter(name => name.endsWith('.manifest.json')).sort();
}

test('installs exact pinned packages, merges OpenUPM, and rolls back exact manifest bytes', t => {
  const fixture = createUnityFixture(t);
  const scanner = createScannerPackage(t);
  const storageDir = createTempDir(t, 'unity-bootstrap-storage-');
  const manifestPath = path.join(fixture.root, 'Packages', 'manifest.json');
  const lockPath = fixture.write('Packages/packages-lock.json', '{"sentinel":"lock"}\n');
  const metaPath = path.join(fixture.root, 'Assets', 'Game', 'Scenes', 'Main.unity.meta');
  const originalManifest = Buffer.from([
    '{',
    '    "dependencies": {',
    '        "com.example.keep": "1.2.3",',
    `        "${UPSTREAM_PACKAGE_NAME}": "0.1.0"`,
    '    },',
    '    "scopedRegistries": [',
    '        {',
    '            "name": "Private",',
    '            "url": "https://packages.example.test",',
    '            "scopes": ["com.example"]',
    '        },',
    '        {',
    '            "name": "Existing OpenUPM",',
    `            "url": "${OPENUPM_URL}/",`,
    '            "scopes": ["com.google"]',
    '        }',
    '    ]',
    '}',
    '',
  ].join('\r\n'), 'utf8');
  fs.writeFileSync(manifestPath, originalManifest);
  const originalLock = fs.readFileSync(lockPath);
  const originalMeta = fs.readFileSync(metaPath);

  const result = setupUnityMcpPackages(fixture.root, {
    scannerPackageSpec: scanner.spec,
    storageDir,
  });

  assert.equal(result.changed, true);
  assert.deepEqual(fs.readFileSync(result.backupFile), originalManifest);
  const installed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(installed.dependencies[UPSTREAM_PACKAGE_NAME], UPSTREAM_PACKAGE_SPEC);
  assert.equal(installed.dependencies[SCANNER_PACKAGE_NAME], scanner.spec);
  assert.equal(installed.dependencies['com.example.keep'], '1.2.3');
  assert.deepEqual(installed.scopedRegistries[0], {
    name: 'Private', url: 'https://packages.example.test', scopes: ['com.example'],
  });
  assert.equal(installed.scopedRegistries[1].name, 'Existing OpenUPM');
  assert.equal(installed.scopedRegistries[1].url, `${OPENUPM_URL}/`);
  assert.deepEqual(installed.scopedRegistries[1].scopes,
    ['com.google', ...OPENUPM_REQUIRED_SCOPES]);
  assert.deepEqual(fs.readFileSync(lockPath), originalLock);
  assert.deepEqual(fs.readFileSync(metaPath), originalMeta);
  assert.equal(fs.readdirSync(path.dirname(manifestPath)).some(name => name.endsWith('.tmp')), false);

  const rollback = rollbackUnityMcpPackages(result.transaction);
  assert.equal(rollback.rolledBack, true);
  assert.deepEqual(fs.readFileSync(manifestPath), originalManifest);
  assert.deepEqual(fs.readFileSync(lockPath), originalLock);
  assert.deepEqual(fs.readFileSync(metaPath), originalMeta);
});

test('second setup is idempotent and performs no manifest or backup write', t => {
  const fixture = createUnityFixture(t);
  const scanner = createScannerPackage(t);
  const storageDir = createTempDir(t, 'unity-bootstrap-idempotent-');
  const options = { scannerPackageSpec: scanner.spec, storageDir };
  const first = setupUnityMcpPackages(fixture.root, options);
  const manifestBytes = fs.readFileSync(first.manifestPath);
  const manifestMtime = fs.statSync(first.manifestPath).mtimeMs;
  const backups = listBackups(first.storageRoot);

  const second = setupUnityMcpPackages(fixture.root, options);

  assert.equal(second.changed, false);
  assert.equal(second.backupFile, null);
  assert.equal(second.transaction, null);
  assert.deepEqual(fs.readFileSync(first.manifestPath), manifestBytes);
  assert.equal(fs.statSync(first.manifestPath).mtimeMs, manifestMtime);
  assert.deepEqual(listBackups(first.storageRoot), backups);
  assert.equal(fs.existsSync(path.join(first.storageRoot, 'bootstrap.lock')), false);
});

test('rejects corrupt manifest before backup or manifest write', t => {
  const fixture = createUnityFixture(t);
  const scanner = createScannerPackage(t);
  const storageDir = createTempDir(t, 'unity-bootstrap-corrupt-');
  const manifestPath = path.join(fixture.root, 'Packages', 'manifest.json');
  const corrupt = Buffer.from('{broken', 'utf8');
  fs.writeFileSync(manifestPath, corrupt);

  assert.throws(
    () => setupUnityMcpPackages(fixture.root, { scannerPackageSpec: scanner.spec, storageDir }),
    error => error.code === 'UNITY_MANIFEST_CORRUPT',
  );
  assert.deepEqual(fs.readFileSync(manifestPath), corrupt);
  const projectKeyDirs = fs.readdirSync(storageDir);
  assert.equal(projectKeyDirs.every(name => listBackups(path.join(storageDir, name)).length === 0), true);
});

test('rejects a Packages junction that escapes the Unity project', t => {
  const fixture = createUnityFixture(t);
  const scanner = createScannerPackage(t);
  const storageDir = createTempDir(t, 'unity-bootstrap-symlink-storage-');
  const outside = createTempDir(t, 'unity-bootstrap-symlink-target-');
  fs.writeFileSync(path.join(outside, 'manifest.json'), '{"dependencies":{}}\n', 'utf8');
  fs.rmSync(path.join(fixture.root, 'Packages'), { recursive: true, force: true });
  try {
    fs.symlinkSync(outside, path.join(fixture.root, 'Packages'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`Symlink creation unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  assert.throws(
    () => setupUnityMcpPackages(fixture.root, { scannerPackageSpec: scanner.spec, storageDir }),
    error => error.code === 'UNITY_MANIFEST_SYMLINK_ESCAPE',
  );
  assert.equal(fs.readFileSync(path.join(outside, 'manifest.json'), 'utf8'), '{"dependencies":{}}\n');
});

test('project transaction lock prevents concurrent bootstrap writers', t => {
  const fixture = createUnityFixture(t);
  const scanner = createScannerPackage(t);
  const storageDir = createTempDir(t, 'unity-bootstrap-lock-');
  const project = validateUnityProject(fixture.root);
  const owned = acquireProjectBootstrapLock(project, { storageDir });
  t.after(() => owned.release());

  assert.throws(
    () => setupUnityMcpPackages(fixture.root, { scannerPackageSpec: scanner.spec, storageDir }),
    error => error.code === 'UNITY_BOOTSTRAP_PROJECT_LOCKED',
  );
  assert.equal(fs.existsSync(owned.lockFile), true);
  owned.release();
  assert.equal(fs.existsSync(owned.lockFile), false);
});

test('setup CAS refuses a concurrent manifest change and preserves that change', t => {
  const fixture = createUnityFixture(t);
  const scanner = createScannerPackage(t);
  const storageDir = createTempDir(t, 'unity-bootstrap-setup-cas-');
  const manifestPath = path.join(fixture.root, 'Packages', 'manifest.json');
  const concurrent = Buffer.from('{"dependencies":{"user.concurrent":"1.0.0"}}\n', 'utf8');

  assert.throws(
    () => setupUnityMcpPackages(fixture.root, {
      scannerPackageSpec: scanner.spec,
      storageDir,
      beforeAtomicWrite: () => fs.writeFileSync(manifestPath, concurrent),
    }),
    error => error.code === 'UNITY_BOOTSTRAP_CAS_CONFLICT',
  );
  assert.deepEqual(fs.readFileSync(manifestPath), concurrent);
});

test('rollback CAS refuses to overwrite user changes made after setup', t => {
  const fixture = createUnityFixture(t);
  const scanner = createScannerPackage(t);
  const storageDir = createTempDir(t, 'unity-bootstrap-rollback-cas-');
  const setup = setupUnityMcpPackages(fixture.root, { scannerPackageSpec: scanner.spec, storageDir });
  const manifest = JSON.parse(fs.readFileSync(setup.manifestPath, 'utf8'));
  manifest.dependencies['user.after-setup'] = '2.0.0';
  fs.writeFileSync(setup.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const userBytes = fs.readFileSync(setup.manifestPath);

  assert.throws(
    () => rollbackUnityMcpPackages(setup.transaction),
    error => error.code === 'UNITY_BOOTSTRAP_ROLLBACK_CONFLICT',
  );
  assert.deepEqual(fs.readFileSync(setup.manifestPath), userBytes);
});

test('local scanner spec is pinned to the canonical package identity', t => {
  const fixture = createUnityFixture(t);
  const wrong = createScannerPackage(t, { version: '0.2.1' });
  const project = validateUnityProject(fixture.root);

  assert.throws(
    () => validateScannerPackageSpec(wrong.spec, project),
    error => error.code === 'UNITY_SCANNER_PACKAGE_IDENTITY_MISMATCH',
  );
  assert.throws(
    () => validateScannerPackageSpec('https://example.test/scanner.git', project),
    error => error.code === 'UNITY_SCANNER_SPEC_INVALID',
  );

  const relativeRoot = path.join(fixture.root, 'LocalScanner');
  fs.mkdirSync(relativeRoot);
  fs.writeFileSync(path.join(relativeRoot, 'package.json'), `${JSON.stringify({
    name: SCANNER_PACKAGE_NAME,
    version: SCANNER_PACKAGE_VERSION,
  })}\n`, 'utf8');
  const relative = validateScannerPackageSpec('file:../LocalScanner', project);
  assert.equal(relative.packageRoot, fs.realpathSync(relativeRoot));
  assert.equal(relative.spec, 'file:../LocalScanner');
});
