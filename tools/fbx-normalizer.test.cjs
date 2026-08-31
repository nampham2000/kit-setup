'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { isFbxFile, parseArgs, parseReceipt, resolveBlender } = require('./fbx-normalizer.cjs');

test('fbx normalizer keeps an FBX-only CLI contract', () => {
  const parsed = parseArgs(['--src', 'Unity.fbx', '--out', 'Cocos.fbx', '--mode', 'static',
    '--preserve-anchor', 'Tape_Thickness_jnt', '--dry-run', '--json']);
  assert.strictEqual(parsed.source, 'Unity.fbx');
  assert.strictEqual(parsed.destination, 'Cocos.fbx');
  assert.strictEqual(parsed.mode, 'static');
  assert.deepStrictEqual(parsed.preserveAnchors, ['Tape_Thickness_jnt']);
  assert.strictEqual(parsed.dryRun, true);
  assert.strictEqual(parsed.json, true);
});

test('fbx receipt parser and signature validation reject GLB data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx-normalizer-'));
  const fbx = path.join(root, 'mesh.fbx');
  const glb = path.join(root, 'mesh.glb');
  fs.writeFileSync(fbx, Buffer.concat([Buffer.from('Kaydara FBX Binary  \0\x1a\0', 'binary'), Buffer.alloc(96)]));
  fs.writeFileSync(glb, Buffer.concat([Buffer.from('glTF'), Buffer.alloc(96)]));
  assert.strictEqual(isFbxFile(fbx), true);
  assert.strictEqual(isFbxFile(glb), false);
  assert.deepStrictEqual(parseReceipt('x\nFBX_NORMALIZE_RESULT={"ok":true,"format":"fbx"}\ny'), { ok: true, format: 'fbx' });
});

test('fbx normalizer resolves Blender from supported portable locations when available', () => {
  const blender = resolveBlender();
  if (process.platform === 'win32' && fs.existsSync('C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe')) {
    assert.match(blender, /blender\.exe$/i);
  } else {
    assert.strictEqual(typeof blender, 'string');
  }
});
