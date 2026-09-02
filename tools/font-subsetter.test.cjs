'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { BASIC_LATIN, parseArgs, run } = require('./font-subsetter.cjs');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function makeFormat12Font(groups) {
  const cmap = Buffer.alloc(12 + 16 + groups.length * 12);
  cmap.writeUInt16BE(0, 0);
  cmap.writeUInt16BE(1, 2);
  cmap.writeUInt16BE(3, 4);
  cmap.writeUInt16BE(10, 6);
  cmap.writeUInt32BE(12, 8);
  cmap.writeUInt16BE(12, 12);
  cmap.writeUInt32BE(16 + groups.length * 12, 16);
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

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'font-subsetter-'));
  const source = makeFormat12Font([[0x20, 0x7e], [0x400, 0x45f]]);
  const output = Buffer.concat([makeFormat12Font([[0x20, 0x7e]]), Buffer.from([0])]);
  fs.mkdirSync(path.join(root, 'source'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'resources', 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'source', 'Full.ttf'), source);
  fs.writeFileSync(path.join(root, 'assets', 'resources', 'fonts', 'Subset.ttf'), output);
  fs.writeFileSync(path.join(root, 'assets', 'resources', 'fonts', 'Subset.ttf.meta'), '{"uuid":"font-test"}\n');
  const manifest = {
    schemaVersion: 1,
    fonts: [{
      id: 'fixture-font',
      source: { root: 'project', path: 'source/Full.ttf', sha256: sha256(source) },
      output: 'assets/resources/fonts/Subset.ttf',
      preset: 'basic-latin',
      requiredTexts: ['Playable 123!'],
      targetBytes: 81920,
      maxBytes: 102400,
    }],
  };
  fs.writeFileSync(path.join(root, 'tools', 'font-subsets.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, source, output };
}

test('argument parser rejects unknown and conflicting modes before project reads', () => {
  assert.throws(() => parseArgs(['--wat']), /Unknown argument/);
  assert.throws(() => parseArgs(['--write', '--verify']), /Conflicting modes/);
  assert.equal(parseArgs(['--help', '--config', 'missing.json']).help, true);
});

test('verify is read-only and checks the complete declared glyph inventory', async () => {
  const item = fixture();
  try {
    const outputPath = path.join(item.root, 'assets', 'resources', 'fonts', 'Subset.ttf');
    const before = fs.readFileSync(outputPath);
    const report = await run({ mode: 'verify', config: 'tools/font-subsets.json', projectRoot: item.root, unityProject: '' });
    assert.equal(report.ok, true);
    assert.equal(report.results[0].requiredGlyphs, new Set(BASIC_LATIN).size);
    assert.deepEqual(fs.readFileSync(outputPath), before);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test('write preserves Cocos meta and unchanged generation is idempotent', async () => {
  const item = fixture();
  try {
    const outputPath = path.join(item.root, 'assets', 'resources', 'fonts', 'Subset.ttf');
    const metaPath = `${outputPath}.meta`;
    const subset = makeFormat12Font([[0x20, 0x7e]]);
    const dependencies = { subsetFont: async () => subset };
    const options = { mode: 'write', config: 'tools/font-subsets.json', projectRoot: item.root, unityProject: '' };
    const metaBefore = fs.readFileSync(metaPath);
    const first = await run(options, dependencies);
    assert.equal(first.ok, true);
    assert.equal(first.results[0].status, 'written');
    assert.deepEqual(fs.readFileSync(metaPath), metaBefore);
    const statBefore = fs.statSync(outputPath);
    const second = await run(options, dependencies);
    const statAfter = fs.statSync(outputPath);
    assert.equal(second.results[0].status, 'unchanged');
    assert.equal(statAfter.mtimeMs, statBefore.mtimeMs);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});
