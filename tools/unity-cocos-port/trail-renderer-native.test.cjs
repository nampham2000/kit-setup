'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
function compile(name,deps={}){const m={exports:{}};new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(m.exports,m,k=>deps[k]||{});return m.exports;}
const kernel=compile('UnityNoiseKernel'),runtime=compile('UnityTrailRendererGeometry',{'./UnityNoiseKernel':kernel}),fixture=require('./fixtures/trail-playback-native.json');
const p=fixture.source.m_Parameters,g=p.colorGradient;
const spec={time:fixture.source.m_Time,minVertexDistance:fixture.source.m_MinVertexDistance,widthMultiplier:p.widthMultiplier,widthKeys:p.widthCurve.m_Curve,
  colors:Array.from({length:g.m_NumColorKeys},(_,i)=>({time:g['ctime'+i]/65535,...g['key'+i]})),alphas:Array.from({length:g.m_NumAlphaKeys},(_,i)=>({time:g['atime'+i]/65535,...g['key'+i]}))};
test('native TrailRenderer geometry binds the extraction and actual Play Mode capture producers',()=>{
  const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')).digest('hex');
  assert.equal(hash(path.join(__dirname,'fixtures/publish-trail-playback.cjs')),fixture.producerSha256);
  assert.equal(hash(path.join(__dirname,'../../packages/unity-intelligence/Capture/Editor/ReferenceCapture.cs')),fixture.captureProducerSha256);
});
for(const f of fixture.frames)test(`native TrailRenderer frame ${f.frame}: camera plane, width/UV by distance, Color32 and head pair`,()=>{
  const r=new runtime.UnityTrailRendererGeometry(spec),t=f.trail;
  const dt=Math.fround(1/60),first=f.frame-(t.positions.length/3-1);
  for(let i=0;i<t.positions.length;i+=3)r.append(t.positions[i],t.positions[i+1],-t.positions[i+2],(first+i/3+1)*dt);
  r.expire((f.frame+1)*dt);
  const vertices=r.build(fixture.cameraForward[0],fixture.cameraForward[1],-fixture.cameraForward[2]);
  assert.equal(vertices,t.vertices.length/3);
  for(let i=0;i<t.vertices.length;i++)assert.ok(Math.abs(r.positions[i]-(i%3===2?-t.vertices[i]:t.vertices[i]))<2e-5,`vertex ${i} ${r.positions[i]} vs ${t.vertices[i]}`);
  for(let i=0;i<t.uv.length;i++)assert.ok(Math.abs(r.uvs[i]-t.uv[i])<1e-6,`UV ${i}`);
  for(let i=0;i<t.color.length;i++)assert.ok(Math.abs(r.colors[i]-t.color[i])<1/255+1e-6,`Color32 ${i}`);
  assert.deepEqual(Array.from(r.indices.slice(0,t.indices.length)),t.indices);
});
test('native live lifetime counts retain two endpoints at 120/180 frames',()=>{
  const r=new runtime.UnityTrailRendererGeometry(spec),dt=Math.fround(1/60);
  for(let frame=0;frame<=180;frame++){
    const time=(frame+1)*dt;r.expire(time);r.append(-frame*.4,0,0,time);
    const native=fixture.frames.find(f=>f.frame===frame);if(native)assert.equal(r.count,native.trail.positions.length/3,`frame ${frame}`);
  }
});
