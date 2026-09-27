'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PORTABLE_HASH_CONTRACT,
  BINARY_SNIFF_BYTES,
  classifyPortableBuffer,
  hashPortableBuffer,
  hashPortableFile,
} = require('./portable-content-hash.cjs');

function tempDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-hash-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function rawSha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function write(root, name, bytes) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

const LF_TEXT = '{\n  "cases": [\n    { "name": "tap" }\n  ]\n}\n';
const CRLF_TEXT = LF_TEXT.replace(/\n/g, '\r\n');

test('contract id is stable so receipts can name the hash semantics they used', () => {
  assert.equal(PORTABLE_HASH_CONTRACT, 'sha256-text-lf-v1');
});

test('CRLF and LF checkouts of the same text hash equal and match the raw LF digest', t => {
  const root = tempDir(t);
  for (const name of ['matrix.json', 'assets/script/Game.ts', 'Gameplay.scene', 'Roll.prefab.meta', 'no-extension']) {
    const lf = write(path.join(root, 'lf'), name, LF_TEXT);
    const crlf = write(path.join(root, 'crlf'), name, CRLF_TEXT);
    assert.notEqual(rawSha256(fs.readFileSync(lf)), rawSha256(fs.readFileSync(crlf)), name);
    assert.equal(hashPortableFile(crlf), hashPortableFile(lf), name);
    // LF-only text keeps its plain SHA-256: nothing to fold.
    assert.equal(hashPortableFile(lf), rawSha256(Buffer.from(LF_TEXT)), name);
    assert.equal(hashPortableBuffer(Buffer.from(CRLF_TEXT), name), hashPortableFile(lf), name);
  }
});

test('mixed endings fold only CRLF pairs; lone CR stays distinct from LF', t => {
  const root = tempDir(t);
  const mixed = write(root, 'mixed.txt', 'a\r\nb\nc\r\n');
  const lf = write(root, 'lf.txt', 'a\nb\nc\n');
  assert.equal(hashPortableFile(mixed), hashPortableFile(lf));
  const loneCr = write(root, 'lone.txt', 'a\rb\n');
  const loneLf = write(root, 'lone-lf.txt', 'a\nb\n');
  assert.notEqual(hashPortableFile(loneCr), hashPortableFile(loneLf));
  assert.equal(hashPortableFile(loneCr), rawSha256(Buffer.from('a\rb\n')));
  const trailingCr = write(root, 'trailing.txt', 'a\r');
  assert.equal(hashPortableFile(trailingCr), rawSha256(Buffer.from('a\r')));
});

test('CRLF pairs split across the streaming chunk boundary still fold', t => {
  const root = tempDir(t);
  // CR is the last byte of the first 64 KiB read, LF the first byte of the next.
  const lines = ['x'.repeat(64 * 1024 - 1), 'tail', ''];
  const lf = write(root, 'big-lf.ts', lines.join('\n'));
  const crlf = write(root, 'big-crlf.ts', lines.join('\r\n'));
  assert.equal(fs.readFileSync(crlf)[64 * 1024 - 1], 0x0d);
  assert.equal(hashPortableFile(crlf), hashPortableFile(lf));
  assert.equal(hashPortableFile(crlf), hashPortableBuffer(fs.readFileSync(crlf), 'big-crlf.ts'));
  // A CR ending the first chunk that is NOT followed by LF must survive.
  const lone = Buffer.concat([Buffer.alloc(64 * 1024 - 1, 0x78), Buffer.from('\rz')]);
  const loneFile = write(root, 'lone-boundary.ts', lone);
  assert.equal(hashPortableFile(loneFile), rawSha256(lone));
});

test('binary assets stay byte-exact even when their bytes contain CRLF', t => {
  const root = tempDir(t);
  // PNG signature itself carries CRLF; git never converts binary assets.
  const pngCrlf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x41, 0x0d, 0x0a]);
  const pngLf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a, 0x1a, 0x0a, 0x41, 0x0a]);
  for (const extension of ['png', 'JPG', 'jpeg', 'mp3', 'fbx', 'ttf', 'webp']) {
    const a = write(root, `crlf/asset.${extension}`, pngCrlf);
    const b = write(root, `lf/asset.${extension}`, pngLf);
    assert.equal(classifyPortableBuffer(pngCrlf, a), 'binary', extension);
    assert.equal(hashPortableFile(a), rawSha256(pngCrlf), extension);
    assert.notEqual(hashPortableFile(a), hashPortableFile(b), extension);
  }
  // Unknown extension with a NUL in the sniff window is binary, like git.
  const blob = Buffer.from('ab\r\ncd\0ef\r\n');
  const blobFile = write(root, 'data.custom', blob);
  assert.equal(hashPortableFile(blobFile), rawSha256(blob));
  // A NUL beyond git's sniff window does not flip a text file to binary.
  const lateNul = Buffer.concat([Buffer.from('a\r\n'), Buffer.alloc(BINARY_SNIFF_BYTES, 0x61), Buffer.from('\0')]);
  const lateFile = write(root, 'late.log', lateNul);
  assert.equal(classifyPortableBuffer(lateNul, lateFile), 'text');
  assert.notEqual(hashPortableFile(lateFile), rawSha256(lateNul));
});

test('hashing never mutates the checkout it reads', t => {
  const root = tempDir(t);
  const file = write(root, 'watched.ts', CRLF_TEXT);
  const past = new Date('2001-02-03T04:05:06Z');
  fs.utimesSync(file, past, past);
  const before = { bytes: fs.readFileSync(file), mtimeMs: fs.statSync(file).mtimeMs };
  hashPortableFile(file);
  hashPortableFile(file);
  assert.deepEqual(fs.readFileSync(file), before.bytes);
  assert.equal(fs.statSync(file).mtimeMs, before.mtimeMs);
});

test('empty files hash like the empty string', t => {
  const root = tempDir(t);
  assert.equal(hashPortableFile(write(root, 'empty.json', '')), rawSha256(Buffer.alloc(0)));
  assert.equal(hashPortableFile(write(root, 'empty.png', '')), rawSha256(Buffer.alloc(0)));
});
