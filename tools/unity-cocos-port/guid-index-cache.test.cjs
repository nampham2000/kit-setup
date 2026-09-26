'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');

// The porter GUID index is reused across processes for the same receipt fingerprint
// (the receipt pins every Unity .meta); another fingerprint rescans.
function childIndex(root, cache, fingerprint) {
  const script = `const p=require(${JSON.stringify(path.join(__dirname, '..', 'unity-cocos-port.cjs'))});
    const env=p.prepareUnityPortChildEnv({unityRoot:${JSON.stringify(root)}},{projectRoot:${JSON.stringify(root)},receipt:{receiptId:'r',integrity:'i',stateFingerprint:${JSON.stringify(fingerprint)}}});
    const file=JSON.parse(env.CC_PLAYABLE_PARENT_GUID_INDEX||Object.values(env).find(v=>String(v).includes('"file"'))).file;
    process.stdout.write(JSON.stringify(require('fs').existsSync(file)?JSON.parse(require('fs').readFileSync(file,'utf8')).records.map(r=>r.guid).sort():[]));
    p.cleanupUnityPortChildEnv(env);`;
  const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, CC_PLAYABLE_UNITY_INTEL_CACHE: cache }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('GUID index cache is keyed by the receipt state fingerprint', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guid-index-'));
  const cache = path.join(root, 'cache');
  fs.mkdirSync(path.join(root, 'Assets'));
  fs.writeFileSync(path.join(root, 'Assets', 'a.png.meta'), 'fileFormatVersion: 2\nguid: aaa111\n');
  assert.deepEqual(childIndex(root, cache, 'state-1'), ['aaa111']);
  fs.writeFileSync(path.join(root, 'Assets', 'b.png.meta'), 'fileFormatVersion: 2\nguid: bbb222\n');
  assert.deepEqual(childIndex(root, cache, 'state-1'), ['aaa111'], 'same fingerprint reuses the cached scan');
  assert.deepEqual(childIndex(root, cache, 'state-2'), ['aaa111', 'bbb222'], 'a new fingerprint rescans');
});
