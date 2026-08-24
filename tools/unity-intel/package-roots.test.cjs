'use strict';

const assert = require('node:assert/strict');
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
