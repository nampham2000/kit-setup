'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SCRIPT_RANGES = [
  ['Basic Latin', 0x0020, 0x007e],
  ['Latin Extended', 0x00a0, 0x024f],
  ['Greek', 0x0370, 0x03ff],
  ['Cyrillic', 0x0400, 0x052f],
  ['Hebrew', 0x0590, 0x05ff],
  ['Arabic', 0x0600, 0x06ff],
  ['Devanagari', 0x0900, 0x097f],
  ['Thai', 0x0e00, 0x0e7f],
  ['Hiragana/Katakana', 0x3040, 0x30ff],
  ['CJK', 0x3400, 0x9fff],
  ['Hangul', 0xac00, 0xd7af],
];

function readUInt16(buffer, offset) {
  if (offset < 0 || offset + 2 > buffer.length) return 0;
  return buffer.readUInt16BE(offset);
}

function readUInt32(buffer, offset) {
  if (offset < 0 || offset + 4 > buffer.length) return 0;
  return buffer.readUInt32BE(offset);
}

function sfntTables(buffer) {
  if (buffer.length < 12) return { tables: new Map(), error: 'Font is too small for an SFNT header.' };
  const signature = buffer.subarray(0, 4).toString('ascii');
  if (signature === 'wOF2') return { tables: new Map(), error: 'WOFF2 coverage inspection is not supported yet.' };
  if (signature === 'wOFF') {
    const numTables = readUInt16(buffer, 12);
    const tables = new Map();
    for (let index = 0; index < numTables; index += 1) {
      const record = 44 + index * 20;
      if (record + 20 > buffer.length) break;
      const tag = buffer.subarray(record, record + 4).toString('ascii');
      const offset = readUInt32(buffer, record + 4);
      const compressedLength = readUInt32(buffer, record + 8);
      const originalLength = readUInt32(buffer, record + 12);
      if (!compressedLength || offset + compressedLength > buffer.length) continue;
      const payload = buffer.subarray(offset, offset + compressedLength);
      try {
        tables.set(tag, compressedLength < originalLength ? zlib.inflateSync(payload) : Buffer.from(payload));
      } catch (_) { /* malformed table is reported through missing cmap */ }
    }
    return { tables, format: 'WOFF' };
  }

  const scalar = readUInt32(buffer, 0);
  if (![0x00010000, 0x4f54544f, 0x74727565, 0x74797031].includes(scalar)) {
    return { tables: new Map(), error: `Unsupported font signature ${JSON.stringify(signature)}.` };
  }
  const numTables = readUInt16(buffer, 4);
  const tables = new Map();
  for (let index = 0; index < numTables; index += 1) {
    const record = 12 + index * 16;
    if (record + 16 > buffer.length) break;
    const tag = buffer.subarray(record, record + 4).toString('ascii');
    const offset = readUInt32(buffer, record + 8);
    const length = readUInt32(buffer, record + 12);
    if (length && offset + length <= buffer.length) tables.set(tag, buffer.subarray(offset, offset + length));
  }
  return { tables, format: scalar === 0x4f54544f ? 'OpenType/CFF' : 'TrueType/OpenType' };
}

function codepointsFromFormat12(table, offset) {
  const points = new Set();
  const groups = readUInt32(table, offset + 12);
  const budget = 250_000;
  for (let index = 0; index < groups && points.size < budget; index += 1) {
    const base = offset + 16 + index * 12;
    if (base + 12 > table.length) break;
    const start = readUInt32(table, base);
    const end = Math.min(readUInt32(table, base + 4), 0x10ffff);
    for (let codepoint = start; codepoint <= end && points.size < budget; codepoint += 1) points.add(codepoint);
  }
  return points;
}

function codepointsFromFormat4(table, offset) {
  const points = new Set();
  const length = readUInt16(table, offset + 2);
  const end = Math.min(table.length, offset + length);
  const segCount = readUInt16(table, offset + 6) / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const deltas = startCodes + segCount * 2;
  const rangeOffsets = deltas + segCount * 2;
  for (let segment = 0; segment < segCount; segment += 1) {
    const start = readUInt16(table, startCodes + segment * 2);
    const finish = readUInt16(table, endCodes + segment * 2);
    const delta = readUInt16(table, deltas + segment * 2);
    const rangeOffset = readUInt16(table, rangeOffsets + segment * 2);
    for (let codepoint = start; codepoint <= finish && codepoint !== 0xffff; codepoint += 1) {
      let glyph = 0;
      if (rangeOffset === 0) glyph = (codepoint + delta) & 0xffff;
      else {
        const glyphOffset = rangeOffsets + segment * 2 + rangeOffset + (codepoint - start) * 2;
        if (glyphOffset + 2 <= end) glyph = readUInt16(table, glyphOffset);
      }
      if (glyph !== 0) points.add(codepoint);
    }
  }
  return points;
}

function cmapCodepoints(table) {
  if (!table || table.length < 12) return new Set();
  const count = readUInt16(table, 2);
  const candidates = [];
  for (let index = 0; index < count; index += 1) {
    const record = 4 + index * 8;
    if (record + 8 > table.length) break;
    const platform = readUInt16(table, record);
    const encoding = readUInt16(table, record + 2);
    const offset = readUInt32(table, record + 4);
    const format = readUInt16(table, offset);
    if (format === 12 || format === 4) candidates.push({ platform, encoding, offset, format });
  }
  candidates.sort((a, b) => (b.format - a.format) || (Number(b.platform === 3) - Number(a.platform === 3)));
  if (!candidates.length) return new Set();
  const selected = candidates[0];
  return selected.format === 12 ? codepointsFromFormat12(table, selected.offset) : codepointsFromFormat4(table, selected.offset);
}

function scriptsForCodepoints(codepoints) {
  const scripts = [];
  for (const [name, start, end] of SCRIPT_RANGES) {
    let found = false;
    for (const codepoint of codepoints) {
      if (codepoint >= start && codepoint <= end) {
        found = true;
        break;
      }
    }
    if (found) scripts.push(name);
  }
  return scripts;
}

function parseBmFont(text) {
  const codepoints = new Set();
  for (const match of text.matchAll(/\bchar\s+id=(\d+)/g)) codepoints.add(Number(match[1]));
  return codepoints;
}

function inspectFontFile(file, requiredCharacters = '') {
  const ext = path.extname(file).toLowerCase();
  let codepoints = new Set();
  let format = ext.slice(1).toUpperCase();
  let error = '';
  try {
    if (ext === '.fnt') {
      codepoints = parseBmFont(fs.readFileSync(file, 'utf8'));
      format = 'BMFont';
    } else {
      const parsed = sfntTables(fs.readFileSync(file));
      format = parsed.format || format;
      error = parsed.error || '';
      codepoints = cmapCodepoints(parsed.tables.get('cmap'));
      if (!error && codepoints.size === 0) error = 'No supported Unicode cmap format (4 or 12) was found.';
    }
  } catch (inspectionError) {
    error = inspectionError?.message || String(inspectionError);
  }

  const scripts = scriptsForCodepoints(codepoints);
  const extendedScripts = scripts.filter((name) => name !== 'Basic Latin');
  const required = new Set(Array.from(String(requiredCharacters || '')).map((character) => character.codePointAt(0)));
  const requiredGlyphs = [...required].filter((codepoint) => codepoints.has(codepoint)).length;
  const multilingual = extendedScripts.length > 0;
  return {
    format,
    glyphCount: codepoints.size,
    scripts,
    multilingual,
    requiredCharacterCount: required.size,
    requiredGlyphs,
    excessGlyphs: Math.max(0, codepoints.size - requiredGlyphs),
    excessRatio: codepoints.size > 0 && required.size > 0 ? Number(((codepoints.size - requiredGlyphs) / codepoints.size).toFixed(3)) : null,
    reason: multilingual
      ? `Font includes ${extendedScripts.join(', ')} coverage beyond Basic Latin.`
      : 'No multilingual script range beyond Basic Latin was detected.',
    error: error || null,
  };
}

module.exports = {
  SCRIPT_RANGES,
  cmapCodepoints,
  inspectFontFile,
  parseBmFont,
  scriptsForCodepoints,
  sfntTables,
};
