'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyPolicy, inspectPolicy } = require('./portable-npm-policy.cjs');

function fixture(t, pkg) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-copy-policy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  return root;
}

test('migrates npm 11 internal link syntax, preserves npmrc settings and is idempotent', t => {
  const root = fixture(t, { dependencies: { 'playable-core': 'file:./playable-shared-kit/packages/playable-core', 'playable-sdk': 'file:./playable-shared-kit/packages/playable-sdk', unrelated: '1.2.3' } });
  fs.writeFileSync(path.join(root, '.npmrc'), '# project policy\r\nregistry=https://registry.npmjs.org/\r\ninstall-links=false\r\n');
  assert.equal(applyPolicy(root).changed, true);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const rc = fs.readFileSync(path.join(root, '.npmrc'), 'utf8');
  assert.equal(pkg.dependencies.unrelated, '1.2.3');
  assert.match(rc, /registry=https:\/\/registry.npmjs.org\//);
  assert.equal(inspectPolicy(pkg, rc, { packages: {} }).ok, true);
  assert.equal(applyPolicy(root).changed, false);
});

test('copy setting alone does not clear a legacy symlink lockfile', t => {
  const root = fixture(t, {});
  applyPolicy(root);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const result = inspectPolicy(pkg, 'install-links=true\n', { packages: { 'node_modules/playable-core': { link: true } } });
  assert.equal(result.ok, false);
  assert.match(result.issues.join(), /lockfile still requests a symlink/);
  assert.equal(inspectPolicy(pkg, 'install-links=true\ninstall-links=false\n', { packages: {} }).ok, false);
});

test('custom source refusal preserves both files', t => {
  const root = fixture(t, { dependencies: { 'playable-sdk': 'https://example.invalid/sdk.tgz' } });
  const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  assert.throws(() => applyPolicy(root), /Custom playable-sdk/);
  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, '.npmrc')), false);
});
