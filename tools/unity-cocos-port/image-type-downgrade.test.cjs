'use strict';

// An image used by a UI sprite and a particle material: the particle port asked for type 'texture' and
// dropped the SpriteFrame the UI prefab references (Blast Shooter's glow1.png: "<uuid>@f9941 is missing").
// A sprite-frame image keeps its texture sub-asset, so texture requests must not downgrade it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ensureImageAssetMeta } = require('../unity-cocos-port.cjs');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000020000000208060000007278dc690000000c4944415478da63f8ffff3f0005fe02fea73581e40000000049454e44ae426082', 'hex');

test('texture requests never downgrade a sprite-frame image; new particle textures stay textures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-type-'));
  const file = path.join(dir, 'glow1.png');
  fs.writeFileSync(file, PNG);
  assert.equal(ensureImageAssetMeta(file, { particleTexture: true }).userData.type, 'texture');
  assert.equal(ensureImageAssetMeta(file, { imageType: 'sprite-frame' }).userData.type, 'sprite-frame');
  assert.equal(ensureImageAssetMeta(file, { particleTexture: true }).userData.type, 'sprite-frame');
  assert.equal(ensureImageAssetMeta(file, { imageType: 'texture' }).userData.type, 'sprite-frame');
  fs.rmSync(dir, { recursive: true, force: true });
});
