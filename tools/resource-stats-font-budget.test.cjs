'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PlayableResourceStats, renderCliReport } = require('./resource-stats.cjs');

function makeFormat12Font(groups, minimumSize = 0) {
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
  const font = Buffer.alloc(Math.max(28 + cmap.length, minimumSize));
  font.writeUInt32BE(0x00010000, 0);
  font.writeUInt16BE(1, 4);
  font.write('cmap', 12, 4, 'ascii');
  font.writeUInt32BE(28, 20);
  font.writeUInt32BE(cmap.length, 24);
  cmap.copy(font, 28);
  return font;
}

test('preview-only stats expose runtime-config fonts and never require buildInfo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-stats-font-'));
  try {
    const fonts = path.join(root, 'assets', 'resources', 'fonts');
    fs.mkdirSync(fonts, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n');
    fs.writeFileSync(path.join(root, 'assets', 'resources', 'playable-config.json'), JSON.stringify({
      custom: { titleFont: 'fonts/Large' },
    }));
    const fontPath = path.join(fonts, 'Large.ttf');
    fs.writeFileSync(fontPath, makeFormat12Font([[0x20, 0x7e], [0x400, 0x45f]], 120 * 1024));
    fs.writeFileSync(`${fontPath}.meta`, JSON.stringify({
      ver: '1.0.0',
      importer: 'ttf-font',
      imported: true,
      uuid: '22222222-2222-4222-8222-222222222222',
      files: ['Large.ttf'],
      subMetas: {},
    }));

    const stats = new PlayableResourceStats(root, {}).scanAll();
    assert.equal(stats.hasBuildData, false);
    assert.equal(stats.buildInfo.hasBuild, false);
    assert.equal(stats.fontUsage.usedAssetFonts, 1);
    assert.equal(stats.fontUsage.overBudgetAssetFonts, 1);
    assert.equal(stats.fontBudgetViolations[0].relPath, 'assets/resources/fonts/Large.ttf');

    const original = console.log;
    console.log = () => {};
    try {
      assert.doesNotThrow(() => renderCliReport(stats, {}));
    } finally {
      console.log = original;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
