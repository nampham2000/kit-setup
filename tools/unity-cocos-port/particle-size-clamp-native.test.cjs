'use strict';
const fs=require('node:fs'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const {particleRendererContract}=require('./particle-renderer-contract');
const read=file=>fs.readFileSync(path.join(__dirname,file),'utf8').replace(/\r\n/g,'\n');
const shader=read('source-particle.effect');
// Evaluate the vertex program's own clamp expression, not a JS re-implementation.
const expression=shader.match(/float sourceSizeFactor\(vec3 center, vec3 s\) \{[\s\S]*?return ([^;]+);\n\}/)[1];
const factor=new Function('m','width','sourceRendererSize','min','max',`return ${expression};`);
const extent=(vertices,axis)=>Math.max(...vertices.map(v=>v[axis]))-Math.min(...vertices.map(v=>v[axis]));
// Unity's Horizontal/Vertical billboards put their corners at size/2 on the
// diagonals (see axial-billboard-native.json); the clamp applies before that.
const axialCorner=mode=>mode===2||mode===3?Math.SQRT1_2:1;
for(const sample of require('./fixtures/particle-size-clamp-native.json'))test(`native Min/Max Particle Size: ${sample.case}`,()=>{
  const [sx,sy]=sample.size;
  const renderer={m_RenderMode:sample.mode,m_MinParticleSize:sample.min,m_MaxParticleSize:sample.max};
  const [x,y,z,w]=particleRendererContract({},renderer).sourceRendererSize;
  const k=sample.mode===4?1:factor(Math.max(sx,sy,1e-6),sample.viewportWidth,{x,y,z,w},Math.min,Math.max);
  const [widthAxis,heightAxis]=sample.axes;
  const expectedWidth=sx*k*axialCorner(sample.mode);
  const expectedHeight=sample.mode===1?sy*sample.lengthScale:sy*k*axialCorner(sample.mode);
  assert.ok(Math.abs(extent(sample.vertices,widthAxis)-expectedWidth)<2e-4,`width ${extent(sample.vertices,widthAxis)} vs ${expectedWidth}`);
  assert.ok(Math.abs(extent(sample.vertices,heightAxis)-expectedHeight)<2e-4,`height ${extent(sample.vertices,heightAxis)} vs ${expectedHeight}`);
});
test('clamp uses the perspective or orthographic viewport width at the particle depth',()=>{
  assert.match(shader,/float width = 2\.0 \* \(cc_matViewProj \* vec4\(center, 1\.0\)\)\.w \/ abs\(cc_matProj\[0\]\[0\]\);/);
  const tan=Math.tan(20*Math.PI/180),aspect=1280/720;
  const perspectiveP00=1/(aspect*tan),orthoP00=1/(5*aspect);
  assert.ok(Math.abs(2*5/perspectiveP00-6.47058)<1e-4,'clip w is the view depth');
  assert.ok(Math.abs(2*1/orthoP00-17.77778)<1e-4,'orthographic clip w is 1');
});
test('stretched billboards clamp only width, mesh particles never, disabled materials never',()=>{
  assert.match(shader,/#if CC_RENDER_MODE == RENDER_MODE_STRETCHED_BILLBOARD\n\s+compScale\.x \*= sourceSizeFactor\(pos\.xyz, compScale\);[^\n]*\n\s+#elif CC_RENDER_MODE != RENDER_MODE_MESH\n\s+compScale\.xy \*= sourceSizeFactor\(pos\.xyz, compScale\);/);
  assert.equal(factor(10,6.47058,{x:0,y:0.5,z:0,w:0},Math.min,Math.max),1,'effect default w=0 keeps older materials unclamped');
  for(const file of ['source-particle.effect','legacy-preview-particle.effect'])assert.match(read(file),/sourceRendererSize: \{ value: \[0, ?0\.5, ?0, ?0\] \}/);
});
