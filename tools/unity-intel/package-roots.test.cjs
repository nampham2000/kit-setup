'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { discoverPackageRoots } = require('./package-roots.cjs');
const { createUnityFixture } = require('./test-fixture.cjs');

test('package discovery selects the manifest version and emits stable logical roots', t => {
  const fixture = createUnityFixture(t);
  fixture.write('Library/PackageCache/com.unity.addressables@9.9.9/package.json', JSON.stringify({
    name: 'com.unity.addressables', version: '9.9.9',
  }));
  const result = discoverPackageRoots(fixture.root);
  const addressables = result.roots.find(root => root.packageName === 'com.unity.addressables');
  const input = result.roots.find(root => root.packageName === 'com.unity.inputsystem');

  assert.equal(addressables.packageVersion, '2.8.1');
  assert.equal(addressables.logicalPrefix, 'Packages/com.unity.addressables');
  assert.equal(input.packageVersion, '1.18.0');
  assert.deepEqual(result.unavailable, []);
});

test('embedded package takes precedence over a cached copy', t => {
  const fixture = createUnityFixture(t);
  fixture.write('Packages/com.unity.addressables/package.json', JSON.stringify({
    name: 'com.unity.addressables', version: '2.8.1-local',
  }));
  const result = discoverPackageRoots(fixture.root);
  const addressables = result.roots.find(root => root.packageName === 'com.unity.addressables');
  assert.equal(addressables.kind, 'embedded-package');
  assert.equal(addressables.packageVersion, '2.8.1-local');
});

test('package cache never authorizes a version different from manifest or lock selection', t => {
  const fixture = createUnityFixture(t);
  fixture.write('Library/PackageCache/com.unity.addressables@9.9.9/package.json', JSON.stringify({
    name: 'com.unity.addressables', version: '9.9.9',
  }));
  const exact = path.join(fixture.root, 'Library/PackageCache/com.unity.addressables@2.8.1');
  fs.rmSync(exact, { recursive: true, force: true });

  const result = discoverPackageRoots(fixture.root);
  assert.equal(result.roots.some(root => root.packageName === 'com.unity.addressables'), false);
  assert.equal(result.unavailable.includes('com.unity.addressables'), true);
});

test('git package cache uses exact projectResolution source and fingerprint, not package semver', t => {
  const fixture = createUnityFixture(t);
  const name = 'com.example.git-package';
  const specifier = 'https://github.com/example/package.git?path=/Packages/Main#v2';
  const fingerprint = 'abcdef1234567890abcdef1234567890abcdef12';
  const selectedRoot = path.join(fixture.root, 'Library', 'PackageCache', `${name}@${fingerprint.slice(0, 12)}`);
  const staleRoot = path.join(fixture.root, 'Library', 'PackageCache', `${name}@111111111111`);
  const manifestPath = path.join(fixture.root, 'Packages', 'manifest.json');
  const lockPath = path.join(fixture.root, 'Packages', 'packages-lock.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const lock = fs.existsSync(lockPath)
    ? JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    : { dependencies: {} };
  manifest.dependencies[name] = specifier;
  lock.dependencies[name] = { version: specifier, depth: 0, source: 'git', hash: 'deadbeef' };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  fixture.write(path.relative(fixture.root, path.join(selectedRoot, 'package.json')), JSON.stringify({
    name, version: '2.4.0', _fingerprint: fingerprint,
  }));
  fixture.write(path.relative(fixture.root, path.join(staleRoot, 'package.json')), JSON.stringify({
    name, version: '9.9.9', _fingerprint: '1111111111111111111111111111111111111111',
  }));
  fixture.write('Library/PackageManager/projectResolution.json', JSON.stringify({
    context: { projectPath: path.join(fixture.root, 'Packages') },
    outputs: {
      [`${name}@${specifier}`]: {
        name, source: 'git', resolvedPath: selectedRoot, fingerprint, version: '2.4.0',
      },
    },
  }));

  const result = discoverPackageRoots(fixture.root);
  const selected = result.roots.find(root => root.packageName === name);
  assert.equal(selected.physicalRoot, path.resolve(selectedRoot));
  assert.equal(selected.packageFingerprint, fingerprint);
  assert.notEqual(selected.physicalRoot, path.resolve(staleRoot));
});

test('local tarball package cache follows the canonical projectResolution path and fingerprint', t => {
  const fixture = createUnityFixture(t);
  const name = 'com.example.local-tarball';
  const specifier = 'file:../Tarballs/com.example.local-tarball.tgz';
  const fingerprint = 'fedcba9876543210fedcba9876543210';
  const selectedRoot = path.join(fixture.root, 'Library', 'PackageCache', `${name}@${fingerprint.slice(0, 12)}`);
  const staleRoot = path.join(fixture.root, 'Library', 'PackageCache', `${name}@222222222222`);
  const manifestPath = path.join(fixture.root, 'Packages', 'manifest.json');
  const lockPath = path.join(fixture.root, 'Packages', 'packages-lock.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const lock = { dependencies: {} };
  manifest.dependencies[name] = specifier;
  lock.dependencies[name] = { version: specifier, depth: 0, source: 'local-tarball', dependencies: {} };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  fixture.write(path.relative(fixture.root, path.join(selectedRoot, 'package.json')), JSON.stringify({
    name, version: '13.14.0', _fingerprint: fingerprint,
  }));
  fixture.write(path.relative(fixture.root, path.join(staleRoot, 'package.json')), JSON.stringify({
    name, version: '13.14.0', _fingerprint: '22222222222222222222222222222222',
  }));
  fixture.write('Library/PackageManager/projectResolution.json', JSON.stringify({
    context: { projectPath: path.join(fixture.root, 'Packages') },
    outputs: {
      [`${name}@file:${path.join(fixture.root, 'Tarballs', 'com.example.local-tarball.tgz')}`]: {
        name, source: 'local-tarball', resolvedPath: selectedRoot, fingerprint, version: '13.14.0',
      },
    },
  }));

  const result = discoverPackageRoots(fixture.root);
  const selected = result.roots.find(root => root.packageName === name);
  assert.equal(selected.physicalRoot, path.resolve(selectedRoot));
  assert.equal(selected.packageFingerprint, fingerprint);
  assert.notEqual(selected.physicalRoot, path.resolve(staleRoot));
});
