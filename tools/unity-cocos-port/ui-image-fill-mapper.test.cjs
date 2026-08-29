'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mapUnityImageFill } = require('./ui-image-fill-mapper');

test('Unity vertical filled Image maps exactly to Cocos Sprite fill fields', () => {
  assert.deepEqual(mapUnityImageFill({
    type: 3,
    method: 1,
    amount: 0.65,
    origin: 0,
    clockwise: 1,
  }), {
    spriteType: 3,
    fillType: 1,
    fillStart: 0,
    fillRange: 0.65,
    approximated: false,
  });
});

test('top/right linear origins reverse the fill range', () => {
  assert.deepEqual(mapUnityImageFill({ type: 3, method: 1, amount: 0.25, origin: 1 }), {
    spriteType: 3,
    fillType: 1,
    fillStart: 1,
    fillRange: -0.25,
    approximated: false,
  });
});

test('simple, sliced and tiled Images keep their Unity-compatible sprite type', () => {
  assert.equal(mapUnityImageFill({ type: 0 }).spriteType, 0);
  assert.equal(mapUnityImageFill({ type: 1 }).spriteType, 1);
  assert.equal(mapUnityImageFill({ type: 2 }).spriteType, 2);
});

test('Unity partial radial modes report that Cocos uses an approximation', () => {
  const mapped = mapUnityImageFill({ type: 3, method: 2, amount: 2, origin: 3, clockwise: 0 });
  assert.deepEqual(mapped, {
    spriteType: 3,
    fillType: 2,
    fillStart: 0.75,
    fillRange: -1,
    approximated: true,
  });
});
