'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTypings,
  propertyName,
} = require('./config-typings-generator.cjs');

test('quotes unsafe config property names and keeps safe identifiers readable', () => {
  assert.equal(propertyName('speed'), 'speed');
  assert.equal(propertyName('fx/Demo/Fireball (projectile)'), '"fx/Demo/Fireball (projectile)"');
  assert.equal(propertyName('has-hyphen'), '"has-hyphen"');
});

test('does not emit the custom property twice when config defines it', () => {
  const output = buildTypings({
    custom: {
      projectiles: {
        'fx/Demo/Fireball (projectile)': { radius: 2 },
      },
    },
  });

  assert.match(output, /"fx\/Demo\/Fireball \(projectile\)":/);
  assert.equal((output.match(/\bcustom\?:/g) || []).length, 1);
  assert.doesNotMatch(output, /custom\?: Record<string, any>/);
});

test('keeps the backwards-compatible custom fallback when config omits it', () => {
  const output = buildTypings({ gameplay: { duration: 30 } });
  assert.match(output, /custom\?: Record<string, any>/);
});
