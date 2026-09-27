'use strict';
const fs=require('node:fs'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const {particleRendererContract}=require('./particle-renderer-contract');
const read=file=>fs.readFileSync(path.join(__dirname,file),'utf8').replace(/\r\n/g,'\n');
const shader=read('source-particle.effect');
const samples=require('./fixtures/axial-billboard-native.json');
// The scale applied by the vertex program, not a JS re-implementation.
const corner=Number(shader.match(/#if CC_RENDER_MODE == RENDER_MODE_HORIZONTAL_BILLBOARD \|\| CC_RENDER_MODE == RENDER_MODE_VERTICAL_BILLBOARD\n(?:\s*\/\/[^\n]*\n)*\s*compScale\.xy \*= ([0-9.]+);\n\s*#endif/)[1]);
const extent=(vertices,axis)=>Math.max(...vertices.map(v=>v[axis]))-Math.min(...vertices.map(v=>v[axis]));
for(const sample of samples.filter(s=>s.mode!==1))test(`native ${sample.case}: axial billboards are size/sqrt(2), view billboards size`,()=>{
  const scale=sample.mode===2||sample.mode===3?corner:1;
  const angle=sample.rotation*Math.PI/180,spread=Math.abs(Math.cos(angle))+Math.abs(Math.sin(angle));
  const [a,b]=sample.axes;
  // A rotated square spans side*(|cos|+|sin|) on both axes.
  const expected=[sample.size[0]*scale*spread,sample.size[1]*scale*spread];
  assert.ok(Math.abs(extent(sample.vertices,a)-expected[0])<2e-4,`${extent(sample.vertices,a)} vs ${expected[0]}`);
  assert.ok(Math.abs(extent(sample.vertices,b)-expected[1])<2e-4,`${extent(sample.vertices,b)} vs ${expected[1]}`);
});
test('the axial corner scale is exactly sqrt(1/2) and both particle effects embed it',()=>{
  assert.ok(Math.abs(corner-Math.SQRT1_2)<1e-8);
  assert.ok(read('legacy-preview-particle.effect').includes(`compScale.xy *= ${corner};`));
});
test('native zero-velocity stretched particle stays a degenerate quad at its position',()=>{
  const sample=samples.find(s=>s.case==='stretched-zero-velocity');
  for(const vertex of sample.vertices)assert.deepEqual(vertex,sample.position);
  assert.match(shader,/if \(dot\(velocity\.xyz,velocity\.xyz\)>0\.0\) \{\n\s+pos\.xyz\+=normalize\(velocity\.xyz\)\*\([^;]+\);\n\s+computeVertPos\([^;]+\);\n\s+\}/);
});
test('axial billboards route builtin particle materials through the source adapter',()=>{
  for(const mode of [2,3])assert.equal(particleRendererContract({}, {m_RenderMode:mode}).requiresMaterialAdapter,true);
  for(const mode of [0,1])assert.equal(particleRendererContract({}, {m_RenderMode:mode}).requiresMaterialAdapter,false);
});
