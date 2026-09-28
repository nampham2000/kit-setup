'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseEffectLog } = require('./effect-import-live-check.cjs');

test('project.log EFX entries become structured diagnostics with the offending GLSL line', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'effect-gate', 'project-log-excerpt.log'), 'utf8');
  const diags = parseEffectLog(text);
  assert.equal(diags.length, 2);
  const [compile, elif] = diags;
  assert.equal(compile.effect, 'sg/bb-sg-hdr-sprite-unlit.effect');
  assert.equal(compile.program, 'bb-sg-vs:vert');
  assert.equal(compile.code, 'EFX2406');
  assert.deepEqual(compile.glsl.map((g) => [g.line, g.source]), [
    [4, 'VertexDescription description = (VertexDescription)0;'],
    [5, 'vec4 c = texture2D(_MainTex.tex, uv);'],
  ]);
  assert.equal(elif.code, 'EFX2301');
  assert.match(elif.message, /#elif conditions after a constant #if/);
  assert.deepEqual(parseEffectLog(text, { effect: 'clouds' }).map((d) => d.code), ['EFX2301']);
});
