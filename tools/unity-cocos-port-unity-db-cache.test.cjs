'use strict';

// portPrefab reuses one scanned Unity GUID index per process (folder batches port hundreds of
// prefabs; rescanning every .meta per prefab dominated the run).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { scannedUnityAssetDatabase } = require('./unity-cocos-port.cjs');

test('the same roots return the same scanned database; other roots get their own', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-db-cache-'));
  const a = path.join(root, 'A', 'Assets');
  const b = path.join(root, 'B', 'Assets');
  for (const [dir, guid] of [[a, 'aa11'], [b, 'bb22']]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Thing.prefab'), '%YAML 1.1\n');
    fs.writeFileSync(path.join(dir, 'Thing.prefab.meta'), `fileFormatVersion: 2\nguid: ${guid}\n`);
  }
  const first = scannedUnityAssetDatabase(a);
  assert.equal(first.get('aa11').stem, 'Thing');
  // A file added after the scan is not seen: the project is immutable during a port run.
  fs.writeFileSync(path.join(a, 'Late.prefab.meta'), 'fileFormatVersion: 2\nguid: cc33\n');
  const again = scannedUnityAssetDatabase(a);
  assert.equal(again, first);
  assert.equal(again.get('cc33'), null);
  const other = scannedUnityAssetDatabase(b);
  assert.notEqual(other, first);
  assert.equal(other.get('bb22').stem, 'Thing');
  assert.equal(other.get('aa11'), null);
});
