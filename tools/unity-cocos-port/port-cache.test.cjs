'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PortCache, optionsFingerprint } = require('./port-cache');

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-port-cache-'));
  const source = path.join(dir, 'Fx.prefab');
  const output = path.join(dir, 'Fx.cocos.prefab');
  fs.writeFileSync(source, 'source');
  fs.writeFileSync(output, 'output');
  return { dir, source, output, cacheFile: path.join(dir, 'port-cache.json') };
}

test('the options key binds the porter code fingerprint', () => {
  const key = JSON.parse(optionsFingerprint({}));
  assert.match(key.porter, /^[0-9a-f]{16}$/);
});

test('an entry recorded by different porter code is never reused', () => {
  const { dir, source, output, cacheFile } = workspace();
  try {
    const first = new PortCache(cacheFile, {}, true);
    first.record(source, output);
    first.save();
    assert.equal(new PortCache(cacheFile, {}, true).canSkip(source, output), true, 'same porter, unchanged files');

    // Simulate a cache written by an older porter build.
    const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const oldKey = JSON.parse(raw.optionsKey);
    oldKey.porter = '0000000000000000';
    raw.optionsKey = JSON.stringify(oldKey);
    fs.writeFileSync(cacheFile, JSON.stringify(raw));
    assert.equal(new PortCache(cacheFile, {}, true).canSkip(source, output), false, 'porter code changed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('output that waits for an AssetDB import is not cached, so the requested rerun binds it', () => {
  const { Reporter } = require('./reporter');
  const reporter = new Reporter();
  reporter.high('LINE_RENDERER_ADAPTER_REQUIRED', 'Fx.prefab', 'Line', 'unsupported alignment');
  assert.equal(reporter.needsRerun(), false);
  reporter.high('WIND_ZONE_RUNTIME_REQUIRED', 'Fx.prefab', 'Wind', 'AssetDB must import assets/script/UnityWindZone.ts; refresh and rerun porter.');
  assert.equal(reporter.needsRerun(), true);
  const skinned = new Reporter();
  skinned.medium('SKINNED_MESH_PENDING', 'Fx.prefab', 'Body', 'Model copied for AssetDB import; refresh and rerun the porter to bind the skinned mesh.');
  assert.equal(skinned.needsRerun(), true);
  const batch = fs.readFileSync(path.join(__dirname, '..', 'unity-cocos-port.cjs'), 'utf8');
  assert.match(batch, /if \(!result\.failed && !reporter\.needsRerun\(\)\) cache\.record\(/);
});
