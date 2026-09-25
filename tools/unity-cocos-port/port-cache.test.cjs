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
