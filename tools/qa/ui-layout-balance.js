/*
 * UI layout balance probe for regression eval (rules interactive-affordance-parity,
 * ui-layout-sliced-parity, visual-checkpoints).
 *
 * A tap regression proves a button works, not that it sits where the source put
 * it. When a playable removes/defers a sibling (Home of a Home/TryAgain pair) the
 * survivor must be re-centred or re-flowed; this probe measures that from the
 * live Cocos scene so a matrix can bound it with requiredEvalMetrics.
 *
 * Browser: loaded through the matrix case field `evalHelpers` (prepended to
 * evalBefore/eval) it defines globalThis.__ccUiLayoutBalance(options).
 * Node: module.exports exposes the pure geometry for unit tests.
 *
 * options = {
 *   nodes: ['Canvas/PopupLose/Content/TryAgainButton', ...] | cc.Node[],   // controls of one group
 *   container: 'Canvas/PopupLose/Content' | cc.Node,                       // reference rect (popup content / canvas)
 *   safeArea?: 'Canvas' | cc.Node,     // default: nearest cc.Canvas ancestor of container (visible design rect)
 *   safeInsetPx?: number,              // shrink the safe rect on every side (default 0)
 *   axis?: 'x' | 'y' | 'both',         // centerOffsetPx axis (default 'x')
 *   requireActive?: boolean,           // default true: an inactive control is a failure
 *   overlapEpsilon?: number,           // intersection/min-area ratio counted as overlap (default 0.001)
 *   cc?: object                        // engine namespace override (default globalThis.cc)
 * }
 *
 * Returns (all metrics numeric so requiredEvalMetrics can bound them):
 *   { ok, centerOffsetPx, centerOffsetXPx, centerOffsetYPx, insideSafeRect (1|0),
 *     outsideSafePx, overlapCount, overlapMaxRatio, controlCount, groupRect, containerRect, safeRect, controls }
 * Offsets are world design px (Canvas UI world units), group bbox centre minus container centre.
 */
(function (root) {
  'use strict';

  function rectOf(x, y, width, height) {
    return { x: x, y: y, width: width, height: height };
  }

  function union(rects) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < rects.length; i += 1) {
      var r = rects[i];
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width); maxY = Math.max(maxY, r.y + r.height);
    }
    return rectOf(minX, minY, maxX - minX, maxY - minY);
  }

  function center(r) { return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }

  function round(value) { return Math.round(value * 1000) / 1000; }

  function intersectionArea(a, b) {
    var w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    var h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  /** Pure geometry: controls/container/safe rects in one world space. */
  function computeLayoutBalance(controls, containerRect, safeRect, options) {
    options = options || {};
    var axis = options.axis || 'x';
    var epsilon = options.overlapEpsilon === undefined ? 0.001 : Number(options.overlapEpsilon);
    if (!controls.length) return { ok: false, reason: 'no controls' };
    var groupRect = union(controls.map(function (c) { return c.rect; }));
    var g = center(groupRect), c = center(containerRect);
    var dx = g.x - c.x, dy = g.y - c.y;
    var offset = axis === 'y' ? Math.abs(dy) : axis === 'both' ? Math.hypot(dx, dy) : Math.abs(dx);
    var outside = 0;
    if (safeRect) {
      outside = Math.max(0,
        safeRect.x - groupRect.x,
        safeRect.y - groupRect.y,
        (groupRect.x + groupRect.width) - (safeRect.x + safeRect.width),
        (groupRect.y + groupRect.height) - (safeRect.y + safeRect.height));
    }
    var overlapCount = 0, overlapMaxRatio = 0, overlaps = [];
    for (var i = 0; i < controls.length; i += 1) {
      for (var j = i + 1; j < controls.length; j += 1) {
        var a = controls[i].rect, b = controls[j].rect;
        var minArea = Math.min(a.width * a.height, b.width * b.height);
        var ratio = minArea > 0 ? intersectionArea(a, b) / minArea : 0;
        if (ratio > epsilon) {
          overlapCount += 1;
          overlaps.push({ a: controls[i].name, b: controls[j].name, ratio: round(ratio) });
        }
        overlapMaxRatio = Math.max(overlapMaxRatio, ratio);
      }
    }
    return {
      ok: true,
      centerOffsetPx: round(offset),
      centerOffsetXPx: round(dx),
      centerOffsetYPx: round(dy),
      insideSafeRect: safeRect ? (outside <= 0.5 ? 1 : 0) : 1,
      outsideSafePx: round(outside),
      overlapCount: overlapCount,
      overlapMaxRatio: round(overlapMaxRatio),
      controlCount: controls.length,
      overlaps: overlaps,
      groupRect: groupRect,
      containerRect: containerRect,
      safeRect: safeRect || null,
    };
  }

  function worldRect(engine, node) {
    var ui = node.getComponent(engine.UITransform || 'cc.UITransform');
    if (!ui) return null;
    var box = ui.getBoundingBoxToWorld();
    return rectOf(box.x, box.y, box.width, box.height);
  }

  function nodePath(node) {
    var parts = [];
    for (var cursor = node; cursor && cursor.parent; cursor = cursor.parent) parts.unshift(cursor.name);
    return parts.join('/');
  }

  function resolveNode(engine, value) {
    if (!value) return null;
    if (typeof value !== 'string') return value;
    return engine.find(value);
  }

  function canvasAncestor(engine, node) {
    for (var cursor = node; cursor; cursor = cursor.parent) {
      if (engine.Canvas && cursor.getComponent && cursor.getComponent(engine.Canvas)) return cursor;
    }
    return null;
  }

  /** Browser probe: resolves cc nodes and returns bounded numeric metrics. */
  function measureUiLayoutBalance(options) {
    options = options || {};
    var engine = options.cc || root.cc;
    if (!engine || typeof engine.find !== 'function') return { ok: false, reason: 'cc engine namespace not available' };
    var container = resolveNode(engine, options.container);
    if (!container) return { ok: false, reason: 'container not found: ' + options.container };
    var containerRect = worldRect(engine, container);
    if (!containerRect) return { ok: false, reason: 'container has no UITransform' };
    var requireActive = options.requireActive !== false;
    var controls = [];
    var list = options.nodes || [];
    for (var i = 0; i < list.length; i += 1) {
      var node = resolveNode(engine, list[i]);
      if (!node) return { ok: false, reason: 'control not found: ' + list[i] };
      if (requireActive && !node.activeInHierarchy) return { ok: false, reason: 'control inactive: ' + nodePath(node) };
      var rect = worldRect(engine, node);
      if (!rect) return { ok: false, reason: 'control has no UITransform: ' + nodePath(node) };
      controls.push({ name: nodePath(node), rect: rect });
    }
    var safeNode = options.safeArea ? resolveNode(engine, options.safeArea) : canvasAncestor(engine, container);
    var safeRect = safeNode ? worldRect(engine, safeNode) : null;
    if (safeRect && options.safeInsetPx) {
      var inset = Number(options.safeInsetPx);
      safeRect = rectOf(safeRect.x + inset, safeRect.y + inset, safeRect.width - 2 * inset, safeRect.height - 2 * inset);
    }
    var result = computeLayoutBalance(controls, containerRect, safeRect, options);
    result.controls = controls;
    return result;
  }

  root.__ccUiLayoutBalance = measureUiLayoutBalance;
  if (typeof module === 'object' && module && module.exports) {
    module.exports = { computeLayoutBalance: computeLayoutBalance, measureUiLayoutBalance: measureUiLayoutBalance };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
