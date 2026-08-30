'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const { convertFontFile, decodeWoff1, isSfnt } = require('./font-converter.cjs');

function fakeWoff() {
  const table = Buffer.from('font-name-table-'.repeat(32));
  const compressed = zlib.deflateSync(table);
  const offset = 64;
  const out = Buffer.alloc(offset + compressed.length);
  out.write('wOFF', 0, 'ascii');
  out.writeUInt32BE(0x00010000, 4);
  out.writeUInt32BE(out.length, 8);
  out.writeUInt16BE(1, 12);
  out.writeUInt32BE(12 + 16 + ((table.length + 3) & ~3), 16);
  out.write('name', 44, 'ascii');
  out.writeUInt32BE(offset, 48);
  out.writeUInt32BE(compressed.length, 52);
  out.writeUInt32BE(table.length, 56);
  compressed.copy(out, offset);
  return { out, table };
}

test('decodes a WOFF 1 table directory into a loadable SFNT', () => {
  const fixture = fakeWoff();
  const decoded = decodeWoff1(fixture.out);
  assert.equal(isSfnt(decoded), true);
  const tableOffset = decoded.readUInt32BE(20);
  const tableLength = decoded.readUInt32BE(24);
  assert.deepEqual(decoded.subarray(tableOffset, tableOffset + tableLength), fixture.table);
});

test('converts WOFF to TTF without mutating the source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-converter-test-'));
  try {
    const source = path.join(root, 'source.woff');
    const output = path.join(root, 'converted.ttf');
    const fixture = fakeWoff();
    fs.writeFileSync(source, fixture.out);
    const result = convertFontFile(source, output);
    assert.equal(result.ok, true);
    assert.equal(result.backend, 'woff1-node');
    assert.equal(isSfnt(fs.readFileSync(output)), true);
    assert.deepEqual(fs.readFileSync(source), fixture.out);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('repackages an OpenType CFF SFNT behind a Cocos-supported .ttf suffix', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-converter-test-'));
  try {
    const source = path.join(root, 'source.otf');
    const output = path.join(root, 'converted.ttf');
    const bytes = Buffer.alloc(12);
    bytes.write('OTTO', 0, 'ascii');
    fs.writeFileSync(source, bytes);
    const result = convertFontFile(source, output);
    assert.equal(result.ok, true);
    assert.equal(result.backend, 'sfnt-cff-repackage');
    assert.deepEqual(fs.readFileSync(output), bytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed for an unknown font when no converter accepts it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-converter-test-'));
  try {
    const source = path.join(root, 'source.weirdfont');
    const output = path.join(root, 'converted.ttf');
    fs.writeFileSync(source, 'not-a-font');
    const result = convertFontFile(source, output, { strictInternal: true });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
