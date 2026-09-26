'use strict';

/**
 * Portable content hash
 * =====================
 *
 * Committed evidence (core checkpoint `targetHashes`, regression receipt
 * snapshots) must hash the same on every checkout of the same commit. On
 * Windows with `core.autocrlf=true` and no `.gitattributes`, Git checks text
 * files out as CRLF on one PC and LF on another, so a raw-byte SHA-256 of the
 * working copy is checkout-dependent and portable evidence goes stale after a
 * clone.
 *
 * Contract `sha256-text-lf-v1`:
 * - Binary files are hashed byte-exact. A file is binary when its extension is
 *   a known binary asset type (png/jpg/mp3/fbx/...) or, like Git's own
 *   `buffer_is_binary`, its first 8000 bytes contain a NUL.
 * - Every other file is text: each CRLF pair is hashed as a single LF. Lone CR
 *   and lone LF bytes are kept, so the transform matches exactly what autocrlf
 *   undoes and never merges distinct line structures.
 *
 * An LF-only text file therefore hashes identically to its raw SHA-256.
 * Hashing only reads the file; it never rewrites or renormalizes a checkout.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORTABLE_HASH_CONTRACT = 'sha256-text-lf-v1';
// Git's buffer_is_binary() inspects the same window.
const BINARY_SNIFF_BYTES = 8000;
const CHUNK_BYTES = 64 * 1024;
const CR = 0x0d;
const LF = 0x0a;
const CR_BUFFER = Buffer.from([CR]);

const BINARY_EXTENSIONS = new Set([
  // images / textures
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tga', 'tif', 'tiff', 'psd', 'exr', 'hdr', 'ico',
  'ktx', 'ktx2', 'astc', 'pvr', 'dds', 'basis', 'avif', 'heic',
  // audio / video
  'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'aif', 'aiff', 'opus', 'mp4', 'webm', 'mov', 'avi',
  // models (ASCII FBX exists, but Unity/Cocos treat FBX as an opaque asset)
  'fbx', 'glb', 'blend', 'max', '3ds',
  // fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot', 'ttc',
  // archives / compiled / data blobs
  'zip', 'gz', 'tgz', '7z', 'rar', 'tar', 'br', 'zst', 'bin', 'bytes', 'db', 'sqlite', 'sqlite3',
  'wasm', 'pdf', 'cconb', 'exe', 'dll', 'so', 'dylib', 'jar', 'class', 'pyc', 'node',
]);

function isBinaryExtension(file) {
  const extension = path.extname(String(file || '')).slice(1).toLowerCase();
  return BINARY_EXTENSIONS.has(extension);
}

function looksBinary(head) {
  return head.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

function createTextNormalizer(hash) {
  let pendingCr = false;
  return {
    update(chunk) {
      if (!chunk.length) return;
      let start = 0;
      if (pendingCr) {
        pendingCr = false;
        // CR + LF across a chunk boundary: drop the CR, keep the LF below.
        if (chunk[0] !== LF) hash.update(CR_BUFFER);
      }
      let index = chunk.indexOf(CR, start);
      while (index !== -1) {
        if (index === chunk.length - 1) {
          hash.update(chunk.subarray(start, index));
          pendingCr = true;
          return;
        }
        if (chunk[index + 1] === LF) {
          hash.update(chunk.subarray(start, index));
          start = index + 1;
        }
        index = chunk.indexOf(CR, index + 1);
      }
      hash.update(chunk.subarray(start));
    },
    finish() {
      if (pendingCr) hash.update(CR_BUFFER);
      pendingCr = false;
    },
  };
}

function classifyPortableBuffer(buffer, name) {
  return isBinaryExtension(name) || looksBinary(buffer) ? 'binary' : 'text';
}

function hashPortableBuffer(buffer, name = '') {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const hash = crypto.createHash('sha256');
  if (classifyPortableBuffer(bytes, name) === 'binary') return hash.update(bytes).digest('hex');
  const normalizer = createTextNormalizer(hash);
  normalizer.update(bytes);
  normalizer.finish();
  return hash.digest('hex');
}

function hashPortableFile(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  try {
    // Buffer at least the sniff window before deciding text vs binary.
    const head = [];
    let headBytes = 0;
    let eof = false;
    while (headBytes < BINARY_SNIFF_BYTES) {
      const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
      const read = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (!read) { eof = true; break; }
      head.push(chunk.subarray(0, read));
      headBytes += read;
    }
    const headBuffer = Buffer.concat(head, headBytes);
    const binary = classifyPortableBuffer(headBuffer, file) === 'binary';
    const sink = binary ? hash : createTextNormalizer(hash);
    sink.update(headBuffer);
    if (!eof) {
      const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
      for (;;) {
        const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (!read) break;
        sink.update(buffer.subarray(0, read));
      }
    }
    if (!binary) sink.finish();
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

module.exports = {
  PORTABLE_HASH_CONTRACT,
  BINARY_SNIFF_BYTES,
  BINARY_EXTENSIONS,
  isBinaryExtension,
  classifyPortableBuffer,
  hashPortableBuffer,
  hashPortableFile,
};
