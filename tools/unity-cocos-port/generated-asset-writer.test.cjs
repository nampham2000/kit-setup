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
