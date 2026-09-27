'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=require('./fixtures/stretched-projection-native.json');
const normalize=v=>{const length=Math.hypot(...v);return length?v.map(x=>x/length):[0,0,0];};
test('native stretched width stays in camera plane for perspective and orthographic projections',()=>{
 for(const row of fixture.cases){
  assert.equal(row.vertices.length,4,'nonempty native geometry');
  const p=row.position,v=row.velocity,eye=[p[0],p[1],p[2]+20];
  const right=normalize([eye[1]*v[2]-eye[2]*v[1],eye[2]*v[0]-eye[0]*v[2],0]);
  const up=normalize(v).map(x=>x*4);
  const predicted=[[1,0],[1,1],[-1,1],[-1,0]].map(([width,length])=>p.map((x,i)=>x+right[i]*width+up[i]*length));
  for(let i=0;i<4;i++)for(let axis=0;axis<3;axis++)assert.ok(Math.abs(predicted[i][axis]-row.vertices[i][axis])<.0011,JSON.stringify({row,i,axis,predicted:predicted[i]}));
 }
});
test('all stretched source renderers bind the native width projection shader',()=>{
 const {particleRendererContract}=require('./particle-renderer-contract');
 assert.equal(particleRendererContract({}, {m_RenderMode:1}).requiresMaterialAdapter,true);
 const effect=fs.readFileSync(path.join(__dirname,'source-particle.effect'),'utf8');
 assert.ok(effect.includes('sourceStretchRight-=sourceCameraBack*dot(sourceStretchRight,sourceCameraBack)'));
 assert.ok(effect.includes('sourceStretchRight=cross(velocity.xyz,pos.xyz-cc_cameraPos.xyz)'));
 assert.ok(effect.includes('if(sourceWidthLength>0.0)'));
});
