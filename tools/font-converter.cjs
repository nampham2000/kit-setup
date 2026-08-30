#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const SFNT_TRUE_TYPE = new Set(['00010000', '74727565', '74797031']);
const SFNT_OPEN_TYPE = '4f54544f'; // OTTO / CFF OpenType. Browsers accept it through a .ttf URL.

function sfntFlavor(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return '';
  return buffer.subarray(0, 4).toString('hex');
}

function isSfnt(buffer) {
  const flavor = sfntFlavor(buffer);
  return SFNT_TRUE_TYPE.has(flavor) || flavor === SFNT_OPEN_TYPE;
}

function align4(value) {
  return (value + 3) & ~3;
}

function sfntSearchFields(numTables) {
  let maxPower = 1;
  let entrySelector = 0;
  while ((maxPower << 1) <= numTables) {
    maxPower <<= 1;
    entrySelector++;
  }
  return {
    searchRange: maxPower * 16,
    entrySelector,
    rangeShift: numTables * 16 - maxPower * 16,
  };
}

/** Decode a WOFF 1 container into its original SFNT table directory. */
function decodeWoff1(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'wOFF') {
    throw new Error('Input is not a WOFF 1 font');
  }
  const declaredLength = buffer.readUInt32BE(8);
  const numTables = buffer.readUInt16BE(12);
  if (!numTables || numTables > 4096 || declaredLength > buffer.length) throw new Error('Invalid WOFF header');

  const records = [];
  let outputOffset = 12 + numTables * 16;
  for (let index = 0; index < numTables; index++) {
    const cursor = 44 + index * 20;
    if (cursor + 20 > buffer.length) throw new Error('Truncated WOFF table directory');
    const tag = buffer.subarray(cursor, cursor + 4);
    const offset = buffer.readUInt32BE(cursor + 4);
    const compressedLength = buffer.readUInt32BE(cursor + 8);
    const originalLength = buffer.readUInt32BE(cursor + 12);
    const checksum = buffer.readUInt32BE(cursor + 16);
    if (!originalLength || offset + compressedLength > buffer.length) throw new Error('Invalid WOFF table bounds');
    const stored = buffer.subarray(offset, offset + compressedLength);
    const data = compressedLength < originalLength ? zlib.inflateSync(stored) : Buffer.from(stored);
    if (data.length !== originalLength) throw new Error(`WOFF table ${tag.toString('ascii')} length mismatch`);
    records.push({ tag, checksum, originalLength, outputOffset, data });
    outputOffset = align4(outputOffset + originalLength);
  }

  const output = Buffer.alloc(outputOffset);
  buffer.copy(output, 0, 4, 8); // WOFF flavor is the original SFNT version.
  output.writeUInt16BE(numTables, 4);
  const search = sfntSearchFields(numTables);
  output.writeUInt16BE(search.searchRange, 6);
  output.writeUInt16BE(search.entrySelector, 8);
  output.writeUInt16BE(search.rangeShift, 10);
  records.forEach((record, index) => {
    const cursor = 12 + index * 16;
    record.tag.copy(output, cursor);
    output.writeUInt32BE(record.checksum >>> 0, cursor + 4);
    output.writeUInt32BE(record.outputOffset, cursor + 8);
    output.writeUInt32BE(record.originalLength, cursor + 12);
    record.data.copy(output, record.outputOffset);
  });
  if (!isSfnt(output)) throw new Error('WOFF flavor is not a supported SFNT font');
  return output;
}

function extractEotSfnt(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) throw new Error('Truncated EOT font');
  const fontDataSize = buffer.readUInt32LE(4);
  if (!fontDataSize || fontDataSize > buffer.length) throw new Error('Invalid EOT fontDataSize');
  const font = buffer.subarray(buffer.length - fontDataSize);
  if (!isSfnt(font)) throw new Error('EOT does not contain an embedded SFNT font');
  return Buffer.from(font);
}

function commandExists(command) {
  const probe = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
    encoding: 'utf8', windowsHide: true,
  });
  return probe.status === 0;
}

function runFontTools(source, target) {
  for (const python of ['python3', 'python']) {
    if (!commandExists(python)) continue;
    const script = [
      'import sys',
      'from fontTools.ttLib import TTFont',
      'font=TTFont(sys.argv[1])',
      'font.flavor=None',
      'font.save(sys.argv[2])',
    ].join(';');
    const result = spawnSync(python, ['-c', script, source, target], {
      encoding: 'utf8', windowsHide: true, timeout: 120000,
    });
    if (result.status === 0 && fs.existsSync(target) && isSfnt(fs.readFileSync(target))) return `fonttools:${python}`;
  }
  return '';
}

function runFontForge(source, target) {
  if (!commandExists('fontforge')) return '';
  const result = spawnSync('fontforge', [
    '-lang=ff', '-c', 'Open($1); Generate($2);', source, target,
  ], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  return result.status === 0 && fs.existsSync(target) && isSfnt(fs.readFileSync(target)) ? 'fontforge' : '';
}

function runWoff2Decompress(source, target) {
  if (!commandExists('woff2_decompress')) return '';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-font-'));
  try {
    const tempSource = path.join(tempRoot, `${path.basename(source, path.extname(source))}.woff2`);
    fs.copyFileSync(source, tempSource);
    const result = spawnSync('woff2_decompress', [tempSource], {
      encoding: 'utf8', windowsHide: true, timeout: 120000,
    });
    const generated = tempSource.replace(/\.woff2$/i, '.ttf');
    if (result.status !== 0 || !fs.existsSync(generated) || !isSfnt(fs.readFileSync(generated))) return '';
    fs.copyFileSync(generated, target);
    return 'woff2_decompress';
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function convertFontFile(source, target, options = {}) {
  const input = path.resolve(source);
  const output = path.resolve(target);
  if (!fs.existsSync(input)) return { ok: false, code: 'FONT_SOURCE_MISSING', message: `Font not found: ${input}` };
  if (input === output) return { ok: false, code: 'FONT_OUTPUT_EQUALS_SOURCE', message: 'Output must differ from source' };
  const bytes = fs.readFileSync(input);
  const ext = path.extname(input).toLowerCase();
  let converted = null;
  let backend = '';
  try {
    if (isSfnt(bytes)) {
      // An OpenType/CFF SFNT is browser-loadable through Cocos' .ttf loader. We
      // preserve its outlines and only give the copied asset a supported suffix.
      converted = bytes;
      backend = sfntFlavor(bytes) === SFNT_OPEN_TYPE ? 'sfnt-cff-repackage' : 'sfnt-copy';
    } else if (ext === '.woff' || bytes.toString('ascii', 0, 4) === 'wOFF') {
      converted = decodeWoff1(bytes);
      backend = 'woff1-node';
    } else if (ext === '.eot') {
      converted = extractEotSfnt(bytes);
      backend = 'eot-extract';
    }
  } catch (error) {
    if (options.strictInternal) {
      return { ok: false, code: 'FONT_INTERNAL_CONVERSION_FAILED', message: error.message };
    }
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (converted) fs.writeFileSync(output, converted);
  if (!converted) {
    backend = runWoff2Decompress(input, output)
      || runFontTools(input, output)
      || runFontForge(input, output);
  }
  if (!backend || !fs.existsSync(output) || !isSfnt(fs.readFileSync(output))) {
    fs.rmSync(output, { force: true });
    return {
      ok: false,
      code: 'FONT_CONVERSION_UNAVAILABLE',
      message: 'No safe converter accepted this font. Install fonttools, FontForge, or woff2_decompress.',
    };
  }
  return { ok: true, backend, source: input, output, flavor: sfntFlavor(fs.readFileSync(output)) };
}

function parseArgs(argv) {
  const options = { source: '', output: '', json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--src' || arg === '--source') options.source = argv[++index] || '';
    else if (arg === '--out' || arg === '--output') options.output = argv[++index] || '';
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help || !options.source || !options.output) {
    console.log('Usage: node tools/font-converter.cjs --src <font> --out <font.ttf> [--json]');
    return options.help ? 0 : 2;
  }
  const result = convertFontFile(options.source, options.output);
  console.log(options.json ? JSON.stringify(result) : (result.ok
    ? `[font-converter] ${result.backend}: ${result.output}`
    : `[font-converter] ${result.code}: ${result.message}`));
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  convertFontFile,
  decodeWoff1,
  extractEotSfnt,
  isSfnt,
  parseArgs,
  sfntFlavor,
};
