'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleSorting.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function load(cc={}){const m={exports:{}};new Function('exports','module','require',source)(m.exports,m,()=>cc);return m.exports;}
const native=require('./fixtures/particle-sort-key-native.json');
test('native fixture is bound to its capture script',()=>{
  const script=fs.readFileSync(path.join(__dirname,'fixtures/capture-sort-key.cs'),'utf8').replace(/\r\n/g,'\n');
  assert.equal(require('node:crypto').createHash('sha256').update(script).digest('hex'),native.source.captureSha256Lf);
  assert.equal(native.source.commonTransparentCriteria,23);assert.equal(native.source.transparencySortMode,'Default');
});
const D=Math.PI/180,vec=(x,y,z)=>({x,y,z});
const MODES={None:0,Distance:1,OldestInFront:2,YoungestInFront:3,Depth:4};
function trs(position,eulerY,scale){const c=Math.cos(eulerY*D)*scale,s=Math.sin(eulerY*D)*scale;
  return {m00:c,m01:0,m02:-s,m04:0,m05:scale,m06:0,m08:s,m09:0,m10:c,m12:position[0],m13:position[1],m14:position[2]};}
function particle(position,size,velocity=[0,0,0],remaining=100){return {position:vec(...position),size:vec(size,size,size),ultimateVelocity:vec(...velocity),startLifetime:100,remainingLifetime:remaining};}
function system(particles,{world=true,matrix=null,pivot=[0,0,0]}={}){
  return {simulationSpace:world?0:1,node:{worldPosition:vec(...pivot),worldMatrix:matrix,layer:1},
    processor:{_model:{priority:0},_particles:{data:particles,length:particles.length},beforeRender(){},updateRenderData(){}}};
}
const renderCamera=ortho=>({position:vec(0,0,0),forward:vec(0,0,1),projectionType:ortho?0:1});
function pair(c,api){
  const local=c.aSimulationSpace==='Local';
  const a=system(c.aParticles.map((p,i)=>particle(p,c.aSizes[i],c.aVelocities[i])),{world:!local,matrix:local?trs(native.localParent.position,native.localParent.eulerY,native.localParent.scale):null,pivot:c.aPivot});
  const b=system([particle(c.bBoundsCenter,20)],{pivot:c.bBoundsCenter});
  const specA={path:'A',fudge:0,queue:c.aQueue,order:c.aSortingOrder};
  if(c.aRenderMode==='Stretch')Object.assign(specA,{lengthScale:c.aLengthScale,velocityScale:c.aVelocityScale});
  const cam=renderCamera(c.orthographic);
  api.installUnityParticleSorting(a,cam,specA);api.installUnityParticleSorting(b,cam,{path:'B',fudge:0,queue:3000});
  const aOnTop=fudge=>{specA.fudge=fudge;a.processor.beforeRender();b.processor.beforeRender();return a.processor._model.priority>b.processor._model.priority;};
  return {a,specA,aOnTop};
}
for(const c of native.cases)test(`native ${c.name}: Unity sort point and fudge threshold`,()=>{
  const api=load(),{a,specA,aOnTop}=pair(c,api);
  const point={x:0,y:0,z:0};assert.equal(api.unityParticleSortPoint(a,specA,point),true);
  [point.x,point.y,point.z].forEach((v,i)=>assert.ok(Math.abs(v-c.aBoundsCenter[i])<1e-3,`sort point ${i}: ${v} vs ${c.aBoundsCenter[i]}`));
  if(c.flip===null){for(const fudge of [-60,0,60])assert.equal(aOnTop(fudge),c.aOnTopEverywhere,`fudge ${fudge}`);return;}
  assert.equal(aOnTop(c.flip-.01),c.aOnTopBelowFlip);assert.equal(aOnTop(c.flip+.01),!c.aOnTopBelowFlip);
});
test('default key keeps the historical -(distance + fudge) priority',()=>{
  const api=load();assert.equal(api.unitySortPriority({fudge:0,queue:3000},12.5),-12.5);
  const low=api.unitySortPriority({queue:3000,order:-1},0),high=api.unitySortPriority({queue:3001},1000);
  assert.ok(low<api.unitySortPriority({queue:3000},-1000)&&high>api.unitySortPriority({queue:3000},-1000));
  assert.ok(api.unitySortPriority({queue:3000,layer:1,order:-32768},0)>api.unitySortPriority({queue:5000,order:32767},0),'layer value dominates order and queue');
});
for(const row of native.intraRenderer.rows)test(`native sortMode ${row.mode} orders particles inside the renderer`,()=>{
  for(const redFirst of [true,false]){
    const api=load(),red=particle([0,0,10],20,[0,0,0],50),green=particle([0,0,10.5],20,[0,0,0],99);
    const s=system(redFirst?[red,green]:[green,red]);
    api.installUnityParticleSorting(s,renderCamera(false),{path:'A',fudge:0,queue:3000,sortMode:MODES[row.mode]});
    s.processor.updateRenderData();
    const redOnTop=s.processor._particles.data[1]===red;
    assert.equal(redOnTop,redFirst?row.redOnTopWhenBufferRedFirst:row.redOnTopWhenBufferGreenFirst,`buffer ${redFirst?'red':'green'} first`);
  }
});
test('trail model shares the renderer key and the camera is resolved from the render scene',()=>{
  const api=load(),s=system([particle([0,0,10],1)]);
  const trail={priority:0};s.trailModule={getModel:()=>trail};
  const hidden={enabled:true,visibility:2,priority:-5,position:vec(0,0,-100),forward:vec(0,0,1),projectionType:1};
  const main={enabled:true,visibility:1,priority:0,position:vec(0,0,0),forward:vec(0,0,1),projectionType:1};
  s.node.scene={renderScene:{cameras:[hidden,main]}};
  api.installUnityParticleSorting(s,null,{path:'A',fudge:2,queue:3000});s.processor.beforeRender();
  assert.equal(s.processor._model.priority,-12);assert.equal(trail.priority,-12);
});
test('unmanaged transparent models get the default Unity key; opaque and foreign priorities stay',()=>{
  const handlers={},transparent={blendState:{targets:[{blend:true}]}},opaque={blendState:{targets:[{blend:false}]}};
  const model=(pass,priority,center)=>({enabled:true,priority,node:{layer:1,worldPosition:vec(0,0,99)},worldBounds:{center:vec(...center)},subModels:[{passes:[pass]}]});
  const mesh=model(transparent,0,[0,0,7]),wall=model(opaque,0,[0,0,3]),foreign=model(transparent,5,[0,0,4]);
  const cam={enabled:true,visibility:1,priority:0,position:vec(0,0,0),forward:vec(0,0,1),projectionType:1};
  const s=system([particle([0,0,10],1)]);
  const scene={cameras:[cam],models:[mesh,wall,foreign,s.processor._model]};
  const api=load({Director:{EVENT_BEFORE_RENDER:'before-render'},director:{on(e,f){handlers[e]=f;},root:{scenes:[scene]}}});
  api.installUnityParticleSorting(s,cam,{path:'A',fudge:-1,queue:3000});s.processor.beforeRender();
  handlers['before-render']();
  assert.equal(mesh.priority,-7);assert.equal(wall.priority,0);assert.equal(foreign.priority,5);assert.equal(s.processor._model.priority,-9);
  mesh.worldBounds.center.z=8;handlers['before-render']();assert.equal(mesh.priority,-8,'auto-assigned priorities are refreshed');
});
test('install is idempotent and keeps processor hooks single',()=>{
  const api=load(),s=system([particle([0,0,10],1)]);
  api.installUnityParticleSorting(s,renderCamera(false),{path:'A',fudge:0,queue:3000,sortMode:1});
  const hooks=[s.processor.beforeRender,s.processor.updateRenderData];
  api.installUnityParticleSorting(s,renderCamera(false),{path:'A',fudge:9,queue:3000,sortMode:1});
  assert.deepEqual([s.processor.beforeRender,s.processor.updateRenderData],hooks);
  assert.throws(()=>api.installUnityParticleSorting({},null,{path:'A',fudge:0,queue:3000}),/processor/);
});
