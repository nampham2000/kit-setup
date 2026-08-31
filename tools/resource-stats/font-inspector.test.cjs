'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspectFontFile, scriptsForCodepoints } = require('./font-inspector.cjs');

function makeFormat12Font(groups) {
  const cmap = Buffer.alloc(12 + 16 + groups.length * 12);
  cmap.writeUInt16BE(0, 0);
  cmap.writeUInt16BE(1, 2);
  cmap.writeUInt16BE(3, 4);
  cmap.writeUInt16BE(10, 6);
  cmap.writeUInt32BE(12, 8);
  cmap.writeUInt16BE(12, 12);
  cmap.writeUInt16BE(0, 14);
  cmap.writeUInt32BE(16 + groups.length * 12, 16);
  cmap.writeUInt32BE(0, 20);
  cmap.writeUInt32BE(groups.length, 24);
  groups.forEach(([start, end], index) => {
    const offset = 28 + index * 12;
    cmap.writeUInt32BE(start, offset);
    cmap.writeUInt32BE(end, offset + 4);
    cmap.writeUInt32BE(1 + index * 100, offset + 8);
  });

  const font = Buffer.alloc(28 + cmap.length);
  font.writeUInt32BE(0x00010000, 0);
  font.writeUInt16BE(1, 4);
  font.write('cmap', 12, 4, 'ascii');
  font.writeUInt32BE(28, 20);
  font.writeUInt32BE(cmap.length, 24);
  cmap.copy(font, 28);
  return font;
}

test('font inspector flags a used font with non-Latin script coverage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-inspector-'));
  const file = path.join(dir, 'multilingual.ttf');
  fs.writeFileSync(file, makeFormat12Font([[0x20, 0x7e], [0x400, 0x45f]]));
  try {
    const info = inspectFontFile(file, 'PLAY');
    assert.equal(info.multilingual, true);
    assert.deepEqual(info.scripts, ['Basic Latin', 'Cyrillic']);
    assert.equal(info.requiredGlyphs, 4);
    assert.ok(info.excessRatio > 0.9);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BMFont and script classification stay deterministic', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmfont-inspector-'));
  const file = path.join(dir, 'basic.fnt');
  fs.writeFileSync(file, 'info face="Basic"\nchars count=2\nchar id=65 x=0\nchar id=66 x=1\n');
  try {
    const info = inspectFontFile(file, 'AB');
    assert.equal(info.multilingual, false);
    assert.equal(info.glyphCount, 2);
    assert.deepEqual(scriptsForCodepoints(new Set([0x41, 0x3a9])), ['Basic Latin', 'Greek']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
