'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { stripPngColorProfile, pngColorProfileChunks } = require('./png-color-profile.cjs');
const { encodeRgba } = require('./texture-alpha.cjs');
const { decodePng } = require('../resource-stats.cjs');
const createPorter = require('./asset-import-porter');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'png-color-profile-'));
test.after(() => {
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(root).startsWith('png-color-profile-'));
  fs.rmSync(root, { recursive: true });
});

// Gem Hunter's SPrite_UI_Panel_rounded.png raw texel: Unity Play Mode shows exactly this.
const RAW = [246, 158, 90, 255];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
// Inserts ancillary chunks right after IHDR, where the PNG spec places colour chunks.
function withChunks(png, chunks) {
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8);
  return Buffer.concat([png.subarray(0, ihdrEnd), ...chunks, png.subarray(ihdrEnd)]);
}
function solid(width, height, rgba) {
  return encodeRgba(width, height, Buffer.from(Array.from({ length: width * height }, () => rgba).flat()));
}
let iccpChunk;
async function iccTaggedPng(width = 8, height = 4) {
  // Lift the real iCCP chunk (sharp's bundled Display P3 profile) from a donor PNG and
  // inject it into a raw-encoded PNG, so the fixture texels are exactly RAW.
  if (!iccpChunk) {
    const donor = await sharp(solid(1, 1, RAW)).withMetadata({ icc: 'p3' }).png().toBuffer();
    for (let offset = 8; offset < donor.length;) {
      const length = donor.readUInt32BE(offset);
      if (donor.toString('latin1', offset + 4, offset + 8) === 'iCCP') iccpChunk = donor.subarray(offset, offset + 12 + length);
      offset += 12 + length;
    }
    assert.ok(iccpChunk, 'sharp donor PNG must carry an iCCP chunk');
  }
  const gamma = Buffer.alloc(4); gamma.writeUInt32BE(80000);
  return withChunks(solid(width, height, RAW),
    [iccpChunk, chunk('gAMA', gamma), chunk('cHRM', Buffer.alloc(32, 1)), chunk('sRGB', Buffer.from([0]))]);
}
async function browserLikePixel(bytes) {
  const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return [...data.subarray(0, 4)];
}
function project(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'assets/resources'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'unity'), { recursive: true });
  return dir;
}
const reporter = () => {
  const entries = [];
  return { entries, add: (level, code) => entries.push({ level, code }), low: code => entries.push({ level: 'low', code }) };
};
const porter = createPorter({ ensureDirectoryMetas() {}, ensurePreparedAssetMeta() { return true; } });

test('fixture profile is effective: colour-managed decode differs from Unity raw texels', async () => {
  const bytes = await iccTaggedPng();
  assert.deepEqual(pngColorProfileChunks(bytes).sort(), ['cHRM', 'gAMA', 'iCCP', 'sRGB']);
  assert.deepEqual([...decodePng(bytes).rgba.subarray(0, 4)], RAW);
  assert.notDeepEqual(await browserLikePixel(bytes), RAW);
});

test('ported PNG drops colour chunks, keeps raw texels, source bytes and idempotence', async () => {
  const dir = project('copy');
  const source = path.join(dir, 'unity/panel.png');
  const sourceBytes = await iccTaggedPng();
  fs.writeFileSync(source, sourceBytes);
  const asset = { path: source, relativePath: 'UI/panel.png' };
  const first = reporter();
  const dest = porter.copyUnityAssetToCocos(asset, { cocosRoot: dir }, first, 'image');
  const output = fs.readFileSync(dest);
  assert.deepEqual(pngColorProfileChunks(output), []);
  assert.deepEqual([...decodePng(output).rgba], [...decodePng(sourceBytes).rgba]);
  assert.deepEqual(await browserLikePixel(output), RAW);
  assert.deepEqual(fs.readFileSync(source), sourceBytes);
  assert.ok(first.entries.some(entry => entry.code === 'TEXTURE_COLOR_PROFILE_STRIPPED'));

  const stamp = fs.statSync(dest).mtimeMs;
  const second = reporter();
  porter.copyUnityAssetToCocos(asset, { cocosRoot: dir }, second, 'image');
  assert.equal(fs.statSync(dest).mtimeMs, stamp, 'unchanged texture must not be rewritten');
  assert.deepEqual(fs.readFileSync(dest), output);
  assert.ok(!second.entries.some(entry => ['ASSET_REFRESHED', 'TEXTURE_COLOR_PROFILE_STRIPPED'].includes(entry.code)));
  assert.equal(porter.writePreparedUnityTexture(asset, dest, { cocosRoot: dir }, reporter()), 'unchanged');

  // A Cocos copy from an older port (profile still embedded) is refreshed in place.
  fs.writeFileSync(dest, sourceBytes);
  const stale = reporter();
  assert.equal(porter.writePreparedUnityTexture(asset, dest, { cocosRoot: dir }, stale), 'refreshed');
  assert.deepEqual(fs.readFileSync(dest), output);
});

test('configured resize decodes raw texels instead of converting through the ICC profile', async () => {
  const dir = project('resize');
  const source = path.join(dir, 'unity/panel.png');
  fs.writeFileSync(source, await iccTaggedPng(64, 32));
  fs.writeFileSync(path.join(dir, 'assets/resources/playable-config.json'),
    JSON.stringify({ custom: { assetImport: { textureMaxSizes: { 'UI/panel.png': 16 } } } }));
  const asset = { path: source, relativePath: 'UI/panel.png' };
  const dest = porter.copyUnityAssetToCocos(asset, { cocosRoot: dir }, reporter(), 'image');
  const output = fs.readFileSync(dest);
  const image = decodePng(output);
  assert.equal(image.width, 16);
  assert.equal(image.height, 8);
  assert.deepEqual(pngColorProfileChunks(output), []);
  assert.deepEqual([...image.rgba.subarray(0, 4)], RAW);
  assert.equal(porter.writePreparedUnityTexture(asset, dest, { cocosRoot: dir }, reporter()), 'unchanged');
});

test('alphaUsage conversion composes with profile stripping and stays idempotent', async () => {
  const dir = project('alpha');
  const source = path.join(dir, 'unity/panel.png');
  fs.writeFileSync(source, await iccTaggedPng());
  fs.writeFileSync(source + '.meta', 'TextureImporter:\n  alphaUsage: 0\n');
  const asset = { path: source, relativePath: 'UI/panel.png' };
  const dest = porter.copyUnityAssetToCocos(asset, { cocosRoot: dir }, reporter(), 'image');
  assert.deepEqual([...decodePng(fs.readFileSync(dest)).rgba.subarray(0, 4)], RAW);
  assert.deepEqual(pngColorProfileChunks(fs.readFileSync(dest)), []);
  assert.equal(porter.writePreparedUnityTexture(asset, dest, { cocosRoot: dir }, reporter()), 'unchanged');
});

test('stripper is lossless, idempotent and leaves non-PNG or malformed input alone', async () => {
  const tagged = await iccTaggedPng();
  const { bytes, removed } = stripPngColorProfile(tagged);
  assert.deepEqual(removed.sort(), ['cHRM', 'gAMA', 'iCCP', 'sRGB']);
  const again = stripPngColorProfile(bytes);
  assert.equal(again.bytes, bytes);
  assert.deepEqual(again.removed, []);
  const plain = solid(2, 2, RAW);
  assert.equal(stripPngColorProfile(plain).bytes, plain);
  const jpeg = Buffer.from([255, 216, 255, 217]);
  assert.equal(stripPngColorProfile(jpeg).bytes, jpeg);
  const truncated = tagged.subarray(0, 60);
  assert.equal(stripPngColorProfile(truncated).bytes, truncated);
});
