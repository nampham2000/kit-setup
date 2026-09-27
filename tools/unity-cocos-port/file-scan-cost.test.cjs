'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findFiles } = require('../unity-cocos-port.cjs');

test('GUID scan excludes irrelevant files before costly probes but checks returned metas', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'port-scan-cost-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Textures'));
  fs.writeFileSync(path.join(root, 'Textures', 'spark.png'), 'texture');
  const meta = path.join(root, 'Textures', 'spark.png.meta');
  fs.writeFileSync(meta, 'guid: abc');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'irrelevant.meta'), 'guid: def');
  const probes = [];
  const original = fs.lstatSync;
  fs.lstatSync = function (file, ...args) {
    probes.push(path.resolve(file));
    return original.call(fs, file, ...args);
  };
  let found;
  try { found = findFiles(root, file => file.endsWith('.meta')); }
  finally { fs.lstatSync = original; }
  assert.deepEqual(found, [meta]);
  assert.ok(probes.includes(meta), 'accepted metadata still passes containment inspection');
  assert.ok(!probes.includes(path.join(root, 'Textures', 'spark.png')));
  assert.ok(!probes.includes(path.join(root, 'node_modules')));
});
