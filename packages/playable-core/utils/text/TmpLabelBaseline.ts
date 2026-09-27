/**
 * TextMeshPro -> Cocos Label vertical (baseline) parity. Component-free, zero allocation.
 *
 * TMP (com.unity.ugui 2.x TextMeshProUGUI.GenerateTextMesh "anchorOffset") places the first
 * baseline from the font asset FaceInfo (ascentLine/descentLine/capLine * fontSize / pointSize *
 * scale), m_margin and the vertical mode (Top/Middle/Bottom/Baseline/Geometry(Midline)/Capline).
 * Cocos 3.8.8 web ignores font metrics and uses BASELINE_RATIO = 0.26:
 *   BITMAP/NONE: TOP 0.87F + padTop | CENTER H/2 + 0.37F - (n-1)L/2 + (padTop-padBottom)/2 |
 *                BOTTOM H - padBottom - (n-1)L - 0.26F
 *   CHAR:        TOP 0.87F + m | CENTER H/2 + 0.37F + m - (n-1)L/2 | BOTTOM H - (n-1)L - 0.13F + m
 * (downwards from the Label content top; F = actual font size, m = outline width).
 * The shift is independent of the line count as long as Label.lineHeight = tmpLineAdvance().
 *
 * Mirror of playable-shared-kit/tools/unity-cocos-port/tmp-label-baseline.cjs (parity-tested).
 */

export const TMP_VERTICAL = {
  TOP: 256,
  MIDDLE: 512,
  BOTTOM: 1024,
  BASELINE: 2048,
  GEOMETRY: 4096,
  CAPLINE: 8192,
} as const;

/** Cocos Label.VerticalAlign values. */
export const COCOS_VERTICAL = { TOP: 0, CENTER: 1, BOTTOM: 2 } as const;

const BASELINE_RATIO = 0.26;

/** TMP_FontAsset.m_FaceInfo (font-asset units at pointSize). */
export interface TmpFaceInfo {
  pointSize: number;
  scale?: number;
  ascentLine: number;
  descentLine: number;
  capLine?: number;
  baseline?: number;
  lineHeight?: number;
}

/** TMP m_margin: x left, y top, z right, w bottom. */
export interface TmpMargin { x?: number; y?: number; z?: number; w?: number }

export interface TmpVerticalSource {
  /** TMP vertical mode (TMP_VERTICAL.*). */
  mode: number;
  face: TmpFaceInfo;
  fontSize: number;
  rectHeight: number;
  margin?: TmpMargin | null;
  /** Union of visible glyph boxes (font-asset units): max(bearingY), min(bearingY - height). Geometry only. */
  glyphExtents?: { top: number; bottom: number } | null;
}

export interface CocosLabelVertical {
  /** Label.CacheMode: 0 NONE, 1 BITMAP, 2 CHAR. */
  cacheMode: number;
  /** Label.VerticalAlign: 0 TOP, 1 CENTER, 2 BOTTOM. */
  verticalAlign: number;
  /** Actual font size (after SHRINK). */
  fontSize: number;
  /** UITransform height of the Label content. */
  contentHeight: number;
  /** Outline width when enableOutline, else 0. */
  outlineWidth?: number;
  /** BITMAP only: shadow offset Y and blur when enableShadow. */
  shadowOffsetY?: number;
  shadowBlur?: number;
  enableShadow?: boolean;
}

/** Vertical mode from m_VerticalAlignment, falling back to legacy m_textAlignment. */
export function tmpVerticalMode(verticalAlignment: number, textAlignment = 65535): number {
  if (verticalAlignment > 0) return verticalAlignment & 0xff00;
  if (textAlignment !== 65535 && textAlignment > 0) return textAlignment & 0xff00;
  return TMP_VERTICAL.MIDDLE;
}

/** Closest Cocos Label.VerticalAlign (Cocos has no Baseline/Midline/Capline: they centre, then shift). */
export function cocosVerticalAlignFor(mode: number): number {
  if (mode === TMP_VERTICAL.TOP) return COCOS_VERTICAL.TOP;
  if (mode === TMP_VERTICAL.BOTTOM) return COCOS_VERTICAL.BOTTOM;
  return COCOS_VERTICAL.CENTER;
}

export function tmpScale(fontSize: number, face: TmpFaceInfo): number {
  return fontSize / face.pointSize * (face.scale || 1);
}

/** Label.lineHeight that matches TMP: FaceInfo.lineHeight * scale + m_lineSpacing * fontSize * 0.01. */
export function tmpLineAdvance(fontSize: number, face: TmpFaceInfo, lineSpacing = 0): number {
  const lineHeight = face.lineHeight ?? (face.ascentLine - face.descentLine);
  return lineHeight * tmpScale(fontSize, face) + lineSpacing * fontSize * 0.01;
}

/** Downward distance from the TMP rect top to the first baseline (single line). */
export function tmpFirstBaselineBelowTop(source: TmpVerticalSource): number {
  const { face, rectHeight: H } = source;
  const s = tmpScale(source.fontSize, face);
  const my = source.margin?.y ?? 0;
  const mw = source.margin?.w ?? 0;
  const ascender = face.ascentLine * s;
  const descender = face.descentLine * s;
  switch (source.mode) {
    case TMP_VERTICAL.TOP:
      return ascender + my;
    case TMP_VERTICAL.BOTTOM:
      return H - mw + descender;
    case TMP_VERTICAL.BASELINE:
      return H / 2;
    case TMP_VERTICAL.GEOMETRY: {
      const glyphBaseline = (face.baseline ?? 0) * s * (face.scale || 1);
      const extents = source.glyphExtents;
      if (!extents) return H / 2 + (ascender + my + descender - mw) / 2;
      return H / 2 + (extents.top * s + glyphBaseline + my + extents.bottom * s + glyphBaseline - mw) / 2;
    }
    case TMP_VERTICAL.CAPLINE:
      return H / 2 + ((face.capLine ?? 0) * s - my - mw) / 2;
    default:
      return H / 2 + (ascender + my + descender - mw) / 2;
  }
}

/** Downward distance from the Cocos Label content top to the first baseline (single line). */
export function cocosFirstBaselineBelowTop(label: CocosLabelVertical): number {
  const F = label.fontSize;
  const H = label.contentHeight;
  const outline = Math.max(0, label.outlineWidth ?? 0);
  if (label.cacheMode === 2) {
    if (label.verticalAlign === COCOS_VERTICAL.TOP) return 0.87 * F + outline;
    if (label.verticalAlign === COCOS_VERTICAL.BOTTOM) return H - 0.13 * F + outline;
    return H / 2 + (0.5 - BASELINE_RATIO / 2) * F + outline;
  }
  let padTop = outline;
  let padBottom = outline;
  if (label.enableShadow) {
    const shadowWidth = (label.shadowBlur ?? 0) + outline;
    const offsetY = label.shadowOffsetY ?? 0;
    padTop = Math.max(padTop, offsetY + shadowWidth);
    padBottom = Math.max(padBottom, -offsetY + shadowWidth);
  }
  if (label.verticalAlign === COCOS_VERTICAL.TOP) return padTop + (1 - BASELINE_RATIO / 2) * F;
  if (label.verticalAlign === COCOS_VERTICAL.BOTTOM) return H - padBottom - BASELINE_RATIO * F;
  return H / 2 + (0.5 - BASELINE_RATIO / 2) * F + (padTop - padBottom) / 2;
}

/**
 * Union of the visible glyph boxes of `text` for TMP Geometry (Midline): `boxes` maps a character
 * to [horizontalBearingY, height] from the TMP font asset m_GlyphTable (font-asset units).
 * Returns the number of visible characters without a box (0 = complete evidence).
 */
export function tmpGlyphExtentsOf(text: string, boxes: Record<string, readonly number[]>, out: { top: number; bottom: number }): number {
  let top = -Infinity;
  let bottom = Infinity;
  let missing = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') continue;
    const box = boxes[ch];
    if (!box) { missing++; continue; }
    if (!(box[1] > 0)) continue;
    if (box[0] > top) top = box[0];
    if (box[0] - box[1] < bottom) bottom = box[0] - box[1];
  }
  out.top = top === -Infinity ? 0 : top;
  out.bottom = bottom === Infinity ? 0 : bottom;
  return missing;
}

/**
 * Upward shift (parent units) that moves the Cocos baseline onto the TMP baseline.
 * contentTopBelowRectTop: how far the Label content top sits below the TMP rect top
 * (0 when the Label UITransform is the TMP rect).
 */
export function tmpLabelBaselineShift(source: TmpVerticalSource, label: CocosLabelVertical, contentTopBelowRectTop = 0): number {
  return contentTopBelowRectTop + cocosFirstBaselineBelowTop(label) - tmpFirstBaselineBelowTop(source);
}
