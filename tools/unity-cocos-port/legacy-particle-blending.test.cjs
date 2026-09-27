'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const effect = fs.readFileSync(path.join(__dirname, 'source-particle.effect'), 'utf8');
function states(name) {
  const techniques = effect.split(/  - name: /).slice(1);
  const text = techniques.find(t => t.startsWith(name + '\r\n') || t.startsWith(name + '\n'));
  assert.ok(text, 'Missing source technique ' + name);
  return [...text.matchAll(/blendState: \*(b\d)/g)].map(match => {
    const anchor = effect.split(new RegExp('    ' + match[1] + ': &' + match[1] + '\\r?\\n'))[1].split(/\r?\n    \w/)[0];
    return Object.fromEntries([...anchor.matchAll(/(blend\w*): (\w+)/g)].map(m => [m[1], m[2]]));
  });
}
test('legacy Soft Additive preserves One / OneMinusSrcColor in forward and deferred passes', () => {
  for (const state of states('add-smooth')) {
    assert.equal(state.blendSrc, 'one');
    assert.equal(state.blendDst, 'one_minus_src_color');
  }
});
test('legacy Premultiply preserves One / OneMinusSrcAlpha rather than double multiplying alpha', () => {
  for (const state of states('premultiply-blend')) {
    assert.equal(state.blendSrc, 'one');
    assert.equal(state.blendDst, 'one_minus_src_alpha');
  }
});
test('legacy tinted particle alpha saturates after the two-times color formula', () => {
  assert.match(effect, /2\.0 \* color \* tintColor[\s\S]*?col\.a = clamp\(col\.a, 0\.0, 1\.0\)/);
  for (const state of states('add')) { assert.equal(state.blendSrc, 'src_alpha'); assert.equal(state.blendDst, 'one'); }
  for (const state of states('alpha-blend')) { assert.equal(state.blendSrc, 'src_alpha'); assert.equal(state.blendDst, 'one_minus_src_alpha'); }
});
