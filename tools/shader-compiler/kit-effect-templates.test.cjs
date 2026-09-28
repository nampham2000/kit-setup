'use strict';
// Porters copy these kit .effect templates into projects verbatim (material-porter, runtime-component-porter,
// ui-sprite-alpha-porter, ...). They must pass the same compile gate as generated effects.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveCreator } = require('./cocos-effect-compiler-host.cjs');
const { findBrowser } = require('./webgl-glsl-compiler.cjs');
const { checkEffects, formatDiagnostic } = require('./effect-compile-gate.cjs');

let skip = false;
try { resolveCreator(); findBrowser(); } catch (error) { skip = `gate prerequisites missing: ${error.message}`; }

test('every kit .effect template passes the effect compile gate', { skip, timeout: 600000 }, async () => {
  const kitRoot = path.resolve(__dirname, '..', '..');
  const files = execFileSync('git', ['ls-files', '*.effect'], { cwd: kitRoot, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean).map((f) => path.join(kitRoot, f));
  assert.ok(files.length > 0);
  const res = await checkEffects(files.map((file) => ({ file })), { mode: 'basic' });
  assert.equal(res.unavailable, undefined);
  const failures = res.effects.filter((e) => !e.ok)
    .map((e) => e.diagnostics.filter((d) => d.severity === 'error').slice(0, 3).map((d) => formatDiagnostic(path.relative(kitRoot, e.file), d)).join('\n'));
  assert.deepEqual(failures, []);
});
