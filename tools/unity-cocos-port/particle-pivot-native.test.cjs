'use strict';
const fs=require('node:fs'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const shader=fs.readFileSync(path.join(__dirname,'source-particle.effect'),'utf8');
const expression=shader.match(/normalize\(velocity\.xyz\)\s*\*\s*\(([^;]+)\);/)[1];
const offset=new Function('compScale','sourceRendererPivot',`return ${expression};`);
for(const sample of require('./fixtures/stretched-pivot-native.json'))test(`native stretched geometry, size=${sample.size} length=${sample.length} pivot=${sample.pivot}`,()=>{
  const shift=offset({y:sample.size},{y:sample.pivot});
  const expected=[1-shift,1+sample.size*sample.length-shift];
  const ys=sample.vertices.map(v=>v[1]);
  // Unity's native SIMD normalization produces a 0.037% difference for .001 velocity.
  assert.ok(Math.abs(Math.min(...ys)-expected[0])<.001);
  assert.ok(Math.abs(Math.max(...ys)-expected[1])<.001);
});
