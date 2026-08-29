'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseGesture, dispatchTouchGesture, selectCocosPreviewDevice } = require('./verify-runtime.cjs');

test('gesture coordinates in 0..1 use normalized canvas space', () => {
  assert.deepEqual(parseGesture('0.5,0.6,0.8,0.6,320,12'), {
    x1: 0.5, y1: 0.6, x2: 0.8, y2: 0.6,
    durationMs: 320, steps: 12, normalized: true,
  });
});

test('pixel gesture stays in viewport space and clamps unsafe duration', () => {
  const parsed = parseGesture('100,200,300,400,9000,999');
  assert.equal(parsed.normalized, false);
  assert.equal(parsed.durationMs, 5000);
  assert.equal(parsed.steps, 120);
});

test('invalid gesture is rejected before Chrome starts', () => {
  assert.throws(() => parseGesture('0.5,0.5,0.7'), /--gesture/);
});

test('gesture scheduler compensates for CDP round-trip time', async () => {
  let clock = 0;
  const events = [];
  const session = {
    send(method, params) {
      if (method === 'Runtime.evaluate') {
        return Promise.resolve({ result: { value: JSON.stringify({ left: 0, top: 0, width: 100, height: 200 }) } });
      }
      if (method === 'Input.dispatchTouchEvent') {
        events.push({ type: params.type, at: clock });
        return { then(resolve) { clock += 40; resolve({}); } };
      }
      return Promise.resolve({});
    },
  };
  const result = await dispatchTouchGesture(session, 'session', {
    x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8,
    durationMs: 100, steps: 4, normalized: true,
  }, {
    now: () => clock,
    wait: async milliseconds => { clock += milliseconds; },
  });

  assert.equal(events.filter(event => event.type === 'touchMove').length, 4);
  assert.deepEqual(events.filter(event => event.type === 'touchMove').map(event => event.at), [65, 90, 115, 140]);
  assert.equal(result.scheduledDurationMs, 100);
  assert.equal(result.dispatchEnqueueElapsedMs, 100);
  assert.equal(result.dispatchElapsedMs, 300);
  assert.equal(result.keepPressed, false);
});

test('gesture can stay pressed for a hold-state eval and screenshot', async () => {
  const events = [];
  const session = {
    send(method, params) {
      if (method === 'Runtime.evaluate') {
        return Promise.resolve({ result: { value: JSON.stringify({ left: 0, top: 0, width: 100, height: 200 }) } });
      }
      if (method === 'Input.dispatchTouchEvent') events.push(params.type);
      return Promise.resolve({});
    },
  };
  const result = await dispatchTouchGesture(session, 'session', {
    x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5,
    durationMs: 300, steps: 2, normalized: true,
  }, { keepPressed: true, wait: async () => {} });

  assert.equal(result.keepPressed, true);
  assert.equal(events.includes('touchStart'), true);
  assert.equal(events.includes('touchMove'), true);
  assert.equal(events.includes('touchEnd'), false);
});

test('Cocos preview device selection waits for resize and returns settled canvas', async () => {
  const values = [
    { ok: true, requested: 'WebpageFullScreen', previous: 'Apple iPhone 14 Pro Max',
      selected: 'WebpageFullScreen', changed: true },
    { selected: 'WebpageFullScreen', readyState: 'complete', sceneRunning: true,
      canvas: { width: 474, height: 660, cssWidth: 474, cssHeight: 660 } },
  ];
  let waits = 0;
  const session = {
    send(method) {
      if (method === 'Page.reload') return Promise.resolve({});
      assert.equal(method, 'Runtime.evaluate');
      return Promise.resolve({ result: { value: JSON.stringify(values.shift()) } });
    },
  };
  const result = await selectCocosPreviewDevice(session, 'session', 'WebpageFullScreen', {
    wait: async milliseconds => { waits += milliseconds; },
  });
  assert.equal(waits, 1250);
  assert.equal(result.selected, 'WebpageFullScreen');
  assert.equal(result.previous, 'Apple iPhone 14 Pro Max');
  assert.equal(result.reloaded, true);
  assert.deepEqual(result.canvas, { width: 474, height: 660, cssWidth: 474, cssHeight: 660 });
});

test('Cocos preview device selection fails closed when the device is absent', async () => {
  const session = {
    send() {
      return Promise.resolve({ result: { value: JSON.stringify({
        ok: false, requested: 'Missing', available: ['Default', 'WebpageFullScreen'],
      }) } });
    },
  };
  await assert.rejects(
    selectCocosPreviewDevice(session, 'session', 'Missing', { wait: async () => {} }),
    /available=Default, WebpageFullScreen/,
  );
});
