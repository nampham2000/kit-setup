'use strict';

/**
 * TextMeshPro -> Cocos Label vertical (baseline) parity.
 *
 * Root cause of "Cocos text sits a few pixels lower than Unity TMP":
 *
 * - TMP (com.unity.ugui 2.0 Runtime/TMP/TextMeshProUGUI.cs GenerateTextMesh, "anchorOffset")
 *   places the first baseline from the FONT ASSET FaceInfo (ascentLine/descentLine/capLine,
 *   scaled by fontSize / pointSize * scale), the rect margins and the vertical alignment mode
 *   (Top/Middle/Bottom/Baseline/Geometry(Midline)/Capline). Geometry centres the union of the
 *   visible glyph boxes (m_meshExtents), Capline centres the cap height.
 * - Cocos 3.8.8 web ignores every font metric: it places the alphabetic baseline with the fixed
 *   BASELINE_RATIO = 0.26 (cocos/2d/utils/text-utils.ts).
 *     BITMAP/NONE cache (text-processing.ts _calculateFillTextStartPosition):
 *       TOP    first baseline = padTop + 0.87F
 *       CENTER first baseline = H/2 + 0.37F - (n-1)L/2 + (padTop - padBottom)/2
 *       BOTTOM first baseline = H - padBottom - (n-1)L - 0.26F
 *     CHAR cache (text-processing.ts _computeAlignmentOffset + font-utils.ts LetterTexture):
 *       every letter quad is (1.26F + 2m) tall with the baseline F + m below its top and
 *       offsetY = -0.13F, so with outline width m:
 *       TOP    first baseline = 0.87F + m
 *       CENTER first baseline = H/2 + 0.37F + m - (n-1)L/2
 *       BOTTOM first baseline = H - (n-1)L - 0.13F + m
 *   (distances measured downwards from the top of the Label content rect, F = actual font size,
 *   L = line height, H = content height, n = line count).
 *
 * For Baloo (ascent 94.5, descent -47.16, pointSize 90) a TMP Middle label puts its baseline
 * (a+d)/2 = 0.263F below the rect centre while Cocos CENTER uses 0.37F (+ outline width in CHAR
 * mode): the Cocos glyphs are 0.107F (+m) lower. The correction below is derived only from the
 * font asset FaceInfo, glyph metrics, margins and alignment - never from a screenshot.
 */

const TMP_VERTICAL = Object.freeze({
  TOP: 256,
  MIDDLE: 512,
  BOTTOM: 1024,
  BASELINE: 2048,
  GEOMETRY: 4096,
  CAPLINE: 8192,
});

/** Cocos Label.VerticalAlign */
const COCOS_VERTICAL = Object.freeze({ TOP: 0, CENTER: 1, BOTTOM: 2 });

const BASELINE_RATIO = 0.26;

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * TMP vertical mode from m_VerticalAlignment (TMP 3.2+/ugui 2.x) or the legacy combined
 * m_textAlignment (TextAlignmentOptions: horizontal bits | vertical bits). 65535 means "use the
 * split fields".
 */
function tmpVerticalMode(verticalAlignment, textAlignment) {
  const vertical = num(verticalAlignment, NaN);
  if (Number.isFinite(vertical) && vertical > 0) return vertical & 0xff00;
  const combined = num(textAlignment, NaN);
  if (Number.isFinite(combined) && combined !== 65535) return combined & 0xff00;
  return TMP_VERTICAL.MIDDLE;
}

/** Closest Cocos Label.VerticalAlign for a TMP vertical mode (Cocos has no Baseline/Midline/Capline). */
function cocosVerticalAlignFor(mode) {
  if (mode === TMP_VERTICAL.TOP) return COCOS_VERTICAL.TOP;
  if (mode === TMP_VERTICAL.BOTTOM) return COCOS_VERTICAL.BOTTOM;
  return COCOS_VERTICAL.CENTER;
}

function normalizeFace(face) {
  const pointSize = num(face?.pointSize, 0);
  if (!(pointSize > 0)) throw new Error('TMP face.pointSize must be > 0');
  return {
    pointSize,
    scale: num(face?.scale, 1) || 1,
    ascentLine: num(face?.ascentLine),
    descentLine: num(face?.descentLine),
    capLine: num(face?.capLine),
    baseline: num(face?.baseline),
    lineHeight: num(face?.lineHeight, num(face?.ascentLine) - num(face?.descentLine)),
  };
}

/** TMP scale from font-asset units to rect units for a UGUI label. */
function tmpScale(fontSize, face) {
  const f = normalizeFace(face);
  return num(fontSize) / f.pointSize * f.scale;
}

/** TMP line advance: FaceInfo lineHeight * scale + m_lineSpacing * fontSize * 0.01. */
function tmpLineAdvance(fontSize, face, lineSpacing = 0) {
  const f = normalizeFace(face);
  return f.lineHeight * tmpScale(fontSize, f) + num(lineSpacing) * num(fontSize) * 0.01;
}

/**
 * Distance (rect units, downwards) from the TOP of the TMP RectTransform to the FIRST baseline.
 * margin = TMP m_margin {x: left, y: top, z: right, w: bottom}.
 * glyphExtents = {top, bottom} of the union of visible glyph boxes (font-asset units, relative
 * to each glyph's own baseline: max(horizontalBearingY), min(horizontalBearingY - height)); only
 * the GEOMETRY (Midline) mode needs it. `lines` > 1 assumes a uniform font (no rich-text size).
 */
function tmpFirstBaselineBelowTop(options) {
  const mode = num(options.mode, TMP_VERTICAL.MIDDLE);
  const face = normalizeFace(options.face);
  const fontSize = num(options.fontSize);
  const s = tmpScale(fontSize, face);
  const H = num(options.rectHeight);
  const my = num(options.margin?.y);
  const mw = num(options.margin?.w);
  const lines = Math.max(1, Math.floor(num(options.lines, 1)));
  const advance = options.lineAdvance != null ? num(options.lineAdvance) : tmpLineAdvance(fontSize, face, options.lineSpacing);
  // Line metrics ignore FaceInfo.baseline (only <voffset> moves them); glyph quads include it.
  const glyphBaseline = face.baseline * s * face.scale;
  const ascender = face.ascentLine * s;
  const lastDescender = face.descentLine * s - (lines - 1) * advance;
  switch (mode) {
    case TMP_VERTICAL.TOP:
      return ascender + my;
    case TMP_VERTICAL.BOTTOM:
      return H - mw + lastDescender;
    case TMP_VERTICAL.BASELINE:
      return H / 2;
    case TMP_VERTICAL.GEOMETRY: {
      if (!options.glyphExtents) throw new Error('TMP Geometry (Midline) alignment needs glyphExtents');
      const top = num(options.glyphExtents.top) * s + glyphBaseline;
      const bottom = num(options.glyphExtents.bottom) * s + glyphBaseline - (lines - 1) * advance;
      return H / 2 + (top + my + bottom - mw) / 2;
    }
    case TMP_VERTICAL.CAPLINE:
      // TextMeshProUGUI: anchorOffset.y = centre - (m_maxCapHeight - margin.y - margin.w) / 2
      return H / 2 + (face.capLine * s - my - mw) / 2;
    case TMP_VERTICAL.MIDDLE:
    default:
      return H / 2 + (ascender + my + lastDescender - mw) / 2;
  }
}

function cacheModeName(cacheMode) {
  if (cacheMode === 2 || cacheMode === 'CHAR') return 'CHAR';
  return 'BITMAP'; // NONE (0) and BITMAP (1) both draw one canvas texture
}

/**
 * Content height Cocos 3.8.8 gives a Label with Overflow.NONE (auto size).
 * BITMAP: (n + 0.26) * L + 2 * outline; CHAR: n * L + 2 * outline.
 */
function cocosAutoContentHeight(options) {
  const lines = Math.max(1, Math.floor(num(options.lines, 1)));
  const L = num(options.lineHeight) || num(options.fontSize);
  const outline = num(options.outlineWidth);
  return cacheModeName(options.cacheMode) === 'CHAR'
    ? lines * L + 2 * outline
    : (lines + BASELINE_RATIO) * L + 2 * outline;
}

/**
 * Distance (downwards) from the TOP of the Cocos Label content rect to the FIRST baseline,
 * exactly as the 3.8.8 web assemblers place it. fontSize = the ACTUAL font size (after SHRINK),
 * lineHeight = Label.lineHeight (0 = fontSize), contentHeight = UITransform height.
 * shadow = {offsetY, blur} only matters for BITMAP (CHAR ignores shadow).
 */
function cocosFirstBaselineBelowTop(options) {
  const F = num(options.fontSize);
  const L = num(options.lineHeight) || F;
  const lines = Math.max(1, Math.floor(num(options.lines, 1)));
  const H = options.contentHeight != null ? num(options.contentHeight) : cocosAutoContentHeight(options);
  const align = num(options.verticalAlign, COCOS_VERTICAL.CENTER);
  const outline = Math.max(0, num(options.outlineWidth));
  if (cacheModeName(options.cacheMode) === 'CHAR') {
    const m = outline;
    if (align === COCOS_VERTICAL.TOP) return 0.87 * F + m;
    if (align === COCOS_VERTICAL.BOTTOM) return H - (lines - 1) * L - 0.13 * F + m;
    return H / 2 + (0.5 - BASELINE_RATIO / 2) * F + m - (lines - 1) * L / 2;
  }
  let padTop = outline;
  let padBottom = outline;
  if (options.shadow) {
    const shadowWidth = num(options.shadow.blur) + outline;
    const offsetY = num(options.shadow.offsetY);
    padTop = Math.max(padTop, offsetY + shadowWidth);
    padBottom = Math.max(padBottom, -offsetY + shadowWidth);
  }
  if (align === COCOS_VERTICAL.TOP) return padTop + (1 - BASELINE_RATIO / 2) * F;
  if (align === COCOS_VERTICAL.BOTTOM) return H - padBottom - (lines - 1) * L - BASELINE_RATIO * F;
  return H / 2 + (0.5 - BASELINE_RATIO / 2) * F - (lines - 1) * L / 2 + (padTop - padBottom) / 2;
}

/**
 * Upward shift to apply to the Cocos Label content rect so its first baseline lands where TMP
 * puts it. `contentTopBelowRectTop` = how far the Cocos content top sits below the TMP rect top
 * (0 when the Label's UITransform is the TMP rect, e.g. CLAMP/SHRINK on the same node).
 * Positive = move the label UP.
 */
function tmpLabelBaselineShift(tmp, cocos, contentTopBelowRectTop = 0) {
  const tmpBaseline = tmpFirstBaselineBelowTop(tmp);
  const cocosBaseline = num(contentTopBelowRectTop) + cocosFirstBaselineBelowTop(cocos);
  return cocosBaseline - tmpBaseline;
}

// ---------------------------------------------------------------------------------------------
// TMP font asset parsing (Unity YAML, TMP_FontAsset)

function yamlNumber(text, key) {
  const match = new RegExp(`^\\s*${key}:\\s*([-+0-9.eE]+)\\s*$`, 'm').exec(text);
  return match ? Number(match[1]) : NaN;
}

/** FaceInfo of a TMP_FontAsset .asset (m_FaceInfo block). */
function parseTmpFaceInfo(assetText) {
  const text = String(assetText || '');
  const start = text.indexOf('m_FaceInfo:');
  if (start < 0) return null;
  const block = text.slice(start, start + 2000);
  const face = {
    pointSize: yamlNumber(block, 'm_PointSize'),
    scale: yamlNumber(block, 'm_Scale'),
    lineHeight: yamlNumber(block, 'm_LineHeight'),
    ascentLine: yamlNumber(block, 'm_AscentLine'),
    capLine: yamlNumber(block, 'm_CapLine'),
    meanLine: yamlNumber(block, 'm_MeanLine'),
    baseline: yamlNumber(block, 'm_Baseline'),
    descentLine: yamlNumber(block, 'm_DescentLine'),
  };
  if (!(face.pointSize > 0) || !Number.isFinite(face.ascentLine) || !Number.isFinite(face.descentLine)) return null;
  if (!Number.isFinite(face.scale) || face.scale === 0) face.scale = 1;
  if (!Number.isFinite(face.baseline)) face.baseline = 0;
  if (!Number.isFinite(face.capLine)) face.capLine = 0;
  if (!Number.isFinite(face.lineHeight)) face.lineHeight = face.ascentLine - face.descentLine;
  return face;
}

/** unicode -> {bearingY, height} from m_GlyphTable + m_CharacterTable. */
function parseTmpGlyphMetrics(assetText) {
  const text = String(assetText || '');
  const glyphStart = text.indexOf('m_GlyphTable:');
  const charStart = text.indexOf('m_CharacterTable:');
  const glyphs = new Map();
  const unicodes = new Map();
  if (glyphStart < 0 || charStart < 0) return unicodes;
  const glyphBlock = text.slice(glyphStart, charStart > glyphStart ? charStart : undefined);
  const glyphRe = /- m_Index: (\d+)\s+m_Metrics:\s+m_Width: [-+0-9.eE]+\s+m_Height: ([-+0-9.eE]+)\s+m_HorizontalBearingX: [-+0-9.eE]+\s+m_HorizontalBearingY: ([-+0-9.eE]+)/g;
  let match;
  while ((match = glyphRe.exec(glyphBlock))) glyphs.set(Number(match[1]), { height: Number(match[2]), bearingY: Number(match[3]) });
  const charBlock = text.slice(charStart);
  const charRe = /m_Unicode: (\d+)\s+m_GlyphIndex: (\d+)/g;
  while ((match = charRe.exec(charBlock))) {
    const glyph = glyphs.get(Number(match[2]));
    if (glyph) unicodes.set(Number(match[1]), glyph);
  }
  return unicodes;
}

/**
 * Union of the visible glyph boxes of `text` (font-asset units, relative to the baseline):
 * TMP m_meshExtents without the symmetric SDF padding, which cancels in the Geometry centre.
 * Missing glyphs are listed so the caller can report an evidence gap instead of guessing.
 */
function tmpGlyphExtents(glyphMetrics, text) {
  let top = -Infinity;
  let bottom = Infinity;
  const missing = [];
  for (const ch of String(text || '').replace(/<[^>]*>/g, '')) {
    if (/\s/.test(ch)) continue;
    const glyph = glyphMetrics.get(ch.codePointAt(0));
    if (!glyph) { missing.push(ch); continue; }
    if (!(glyph.height > 0)) continue;
    top = Math.max(top, glyph.bearingY);
    bottom = Math.min(bottom, glyph.bearingY - glyph.height);
  }
  if (!Number.isFinite(top)) return { top: 0, bottom: 0, missing, empty: true };
  return { top, bottom, missing, empty: false };
}

module.exports = {
  BASELINE_RATIO,
  COCOS_VERTICAL,
  TMP_VERTICAL,
  cocosAutoContentHeight,
  cocosFirstBaselineBelowTop,
  cocosVerticalAlignFor,
  parseTmpFaceInfo,
  parseTmpGlyphMetrics,
  tmpFirstBaselineBelowTop,
  tmpGlyphExtents,
  tmpLabelBaselineShift,
  tmpLineAdvance,
  tmpScale,
  tmpVerticalMode,
};
