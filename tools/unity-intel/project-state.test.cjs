'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createUnityFixture } = require('./test-fixture.cjs');
const { computeUnityProjectState, projectKey } = require('./project-state.cjs');

test('project state is deterministic, path-private, and changes with semantic Unity source', t => {
  const fixture = createUnityFixture(t);
  const first = computeUnityProjectState(fixture.root);
  const repeated = computeUnityProjectState(fixture.root);
  assert.deepEqual(repeated, first);
  assert.match(first.fingerprint, /^[0-9a-f]{64}$/);
  assert.match(first.projectKey, /^[0-9a-f]{32}$/);
  assert.equal(JSON.stringify(first).includes(fixture.root), false);
  assert.equal(first.projectKey, projectKey(fixture.root));

  const script = path.join(fixture.root, 'Assets', 'Game', 'Scripts', 'Gameplay.cs');
  const original = fs.readFileSync(script, 'utf8');
  fs.writeFileSync(script, original.replace('DOMoveX(1f', 'DOMoveX(2f'), 'utf8');
  const changed = computeUnityProjectState(fixture.root);
  assert.notEqual(changed.fingerprint, first.fingerprint);
});

test('manifest, build settings and meta mutations invalidate project state', t => {
  const fixture = createUnityFixture(t);
  const first = computeUnityProjectState(fixture.root).fingerprint;
  const manifest = path.join(fixture.root, 'Packages', 'manifest.json');
  const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  parsed.dependencies['com.example.local'] = 'file:../Example';
  fs.writeFileSync(manifest, JSON.stringify(parsed, null, 2), 'utf8');
  const second = computeUnityProjectState(fixture.root).fingerprint;
  assert.notEqual(second, first);

  const meta = path.join(fixture.root, 'Assets', 'Game', 'Prefabs', 'Child.prefab.meta');
  fs.appendFileSync(meta, 'timeCreated: 1\n', 'utf8');
  const third = computeUnityProjectState(fixture.root).fingerprint;
  assert.notEqual(third, second);
});

test('non-hashed prefab content replacement stays detectable when size and mtime are restored', t => {
  const fixture = createUnityFixture(t);
  const prefab = path.join(fixture.root, 'Assets', 'Game', 'Prefabs', 'Child.prefab');
  const original = fs.readFileSync(prefab, 'utf8');
  const stat = fs.statSync(prefab);
  const first = computeUnityProjectState(fixture.root).fingerprint;
  const replacement = original.replace('ChildPrefab', 'OtherPrefab');
  assert.equal(Buffer.byteLength(replacement), Buffer.byteLength(original));
  fs.writeFileSync(prefab, replacement, 'utf8');
  fs.utimesSync(prefab, stat.atime, stat.mtime);
  const second = computeUnityProjectState(fixture.root).fingerprint;
  assert.notEqual(second, first);
});
