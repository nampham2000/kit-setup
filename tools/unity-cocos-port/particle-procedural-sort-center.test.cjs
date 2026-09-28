'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto'),ts=require('typescript');
const {unityProceduralSortCenter,unityProceduralSortGravityDrop}=require('./particle-procedural-sort-center.cjs');
const {particleRendererContract}=require('./particle-renderer-contract');
const fixture=require('./fixtures/procedural-sort-bounds-native.json');
test('native automatic source bounds are bound to their extraction producer',()=>{
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/capture-procedural-sort-bounds.cjs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'),fixture.producerSha256LF);
 assert.ok(fixture.cases.length>100);assert.ok(fixture.cases.reduce((n,c)=>n+c.samples.length,0)>2000);
});
const runtime={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleSorting.ts'),'utf8'),{compilerOptions:{module:1}}).outputText)(runtime,()=>({}));
test('procedural centers match native world bounds across shapes, effects and automatic phases',()=>{
 for(const c of fixture.cases){const center=unityProceduralSortCenter(c.input);assert.ok(center,c.path);assert.deepEqual(particleRendererContract(c.input,{}).sorting.proceduralCenter,center);
  for(const row of c.samples){
   const m=row.matrix,cm={};for(let i=0;i<16;i++)cm['m'+String(i).padStart(2,'0')]=m[i]*((i%4===2)!==(Math.floor(i/4)===2)?-1:1);
   const system={simulationSpace:1,node:{worldMatrix:cm},processor:{_particles:{length:row.count,data:[]}}},out={};
   assert.equal(runtime.unityParticleSortPoint(system,{proceduralCenter:center},out),true);
   [out.x,out.y,-out.z].forEach((v,i)=>assert.ok(Math.abs(v-row.center[i])<2e-6,JSON.stringify({path:c.path,frame:row.frame,axis:i,got:v,native:row.center[i]})));
   system.processor._particles.length=0;assert.equal(runtime.unityParticleSortPoint(system,{proceduralCenter:center},out),false);
  }
 }
});
test('unsupported procedural motion and shape contracts remain on dynamic bounds',()=>{
 const source=fixture.cases.find(c=>c.input.ShapeModule.type===2).input;
 for(const modify of [p=>p.moveWithTransform=1,p=>p.scalingMode=1,p=>p.NoiseModule.enabled=true,p=>p.ForceModule.enabled=true,p=>p.InitialModule.gravityModifier.minMaxState=1,p=>p.ShapeModule.arc.value=120,p=>p.ShapeModule.m_Rotation.y=20,p=>p.ShapeModule.randomDirectionAmount=.1,p=>p.ShapeModule.type=5,p=>p.InitialModule.startLifetime.minMaxState=1]){
  const p=structuredClone(source);modify(p);assert.equal(unityProceduralSortCenter(p),null);
 }
});
// Tanks! PowerUpEffect/Trails (Unity 6): hemisphere r 0.55, speed 10, life 0.3, gravity 1, emitter at Rx(279.22);
// Unity reported the local bounds center (0, -0.035, 1.557): envelope z [0, r + speed*life] united with its drop.
test('constant gravity and hemisphere speed follow the measured Tanks! procedural bounds',()=>{
 const source=structuredClone(fixture.cases.find(c=>c.input.ShapeModule.type===2).input);
 Object.assign(source.ShapeModule,{radius:{...source.ShapeModule.radius,value:.55},m_Position:{x:0,y:0,z:0},m_Scale:{x:1,y:1,z:1}});
 Object.assign(source.InitialModule.startSpeed,{minMaxState:0,scalar:10});
 Object.assign(source.InitialModule.startLifetime,{minMaxState:0,scalar:.3});
 Object.assign(source.InitialModule.gravityModifier,{minMaxState:0,scalar:1});
 const center=unityProceduralSortCenter(source),drop=unityProceduralSortGravityDrop(source);
 assert.deepEqual(center,[0,0,(.55+3)/2]);assert.ok(Math.abs(drop-.5*9.81*.09)<1e-12);
 assert.equal(particleRendererContract(source,{}).sorting.proceduralGravityDrop,drop);
 const a=279.22*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 // Cocos matrix of Unity Rx(a): Cocos Rx(-a).
 const system={simulationSpace:1,node:{worldMatrix:{m00:1,m01:0,m02:0,m03:0,m04:0,m05:c,m06:-s,m07:0,m08:0,m09:s,m10:c,m11:0,m12:0,m13:0,m14:0,m15:1}},processor:{_particles:{length:1,data:[]}}},out={};
 assert.equal(runtime.unityParticleSortPoint(system,{proceduralCenter:center,proceduralGravityDrop:drop},out),true);
 // Unity world center = Rx(a) * native local center, z mirrored into Cocos.
 const native=[0,-.035,1.557],want=[0,c*native[1]-s*native[2],-(s*native[1]+c*native[2])];
 [out.x,out.y,out.z].forEach((v,i)=>assert.ok(Math.abs(v-want[i])<2e-3,JSON.stringify({got:[out.x,out.y,out.z],want})));
});
