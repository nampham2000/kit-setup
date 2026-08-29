'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spriteRequiresFrame } = require('./verify-prefab.cjs');

test('fully transparent button target sprites do not require a visible sprite frame', () => {
  assert.equal(spriteRequiresFrame({ _color: { r: 255, g: 255, b: 255, a: 0 }, _spriteFrame: null }), false);
});

test('visible sprites still require a sprite frame', () => {
  assert.equal(spriteRequiresFrame({ _color: { r: 255, g: 255, b: 255, a: 1 }, _spriteFrame: null }), true);
  assert.equal(spriteRequiresFrame({ _spriteFrame: null }), true);
});
