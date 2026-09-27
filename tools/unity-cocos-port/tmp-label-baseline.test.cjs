'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const B = require('./tmp-label-baseline.cjs');

// Baloo-Regular SDF.asset (ScrewOut) FaceInfo, verbatim.
const BALOO = { pointSize: 90, scale: 1, lineHeight: 141.66, ascentLine: 94.5, capLine: 56, baseline: 0, descentLine: -47.160004 };
// Asymmetric synthetic font: tall ascender, shallow descender.
const TALL = { pointSize: 100, scale: 1, lineHeight: 110, ascentLine: 90, capLine: 70, baseline: 0, descentLine: -20 };

const close = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

test('tmpVerticalMode reads split and legacy alignment fields', () => {
  assert.equal(B.tmpVerticalMode(4096, 65535), B.TMP_VERTICAL.GEOMETRY);
  assert.equal(B.tmpVerticalMode(undefined, 514), B.TMP_VERTICAL.MIDDLE);
  assert.equal(B.tmpVerticalMode(undefined, 257), B.TMP_VERTICAL.TOP);
  assert.equal(B.tmpVerticalMode(undefined, 65535), B.TMP_VERTICAL.MIDDLE);
  assert.equal(B.cocosVerticalAlignFor(B.TMP_VERTICAL.CAPLINE), B.COCOS_VERTICAL.CENTER);
  assert.equal(B.cocosVerticalAlignFor(B.TMP_VERTICAL.BOTTOM), B.COCOS_VERTICAL.BOTTOM);
});

test('Middle: TMP centres [descentLine, ascentLine]; Cocos BITMAP CENTER uses a fixed 0.37F', () => {
  const H = 100; const F = 45;
  const tmp = B.tmpFirstBaselineBelowTop({ mode: B.TMP_VERTICAL.MIDDLE, face: BALOO, fontSize: F, rectHeight: H });
  close(tmp, H / 2 + (94.5 - 47.160004) / 2 * F / 90);
  const cocos = B.cocosFirstBaselineBelowTop({ cacheMode: 0, verticalAlign: 1, fontSize: F, contentHeight: H });
  close(cocos, H / 2 + 0.37 * F);
  // Cocos glyphs sit 0.37F - (a+d)/2 lower: 0.1070F for Baloo.
  const shift = B.tmpLabelBaselineShift(
    { mode: B.TMP_VERTICAL.MIDDLE, face: BALOO, fontSize: F, rectHeight: H },
    { cacheMode: 0, verticalAlign: 1, fontSize: F, contentHeight: H });
  close(shift, F * (0.37 - (94.5 - 47.160004) / 180));
});

test('asymmetric ascent/descent changes the Middle offset; Cocos ignores it', () => {
  const H = 80; const F = 50;
  const tall = B.tmpLabelBaselineShift({ mode: B.TMP_VERTICAL.MIDDLE, face: TALL, fontSize: F, rectHeight: H },
    { cacheMode: 0, verticalAlign: 1, fontSize: F, contentHeight: H });
  close(tall, F * (0.37 - (0.9 - 0.2) / 2)); // 0.02F
  const baloo = B.tmpLabelBaselineShift({ mode: B.TMP_VERTICAL.MIDDLE, face: BALOO, fontSize: F, rectHeight: H },
    { cacheMode: 0, verticalAlign: 1, fontSize: F, contentHeight: H });
  assert.ok(baloo > tall + 4, 'the lower (a+d)/2 of Baloo needs a larger upward shift');
});

test('Top: TMP baseline = ascentLine*s + margin.y; Cocos TOP = 0.87F', () => {
  const F = 60;
  const source = { mode: B.TMP_VERTICAL.TOP, face: BALOO, fontSize: F, rectHeight: 200, margin: { x: 0, y: 12, z: 0, w: 0 } };
  close(B.tmpFirstBaselineBelowTop(source), 94.5 * F / 90 + 12);
  const shift = B.tmpLabelBaselineShift(source, { cacheMode: 0, verticalAlign: 0, fontSize: F, contentHeight: 200 });
  close(shift, 0.87 * F - (94.5 * F / 90 + 12)); // negative: TMP sits lower than Cocos TOP here
});

test('Bottom: TMP baseline sits |descentLine| + margin.w above the bottom; Cocos BITMAP 0.26F, CHAR 0.13F - m', () => {
  const F = 40; const H = 120;
  const source = { mode: B.TMP_VERTICAL.BOTTOM, face: TALL, fontSize: F, rectHeight: H, margin: { w: 6 } };
  close(B.tmpFirstBaselineBelowTop(source), H - 6 - 20 * F / 100);
  close(B.cocosFirstBaselineBelowTop({ cacheMode: 1, verticalAlign: 2, fontSize: F, contentHeight: H }), H - 0.26 * F);
  close(B.cocosFirstBaselineBelowTop({ cacheMode: 2, verticalAlign: 2, fontSize: F, contentHeight: H, outlineWidth: 3 }), H - 0.13 * F + 3);
});

test('Baseline mode puts the baseline on the rect centre', () => {
  const F = 70; const H = 150;
  const source = { mode: B.TMP_VERTICAL.BASELINE, face: BALOO, fontSize: F, rectHeight: H, margin: { y: 30, w: 10 } };
  close(B.tmpFirstBaselineBelowTop(source), H / 2);
  close(B.tmpLabelBaselineShift(source, { cacheMode: 0, verticalAlign: 1, fontSize: F, contentHeight: H }), 0.37 * F);
});

test('Middle margins move the centre of the content box by (top - bottom) / 2', () => {
  const base = { mode: B.TMP_VERTICAL.MIDDLE, face: BALOO, fontSize: 45, rectHeight: 100 };
  const plain = B.tmpFirstBaselineBelowTop(base);
  close(B.tmpFirstBaselineBelowTop({ ...base, margin: { x: 5, y: 20, z: 5, w: 4 } }), plain + 8);
});

test('Capline centres the cap height (TMP margin signs kept verbatim)', () => {
  const F = 90; const H = 100;
  close(B.tmpFirstBaselineBelowTop({ mode: B.TMP_VERTICAL.CAPLINE, face: BALOO, fontSize: F, rectHeight: H }), H / 2 + 28);
  close(B.tmpFirstBaselineBelowTop({ mode: B.TMP_VERTICAL.CAPLINE, face: BALOO, fontSize: F, rectHeight: H, margin: { y: 4, w: 2 } }), H / 2 + 25);
});

const FONT_ASSET_YAML = [
  'MonoBehaviour:',
  '  m_FaceInfo:',
  '    m_FaceIndex: 0',
  '    m_PointSize: 90',
  '    m_Scale: 1',
  '    m_UnitsPerEM: 1000',
  '    m_LineHeight: 141.66',
  '    m_AscentLine: 94.5',
  '    m_CapLine: 56',
  '    m_MeanLine: 44',
  '    m_Baseline: 0',
  '    m_DescentLine: -47.160004',
  '  m_GlyphTable:',
  '  - m_Index: 38',
  '    m_Metrics:',
  '      m_Width: 45.71875',
  '      m_Height: 57.875',
  '      m_HorizontalBearingX: 3.15625',
  '      m_HorizontalBearingY: 56.25',
  '      m_HorizontalAdvance: 51.390625',
  '  - m_Index: 40',
  '    m_Metrics:',
  '      m_Width: 40.0625',
  '      m_Height: 54.8125',
  '      m_HorizontalBearingX: 5.84375',
  '      m_HorizontalBearingY: 54.546875',
  '      m_HorizontalAdvance: 49.3125',
  '  - m_Index: 3',
  '    m_Metrics:',
  '      m_Width: 0',
  '      m_Height: 0',
  '      m_HorizontalBearingX: 0',
  '      m_HorizontalBearingY: 0',
  '      m_HorizontalAdvance: 18',
  '  m_CharacterTable:',
  '  - m_ElementType: 1',
  '    m_Unicode: 67',
  '    m_GlyphIndex: 38',
  '  - m_ElementType: 1',
  '    m_Unicode: 69',
  '    m_GlyphIndex: 40',
  '  - m_ElementType: 1',
  '    m_Unicode: 32',
  '    m_GlyphIndex: 3',
  '',
].join('\n');

test('Geometry (Midline) centres the union of the visible glyph boxes from the TMP font asset', () => {
  const face = B.parseTmpFaceInfo(FONT_ASSET_YAML);
  assert.deepEqual({ p: face.pointSize, a: face.ascentLine, d: face.descentLine, c: face.capLine }, { p: 90, a: 94.5, d: -47.160004, c: 56 });
  const glyphs = B.parseTmpGlyphMetrics(FONT_ASSET_YAML);
  const extents = B.tmpGlyphExtents(glyphs, 'CE E<b>C</b>');
  assert.deepEqual({ top: extents.top, bottom: extents.bottom, missing: extents.missing }, { top: 56.25, bottom: 56.25 - 57.875, missing: [] });
  assert.deepEqual(B.tmpGlyphExtents(glyphs, 'CQ').missing, ['Q']);
  const F = 65; const H = 117.3838;
  const tmp = B.tmpFirstBaselineBelowTop({ mode: B.TMP_VERTICAL.GEOMETRY, face, fontSize: F, rectHeight: H, glyphExtents: extents });
  close(tmp, H / 2 + (56.25 - 1.625) / 2 * F / 90);
  assert.throws(() => B.tmpFirstBaselineBelowTop({ mode: B.TMP_VERTICAL.GEOMETRY, face, fontSize: F, rectHeight: H }), /glyphExtents/);
});

test('CHAR cache adds the outline width below the BITMAP baseline; BITMAP outline padding is symmetric', () => {
  const F = 65; const H = 117.3838; const m = 5.25;
  const bitmap = B.cocosFirstBaselineBelowTop({ cacheMode: 0, verticalAlign: 1, fontSize: F, contentHeight: H, outlineWidth: m });
  const char = B.cocosFirstBaselineBelowTop({ cacheMode: 2, verticalAlign: 1, fontSize: F, contentHeight: H, outlineWidth: m });
  close(bitmap, H / 2 + 0.37 * F);
  close(char, bitmap + m);
  const shadowed = B.cocosFirstBaselineBelowTop({ cacheMode: 0, verticalAlign: 1, fontSize: F, contentHeight: H, shadow: { offsetY: -4, blur: 2 } });
  close(shadowed, H / 2 + 0.37 * F + (0 - 6) / 2);
});

test('with Label.lineHeight = tmpLineAdvance the shift does not depend on the line count', () => {
  const F = 45; const L = B.tmpLineAdvance(F, BALOO, -10);
  close(L, 141.66 * F / 90 - 10 * F * 0.01);
  for (const [mode, align] of [[B.TMP_VERTICAL.MIDDLE, 1], [B.TMP_VERTICAL.TOP, 0], [B.TMP_VERTICAL.BOTTOM, 2]]) {
    const one = B.tmpLabelBaselineShift({ mode, face: BALOO, fontSize: F, rectHeight: 300, lineAdvance: L, lines: 1 },
      { cacheMode: 0, verticalAlign: align, fontSize: F, lineHeight: L, contentHeight: 300, lines: 1 });
    const three = B.tmpLabelBaselineShift({ mode, face: BALOO, fontSize: F, rectHeight: 300, lineAdvance: L, lines: 3 },
      { cacheMode: 0, verticalAlign: align, fontSize: F, lineHeight: L, contentHeight: 300, lines: 3 });
    close(one, three);
  }
});

test('Overflow.NONE auto content height matches the 3.8.8 assemblers', () => {
  close(B.cocosAutoContentHeight({ cacheMode: 2, lines: 1, lineHeight: 70.83, outlineWidth: 5 }), 80.83);
  close(B.cocosAutoContentHeight({ cacheMode: 0, lines: 2, lineHeight: 50, outlineWidth: 0 }), 113);
});

test('the playable-core TypeScript mirror returns the same numbers', (t) => {
  let ts;
  try { ts = require('typescript'); } catch { t.skip('typescript is not installed next to the kit'); return; }
  const file = path.join(__dirname, '../../packages/playable-core/utils/text/TmpLabelBaseline.ts');
  const out = {};
  new Function('require', 'exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText)(() => ({}), out);
  const faces = [BALOO, TALL, { ...TALL, baseline: 3, scale: 1.2 }];
  const modes = Object.values(B.TMP_VERTICAL);
  for (const face of faces) for (const mode of modes) for (const cacheMode of [0, 2]) for (const verticalAlign of [0, 1, 2]) {
    const source = { mode, face, fontSize: 57, rectHeight: 133, margin: { x: 1, y: 7, z: 2, w: 3 }, glyphExtents: { top: 60, bottom: -2 } };
    const label = { cacheMode, verticalAlign, fontSize: 57, contentHeight: 133, outlineWidth: 4 };
    close(out.tmpFirstBaselineBelowTop(source), B.tmpFirstBaselineBelowTop(source));
    close(out.cocosFirstBaselineBelowTop(label), B.cocosFirstBaselineBelowTop(label));
    close(out.tmpLabelBaselineShift(source, label, 2.5), B.tmpLabelBaselineShift(source, label, 2.5));
  }
  close(out.tmpLineAdvance(45, BALOO, -10), B.tmpLineAdvance(45, BALOO, -10));
  assert.equal(out.tmpVerticalMode(0, 514), B.tmpVerticalMode(0, 514));
  const glyphs = B.parseTmpGlyphMetrics(FONT_ASSET_YAML);
  const boxes = {};
  for (const [unicode, g] of glyphs) boxes[String.fromCodePoint(unicode)] = [g.bearingY, g.height];
  const box = { top: 0, bottom: 0 };
  assert.equal(out.tmpGlyphExtentsOf('CE EC', boxes, box), 0);
  const cjs = B.tmpGlyphExtents(glyphs, 'CE EC');
  assert.deepEqual(box, { top: cjs.top, bottom: cjs.bottom });
  assert.equal(out.tmpGlyphExtentsOf('CQ', boxes, box), 1);
});
