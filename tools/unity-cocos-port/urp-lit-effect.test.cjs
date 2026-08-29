'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('URP Lit emission texture is sampled instead of replacing it with flat grey', () => {
  const source = fs.readFileSync(path.join(__dirname, 'urp-lit.effect'), 'utf8');
  assert.match(source, /emissiveMap:\s*\{\s*value:\s*white\s*\}/);
  assert.match(source, /uniform sampler2D emissiveMap/);
  assert.match(source, /emissionContribution\s*\*=\s*SRGBToLinear\(texture\(emissiveMap,\s*v_uv\)\.rgb\)/);
  assert.doesNotMatch(source, /direct\s*\+\s*ambient\s*\+\s*emissive\.rgb/);
});
