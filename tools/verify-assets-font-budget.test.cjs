'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { FONT_MAX_BYTES, run } = require('./verify-assets.cjs');

function projectWithFont(size) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-font-budget-'));
  const fonts = path.join(root, 'assets', 'resources', 'fonts');
  fs.mkdirSync(fonts, { recursive: true });
  const file = path.join(fonts, 'Playable.ttf');
  fs.writeFileSync(file, Buffer.alloc(size));
  fs.writeFileSync(`${file}.meta`, JSON.stringify({
    ver: '1.0.0',
    importer: 'ttf-font',
    imported: true,
    uuid: '11111111-1111-4111-8111-111111111111',
    files: ['Playable.ttf'],
    subMetas: {},
  }));
  return root;
}

test('asset verification fails closed above the 100 KiB TTF budget', () => {
  const root = projectWithFont(FONT_MAX_BYTES + 1);
  try {
    const report = run({ projectRoot: root });
    assert.equal(report.status, 'FAIL');
    assert.equal(report.fontFilesScanned, 1);
    assert.equal(report.overBudgetFonts.length, 1);
    assert.match(report.errors.join('\n'), /FONT OVER BUDGET/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('asset verification accepts a TTF exactly at the hard limit', () => {
  const root = projectWithFont(FONT_MAX_BYTES);
  try {
    const report = run({ projectRoot: root });
    assert.equal(report.status, 'PASS');
    assert.equal(report.overBudgetFonts.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
