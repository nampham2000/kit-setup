'use strict';

// End to end: a TextMeshProUGUI label ported by port.prefab gets its Cocos content rect moved by
// the FaceInfo-derived baseline difference (UITransform anchorY), and lineHeight = TMP advance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { tmpLabelBaselineShift } = require('./tmp-label-baseline.cjs');

const FONT_GUID = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
const TTF_GUID = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';
const FACE = { pointSize: 90, scale: 1, lineHeight: 141.66, ascentLine: 94.5, capLine: 56, baseline: 0, descentLine: -47.160004 };

function meta(file, guid) {
  fs.writeFileSync(`${file}.meta`, `fileFormatVersion: 2\nguid: ${guid}\n`);
}

function tmpPrefab(vertical, margin, text) {
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &1
GameObject:
  m_Name: Title
  m_IsActive: 1
  m_Component:
  - component: {fileID: 2}
  - component: {fileID: 3}
--- !u!224 &2
RectTransform:
  m_GameObject: {fileID: 1}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
  m_AnchorMin: {x: 0.5, y: 0.5}
  m_AnchorMax: {x: 0.5, y: 0.5}
  m_AnchoredPosition: {x: 0, y: 0}
  m_SizeDelta: {x: 400, y: 120}
  m_Pivot: {x: 0.5, y: 0.5}
--- !u!114 &3
MonoBehaviour:
  m_GameObject: {fileID: 1}
  m_Enabled: 1
  m_Script: {fileID: 11500000, guid: f4688fdb7df04437aeb418b961361dc5, type: 3}
  m_text: ${text}
  m_fontAsset: {fileID: 11400000, guid: ${FONT_GUID}, type: 2}
  m_fontColor: {r: 1, g: 1, b: 1, a: 1}
  m_fontSize: 65
  m_fontSizeBase: 65
  m_fontStyle: 0
  m_HorizontalAlignment: 2
  m_VerticalAlignment: ${vertical}
  m_textAlignment: 65535
  m_lineSpacing: 0
  m_enableAutoSizing: 0
  m_margin: {x: ${margin.x}, y: ${margin.y}, z: ${margin.z}, w: ${margin.w}}
`;
}

function fontAsset() {
  return [
    '%YAML 1.1',
    '--- !u!114 &11400000',
    'MonoBehaviour:',
    '  m_Name: Baloo SDF',
    `  m_SourceFontFileGUID: ${TTF_GUID}`,
    '  m_FaceInfo:',
    '    m_FamilyName: Baloo',
    '    m_PointSize: 90',
    '    m_Scale: 1',
    '    m_LineHeight: 141.66',
    '    m_AscentLine: 94.5',
    '    m_CapLine: 56',
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
    '  m_CharacterTable:',
    '  - m_ElementType: 1',
    '    m_Unicode: 67',
    '    m_GlyphIndex: 38',
    '',
  ].join('\n');
}

function port(t, name, vertical, margin, text) {
  const { portPrefab, parseArgs } = require('../unity-cocos-port.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `tmp-baseline-${name}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unity = path.join(root, 'unity');
  const cocos = path.join(root, 'cocos');
  fs.mkdirSync(path.join(unity, 'Assets', 'Fonts'), { recursive: true });
  fs.mkdirSync(path.join(cocos, 'assets'), { recursive: true });
  const ttf = path.join(unity, 'Assets', 'Fonts', 'Baloo.ttf');
  fs.writeFileSync(ttf, Buffer.from([0, 1, 0, 0, 0, 0, 0, 0]));
  meta(ttf, TTF_GUID);
  const sdf = path.join(unity, 'Assets', 'Fonts', 'Baloo SDF.asset');
  fs.writeFileSync(sdf, fontAsset());
  meta(sdf, FONT_GUID);
  const source = path.join(unity, 'Assets', 'Title.prefab');
  fs.writeFileSync(source, tmpPrefab(vertical, margin, text));
  const out = path.join(cocos, 'assets', 'Title.prefab');
  portPrefab(parseArgs(['port', '--src', source, '--out', out, '--unity-root', unity, '--cocos-root', cocos,
    '--overwrite', '--no-cache', '--no-import-wait', '--no-engine-feature-repair', '--report', path.join(root, 'report.csv')]));
  const objects = JSON.parse(fs.readFileSync(out, 'utf8'));
  const label = objects.find((o) => o.__type__ === 'cc.Label');
  const transform = objects.find((o) => o.__type__ === 'cc.UITransform' && o.node.__id__ === label.node.__id__);
  return { label, transform, report: fs.readFileSync(path.join(root, 'report.csv'), 'utf8') };
}

test('Geometry (Midline) TMP label: anchorY moves the content up by the glyph-box derived shift', (t) => {
  const { label, transform, report } = port(t, 'geometry', 4096, { x: 0, y: 0, z: 0, w: 0 }, 'CCC');
  const expected = tmpLabelBaselineShift(
    { mode: 4096, face: FACE, fontSize: 65, rectHeight: 120, glyphExtents: { top: 56.25, bottom: 56.25 - 57.875 } },
    { cacheMode: 0, verticalAlign: 1, fontSize: 65, contentHeight: 120 });
  assert.ok(expected > 4 && expected < 5, `Baloo CCC at 65: ${expected}`);
  assert.equal(label._verticalAlign, 1);
  assert.ok(Math.abs(transform._anchorPoint.y - (0.5 - expected / 120)) < 1e-9, JSON.stringify(transform._anchorPoint));
  assert.ok(Math.abs(label._lineHeight - 141.66 * 65 / 90) < 1e-9, `lineHeight ${label._lineHeight}`);
  assert.match(report, /TMP_LABEL_BASELINE_ALIGNED/);
});

test('Top TMP label with a top margin: the shift includes ascentLine and margin.y', (t) => {
  const { transform } = port(t, 'top', 256, { x: 0, y: 10, z: 0, w: 0 }, 'CONTINUE');
  const expected = 0.87 * 65 - (94.5 * 65 / 90 + 10);
  assert.ok(Math.abs(transform._anchorPoint.y - (0.5 - expected / 120)) < 1e-9, JSON.stringify(transform._anchorPoint));
});
