'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { unitySpriteImportData } = require('./asset-import-porter');

test('maps Unity Sprite.border axes to Cocos sprite-frame borders', () => {
  const config = unitySpriteImportData([
    '  spritePixelsToUnits: 100',
    '  spriteBorder: {x: 95, y: 92, z: 95, w: 88}',
  ].join('\n'));
  assert.deepEqual(config, {
    spriteBorder: { left: 95, bottom: 92, right: 95, top: 88 },
    pixelsToUnit: 100,
  });
});

test('does not invent sliced border data when Unity metadata omits it', () => {
  assert.deepEqual(unitySpriteImportData('  spriteMode: 1\n'), {});
});
