'use strict';

// Blast Shooter's Canvas - Gameplay prefab was saved in a 1081x605 Game view: laid out at that size, the
// top-anchored level plate sat mid-screen on a 1080x1920 canvas. Screen-space canvas roots lay out at the
// CanvasScaler reference resolution, and edge-anchored RectTransforms keep their edge through a Widget.
const assert = require('node:assert/strict');
const test = require('node:test');
const { unityRectEdgeWidget, unityCanvasScalerReferenceResolution, resolveTransformLayout } = require('../unity-cocos-port.cjs');

test('CanvasScaler Scale With Screen Size gives the reference resolution; other modes give none', () => {
  for (const [mode, expected] of [[1, { x: 1080, y: 1920 }], [0, null]]) {
    const doc = { classId: 114, lines: ['MonoBehaviour:', '  m_GameObject: {fileID: 1}', `  m_UiScaleMode: ${mode}`, '  m_ReferenceResolution: {x: 1080, y: 1920}', '  m_ScreenMatchMode: 1'] };
    const model = { componentDocs: new Map([['5', doc]]) };
    assert.deepEqual(unityCanvasScalerReferenceResolution({ components: ['5'] }, model), expected);
  }
});

test('edge-anchored rects keep their edge offsets; centre anchors get no widget', () => {
  const parent = { isRect: true, resolvedLayout: { size: { x: 1080, y: 1920 }, anchor: { x: 0.5, y: 0.5 } } };
  const rect = (anchorMin, anchorMax, anchoredPosition, sizeDelta, anchor = { x: 0.5, y: 0.5 }) => ({ isRect: true, anchorMin, anchorMax, anchoredPosition, sizeDelta, anchor, localPosition: { x: 0, y: 0, z: 0 } });
  const widgetOf = (t) => unityRectEdgeWidget(t, resolveTransformLayout(t, parent), parent);

  // Level plate: top-centre anchor, 79 below the top edge (pivot centre, 100 high).
  const top = widgetOf(rect({ x: 0.5, y: 1 }, { x: 0.5, y: 1 }, { x: 0, y: -79 }, { x: 100, y: 100 }));
  assert.deepEqual(top, { flags: 1, left: 0, right: 0, top: 29, bottom: 0 });
  // Top-right button: right + top.
  const corner = widgetOf(rect({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: -80, y: -80 }, { x: 100, y: 100 }));
  assert.deepEqual(corner, { flags: 1 | 32, left: 0, right: 30, top: 30, bottom: 0 });
  // Horizontal stretch strip at the bottom (pivot bottom): left + right + bottom.
  const strip = widgetOf(rect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 40 }, { x: -20, y: 200 }, { x: 0.5, y: 0 }));
  assert.deepEqual(strip, { flags: 8 | 32 | 4, left: 10, right: 10, top: 0, bottom: 40 });
  // Centre anchor: the Cocos centre-relative position already tracks the parent.
  assert.equal(widgetOf(rect({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 10, y: 10 }, { x: 100, y: 100 })), null);
  // No rect parent: nothing to align against.
  assert.equal(unityRectEdgeWidget(rect({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }), {}, null), null);
});
