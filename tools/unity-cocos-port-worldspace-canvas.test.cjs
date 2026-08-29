'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  emitCanvas,
  convertNodePosition,
  resolveTransformLayout,
  unityCanvasRenderMode,
} = require('./unity-cocos-port.cjs');

function rectTransform(overrides = {}) {
  return {
    isRect: true,
    localPosition: { x: 0, y: 0, z: -0.221 },
    anchoredPosition: { x: 0, y: 0.857 },
    localRotation: { x: 0.4737808, y: 0, z: 0, w: 0.8806428 },
    localScale: { x: 0.01, y: 0.01, z: 0.01 },
    euler: { x: 0, y: 0, z: 0 },
    sizeDelta: { x: 0, y: 0 },
    anchorMin: { x: 0, y: 0 },
    anchorMax: { x: 0, y: 0 },
    anchor: { x: 0.5, y: 0.5 },
    ...overrides,
  };
}

test('RectTransform below a 3D Transform keeps authored local position', () => {
  const parent = {
    isRect: false,
    // This stale/default layout used to offset the child by (-50, -50).
    resolvedLayout: { size: { x: 100, y: 100 }, anchor: { x: 0.5, y: 0.5 } },
  };
  const resolved = resolveTransformLayout(rectTransform(), parent);
  assert.deepEqual(resolved.localPosition, { x: 0, y: 0, z: -0.221 });
  assert.deepEqual(resolved.localScale, { x: 0.01, y: 0.01, z: 0.01 });
});

test('detached world-space Canvas can explicitly preserve local position', () => {
  const resolved = resolveTransformLayout(rectTransform(), null, { preserveLocalPosition: true });
  assert.deepEqual(resolved.localPosition, { x: 0, y: 0, z: -0.221 });
});

test('world-space Canvas preserves authored local UI-plane depth during node conversion', () => {
  const resolved = resolveTransformLayout(rectTransform(), null, { preserveLocalPosition: true });
  resolved.preserveWorldSpaceCanvasLocalZ = true;
  const converted = convertNodePosition(resolved);
  assert.equal(converted.x, 0);
  assert.equal(converted.y, 0);
  assert.equal(converted.z, -0.221);
});

test('ordinary 3D nodes still receive the generic Unity-to-Cocos Z reflection', () => {
  const converted = convertNodePosition({ localPosition: { x: 1, y: 2, z: -0.221 } });
  assert.equal(converted.x, 1);
  assert.equal(converted.y, 2);
  assert.equal(converted.z, 0.221);
});

test('screen-space RectTransform below another RectTransform still resolves anchors', () => {
  const parent = {
    isRect: true,
    resolvedLayout: { size: { x: 200, y: 100 }, anchor: { x: 0.5, y: 0.5 } },
  };
  const resolved = resolveTransformLayout(rectTransform({
    localPosition: { x: 0, y: 0, z: 0 },
    anchoredPosition: { x: 10, y: 20 },
    sizeDelta: { x: 50, y: 30 },
    anchorMin: { x: 0.5, y: 0.5 },
    anchorMax: { x: 0.5, y: 0.5 },
  }), parent);
  assert.deepEqual(resolved.localPosition, { x: 10, y: 20, z: 0 });
  assert.deepEqual(resolved.sizeDelta, { x: 50, y: 30 });
});

test('Unity World Space Canvas emits a Cocos RenderRoot2D', () => {
  const componentDoc = { classId: 223, lines: ['  m_RenderMode: 2'] };
  const model = { file: 'Box.prefab', componentDocs: new Map([['canvas', componentDoc]]) };
  const gameObject = { name: 'Canvas', components: ['canvas'] };
  const calls = [];
  const builder = {
    addRenderRoot2D(...args) {
      calls.push(args);
      return 73;
    },
  };
  const reports = [];
  const reporter = {
    low(...args) { reports.push(['low', ...args]); },
    medium(...args) { reports.push(['medium', ...args]); },
  };

  assert.equal(unityCanvasRenderMode(gameObject, model), 2);
  assert.equal(emitCanvas(42, 'canvas', componentDoc, gameObject, model, builder, reporter), 73);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 42);
  assert.equal(reports[0][1], 'WORLD_SPACE_CANVAS_PORTED');
  assert.equal(reports.some((entry) => entry[0] === 'medium'), false);
});

test('screen-space Canvas remains an explicit camera decision', () => {
  const componentDoc = { classId: 223, lines: ['  m_RenderMode: 0'] };
  const reports = [];
  const result = emitCanvas(
    4,
    'canvas',
    componentDoc,
    { name: 'HUD' },
    { file: 'HUD.prefab' },
    { addRenderRoot2D() { throw new Error('must not be called'); } },
    {
      low(...args) { reports.push(['low', ...args]); },
      medium(...args) { reports.push(['medium', ...args]); },
    },
  );
  assert.equal(result, null);
  assert.equal(reports[0][1], 'CANVAS_NOT_PORTED');
});
