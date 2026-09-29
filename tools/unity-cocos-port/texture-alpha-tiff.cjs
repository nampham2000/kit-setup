'use strict';
// TIFF sources for Unity TextureImporter alphaUsage (texture-alpha.cjs). The porter API is
// synchronous, so sharp runs in this file as a worker (spawnSync), like the resize worker in
// texture-import-limit.js. The Cocos copy keeps the TIFF container (the destination keeps the
// Unity file name and extension): decoded raw texels (ICC ignored, as Unity does), alpha replaced
// per alphaUsage, re-encoded as an RGBA deflate TIFF. Deterministic bytes, so a repeat port
// compares equal and never rewrites the file.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const isTiff = bytes => bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
  || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a));

// alphaUsage 0 (None): opaque; 2 (FromGrayScale): the RGB average, as the PNG path.
function applyAlpha(rgba, mode) {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i + 3] = mode === 0 ? 255 : Math.round((rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3);
  }
  return rgba;
}

async function convert(source, destination, mode) {
  const sharp = require('sharp');
  // Raw decoded samples, no colourspace conversion (a b-w -> sRGB conversion shifts grey levels).
  const { data, info } = await sharp(source, { ignoreIcc: true }).raw().toBuffer({ resolveWithObject: true });
  if (info.depth !== 'uchar') throw Error('TIFF alpha: only 8-bit samples are supported, got ' + info.depth);
  const c = info.channels, count = info.width * info.height, rgba = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i++) {
    const grey = c <= 2;
    rgba[i * 4] = data[i * c];
    rgba[i * 4 + 1] = grey ? data[i * c] : data[i * c + 1];
    rgba[i * 4 + 2] = grey ? data[i * c] : data[i * c + 2];
    rgba[i * 4 + 3] = c === 2 || c === 4 ? data[i * c + c - 1] : 255;
  }
  const bytes = await sharp(applyAlpha(rgba, mode), { raw: { width: info.width, height: info.height, channels: 4 } })
    .tiff({ compression: 'deflate', predictor: 'horizontal' }).toBuffer();
  fs.writeFileSync(destination, bytes);
}

function unityTiffAlphaBytes(source, bytes, mode) {
  const temporary = path.join(os.tmpdir(), `unity-tiff-alpha-${process.pid}-${Date.now()}.tif`);
  const input = temporary.replace(/\.tif$/, '-in.tif');
  try {
    fs.writeFileSync(input, bytes);
    const worker = spawnSync(process.execPath, [__filename, input, temporary, String(mode)], { encoding: 'utf8', windowsHide: true });
    if (worker.status !== 0) throw Error(worker.stderr || 'TIFF alpha worker failed');
    return fs.readFileSync(temporary);
  } finally {
    for (const file of [input, temporary]) if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

module.exports = { isTiff, unityTiffAlphaBytes, applyAlpha };

if (require.main === module) {
  const [source, destination, mode] = process.argv.slice(2);
  convert(source, destination, Number(mode)).catch(error => { console.error(error); process.exitCode = 1; });
}
