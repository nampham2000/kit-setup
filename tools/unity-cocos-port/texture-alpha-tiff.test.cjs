'use strict';
// Unity alphaUsage FromGrayScale on TIFF sources (KriptoFX REP v4 GroundDecalEmission.tif, RGB grey;
// Crack1/Crack2.tif, single-channel grey): the PNG-only path threw TEXTURE_ALPHA_IMPORT_UNRESOLVED
// and the Cocos copy kept an opaque alpha, so the emissive crack decal drew its whole quad.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { unityTextureAlphaBytes } = require('./texture-alpha.cjs');
const { isTiff } = require('./texture-alpha-tiff.cjs');

async function fixture(channels, pixels) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-tiff-alpha-'));
  const source = path.join(dir, 'decal.tif');
  await sharp(Buffer.from(pixels), { raw: { width: pixels.length / channels, height: 1, channels } }).tiff().toFile(source);
  return { dir, source };
}

test('alpha from grayscale on a single-channel TIFF keeps the TIFF container and sets alpha = grey', async () => {
  const { dir, source } = await fixture(1, [0, 128, 255]);
  try {
    fs.writeFileSync(source + '.meta', 'TextureImporter:\n  alphaUsage: 2\n');
    const bytes = fs.readFileSync(source);
    const out = unityTextureAlphaBytes(source, bytes);
    assert.ok(isTiff(out));
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 4);
    // Expected from the fixture's own decoded grey samples (the libvips writer may requantize the input).
    const grey = [...(await sharp(source).raw().toBuffer({ resolveWithObject: true })).data].filter((_, i) => i % 3 === 0);
    assert.deepEqual([...data], grey.flatMap(g => [g, g, g, g]));
    assert.deepEqual([grey[0], grey[2]], [0, 255]);
    assert.ok(unityTextureAlphaBytes(source, bytes).equals(out), 'deterministic bytes (repeat ports do not rewrite)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('alphaUsage None on an RGB TIFF writes opaque alpha; FromInput keeps the source bytes', async () => {
  const { dir, source } = await fixture(3, [10, 20, 30, 200, 100, 50]);
  try {
    fs.writeFileSync(source + '.meta', 'TextureImporter:\n  alphaUsage: 0\n');
    const bytes = fs.readFileSync(source);
    const { data } = await sharp(unityTextureAlphaBytes(source, bytes)).raw().toBuffer({ resolveWithObject: true });
    const rgb = [...(await sharp(source).raw().toBuffer({ resolveWithObject: true })).data];
    assert.deepEqual([...data], [...rgb.slice(0, 3), 255, ...rgb.slice(3, 6), 255]);
    fs.writeFileSync(source + '.meta', 'TextureImporter:\n  alphaUsage: 1\n');
    assert.equal(unityTextureAlphaBytes(source, bytes), bytes);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
