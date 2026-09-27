'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const HELPER = path.join(__dirname, 'ui-layout-balance.js');
const { computeLayoutBalance, measureUiLayoutBalance } = require('./ui-layout-balance.js');

const rect = (x, y, width, height) => ({ x, y, width, height });

test('lone survivor keeping a pair-relative x reports its centre offset', () => {
  // Container 1080 wide centred at x=540; TryAgain (441 wide) kept x=+191.
  const container = rect(0, 0, 1080, 1920);
  const tryAgain = { name: 'TryAgain', rect: rect(540 + 191 - 220.5, 300, 441, 185) };
  const result = computeLayoutBalance([tryAgain], container, container);
  assert.equal(result.ok, true);
  assert.equal(result.centerOffsetPx, 191);
  assert.equal(result.centerOffsetXPx, 191);
  assert.equal(result.insideSafeRect, 1);
  assert.equal(result.overlapCount, 0);

  const centred = computeLayoutBalance([{ name: 'TryAgain', rect: rect(540 - 220.5, 300, 441, 185) }], container, container);
  assert.equal(centred.centerOffsetPx, 0);
});

test('group bbox, safe rect escape and overlaps are measured', () => {
  const container = rect(0, 0, 1000, 1000);
  const safe = rect(20, 20, 960, 960);
  const controls = [
    { name: 'A', rect: rect(0, 100, 300, 100) },
    { name: 'B', rect: rect(250, 100, 300, 100) },
  ];
  const result = computeLayoutBalance(controls, container, safe, { axis: 'both' });
  assert.equal(result.groupRect.width, 550);
  assert.equal(result.insideSafeRect, 0);
  assert.equal(result.outsideSafePx, 20);
  assert.equal(result.overlapCount, 1);
  assert.equal(result.overlapMaxRatio, 0.167);
  assert.ok(result.centerOffsetPx > 0);
});

function fakeEngine() {
  class UITransform {}
  class Canvas {}
  const make = (name, parent, box, extra = {}) => ({
    name, parent, activeInHierarchy: extra.active !== false,
    getComponent(type) {
      if (type === UITransform) return { getBoundingBoxToWorld: () => ({ ...box }) };
      if (type === Canvas) return extra.canvas ? {} : null;
      return null;
    },
  });
  const scene = { name: 'scene', parent: null };
  const canvas = make('Canvas', scene, rect(0, 0, 720, 1280), { canvas: true });
  const popup = make('Popup', canvas, rect(60, 200, 600, 900));
  const tryAgain = make('TryAgain', popup, rect(360 + 100 - 150, 300, 300, 120));
  const hidden = make('Home', popup, rect(100, 300, 200, 120), { active: false });
  const nodes = { 'Canvas': canvas, 'Canvas/Popup': popup, 'Canvas/Popup/TryAgain': tryAgain, 'Canvas/Popup/Home': hidden };
  return { UITransform, Canvas, find: value => nodes[value] || null };
}

test('browser probe resolves node paths, defaults the safe rect to the Canvas and rejects inactive controls', () => {
  const cc = fakeEngine();
  const result = measureUiLayoutBalance({ cc, nodes: ['Canvas/Popup/TryAgain'], container: 'Canvas/Popup' });
  assert.equal(result.ok, true);
  assert.equal(result.centerOffsetPx, 100);
  assert.equal(result.insideSafeRect, 1);
  assert.deepEqual(result.controls.map(item => item.name), ['Canvas/Popup/TryAgain']);
  assert.equal(measureUiLayoutBalance({ cc, nodes: ['Canvas/Popup/Home'], container: 'Canvas/Popup' }).ok, false);
  assert.equal(measureUiLayoutBalance({ cc, nodes: ['Canvas/Nope'], container: 'Canvas/Popup' }).ok, false);
  assert.equal(measureUiLayoutBalance({ nodes: [], container: 'x' }).ok, false);
});

test('helper source prepended to an eval expression yields the probe result as completion value', () => {
  const cc = fakeEngine();
  const source = `${fs.readFileSync(HELPER, 'utf8')}\n;\n`
    + '__ccUiLayoutBalance({ nodes: ["Canvas/Popup/TryAgain"], container: "Canvas/Popup" })';
  const sandbox = { cc };
  sandbox.globalThis = sandbox;
  const value = vm.runInNewContext(source, sandbox);
  assert.equal(value.ok, true);
  assert.equal(value.centerOffsetPx, 100);
});
