'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeGeneratedAssetText } = require('./generated-asset-writer.cjs');
function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-asset-write-'));
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, {recursive:true, force:true});
  });
  return directory;
}
test('material publication is complete and repeated identical writes preserve mtime', t => {
  const cocosRoot = workspace(t), file = path.join(cocosRoot, 'assets', 'test.mtl');
  const data = JSON.stringify({__type__:'cc.Material', _props:[{name:'native'}]});
  assert.equal(writeGeneratedAssetText(file, data, {cocosRoot}), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')), JSON.parse(data));
  fs.utimesSync(file, 100, 100); const timestamp = fs.statSync(file).mtimeMs;
  for (let i=0;i<100;i++) assert.equal(writeGeneratedAssetText(file, data, {cocosRoot}), false);
  assert.equal(fs.statSync(file).mtimeMs, timestamp);
  assert.equal(writeGeneratedAssetText(file, data+'\n', {cocosRoot}), true);
  assert.equal(fs.readFileSync(file,'utf8'), data+'\n');
  assert.deepEqual(fs.readdirSync(path.join(cocosRoot,'.ai','asset-write-staging')), []);
});
test('invalid shader is rejected before replacing an existing asset', t => {
  const cocosRoot = workspace(t), file = path.join(cocosRoot, 'assets', 'trail.effect');
  fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file,'previous validated shader');
  const text=`CCEffect %{
  techniques:
  - passes:
    - vert: trail:vert
      frag: color:frag
      properties:
        sourceRendererPivot: {value: [0,0,0,0]}
}%
CCProgram trail %{\nvec4 vert(){return vec4(0.0);}\n}%
CCProgram color %{\nvec4 frag(){return vec4(1.0);}\n}%`;
  assert.throws(()=>writeGeneratedAssetText(file,text,{cocosRoot}),{code:'EFX3302_PROPERTY_UNIFORM_MISSING'});
  assert.equal(fs.readFileSync(file,'utf8'),'previous validated shader');
  assert.equal(fs.existsSync(path.join(cocosRoot,'.ai')), false);
});
test('publication cannot escape the specified project', t => {
  const cocosRoot=workspace(t);
  assert.throws(()=>writeGeneratedAssetText(path.join(cocosRoot,'..','outside.mtl'),'{}',{cocosRoot}), /within its Cocos project/);
});
test('an effect that fails the real GLSL ES 1.00 compile (EFX2406) is never published', t => {
  let prerequisites = true;
  try { require('../shader-compiler/cocos-effect-compiler-host.cjs').resolveCreator(); require('../shader-compiler/webgl-glsl-compiler.cjs').findBrowser(); }
  catch (_) { prerequisites = false; }
  if (!prerequisites) { t.skip('Cocos Creator or Chrome/Edge missing: the gate fails closed there'); return; }
  const cocosRoot = workspace(t), file = path.join(cocosRoot, 'assets', 'es3-only.effect');
  fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, 'previous validated shader');
  const text = `CCEffect %{
  techniques:
  - passes:
    - vert: vs:vert
      frag: fs:frag
}%
CCProgram vs %{
  precision highp float;
  in vec3 a_position;
  vec4 vert () { return vec4(a_position, 1.0); }
}%
CCProgram fs %{
  precision highp float;
  vec4 frag () { float w[2] = float[2](0.25, 0.75); return vec4(w[1]); }
}%
`;
  assert.throws(() => writeGeneratedAssetText(file, text, { cocosRoot }), (error) => error.code === 'EFFECT_COMPILE_GATE_FAILED'
    && error.diagnostics.some((d) => d.code === 'EFX2406' && /array constructor/.test(d.message)));
  assert.equal(fs.readFileSync(file, 'utf8'), 'previous validated shader');
});

test('rename retries transient Windows locks (Editor holds library/ files) and rethrows real errors', () => {
  const { renameWithRetry } = require('./generated-asset-writer.cjs');
  const waits = [];
  let calls = 0;
  const locked = code => () => { calls++; if (calls < 3) { const e = new Error(code); e.code = code; throw e; } return 'done'; };
  assert.equal(renameWithRetry('a', 'b', { rename: locked('EPERM'), wait: ms => waits.push(ms) }), 'done');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [50, 100]);
  calls = 0;
  assert.throws(() => renameWithRetry('a', 'b', { rename: () => { calls++; const e = new Error('nope'); e.code = 'ENOENT'; throw e; }, wait: () => {} }), /nope/);
  assert.equal(calls, 1, 'non-transient errors are not retried');
  calls = 0;
  assert.throws(() => renameWithRetry('a', 'b', { attempts: 4, rename: () => { calls++; const e = new Error('held'); e.code = 'EBUSY'; throw e; }, wait: () => {} }), /held/);
  assert.equal(calls, 4, 'a persistent lock still fails after the bounded attempts');
});
