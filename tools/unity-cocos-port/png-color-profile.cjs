'use strict';

// Unity's TextureImporter ignores every colour-management chunk a PNG carries and
// uploads the raw texels. Browsers (and Cocos web's createImageBitmap without
// colorSpaceConversion:'none') apply them, so a PNG tagged with e.g. a gamma-only
// monitor ICC profile renders visibly shifted from Unity Play Mode. Removing the
// chunks leaves IDAT untouched: pixels stay byte-identical, only interpretation changes.
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_COLOR_PROFILE_CHUNKS = Object.freeze(['iCCP', 'gAMA', 'cHRM', 'sRGB', 'cICP']);
const PROFILE_SET = new Set(PNG_COLOR_PROFILE_CHUNKS);

function isPng(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);
}

// Returns chunk records, or null when the stream is not a well-formed PNG. Malformed
// input is left alone instead of being rewritten into something the importer rejects.
function pngChunks(bytes) {
  if (!isPng(bytes)) return null;
  const chunks = [];
  let offset = 8;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return null;
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    chunks.push({ type, start: offset, end });
    offset = end;
    if (type === 'IEND') break;
  }
  if (chunks[0]?.type !== 'IHDR' || chunks[chunks.length - 1]?.type !== 'IEND') return null;
  return { chunks, trailerStart: offset };
}

function pngColorProfileChunks(bytes) {
  const parsed = pngChunks(bytes);
  return parsed ? parsed.chunks.filter(chunk => PROFILE_SET.has(chunk.type)).map(chunk => chunk.type) : [];
}

// Idempotent: a PNG without profile chunks (or a non-PNG) is returned as the same Buffer.
function stripPngColorProfile(bytes) {
  const parsed = pngChunks(bytes);
  const removed = parsed ? parsed.chunks.filter(chunk => PROFILE_SET.has(chunk.type)) : [];
  if (!removed.length) return { bytes, removed: [] };
  const parts = [bytes.subarray(0, 8)];
  for (const chunk of parsed.chunks) {
    if (!PROFILE_SET.has(chunk.type)) parts.push(bytes.subarray(chunk.start, chunk.end));
  }
  parts.push(bytes.subarray(parsed.trailerStart));
  return { bytes: Buffer.concat(parts), removed: removed.map(chunk => chunk.type) };
}

module.exports = { PNG_COLOR_PROFILE_CHUNKS, isPng, pngColorProfileChunks, stripPngColorProfile };
