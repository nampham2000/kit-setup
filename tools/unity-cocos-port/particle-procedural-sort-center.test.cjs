'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto'),ts=require('typescript');
const {unityProceduralSortCenter}=require('./particle-procedural-sort-center.cjs');
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
 for(const modify of [p=>p.moveWithTransform=1,p=>p.scalingMode=1,p=>p.NoiseModule.enabled=true,p=>p.ForceModule.enabled=true,p=>p.InitialModule.gravityModifier.scalar=1,p=>p.ShapeModule.arc.value=120,p=>p.ShapeModule.m_Rotation.y=20,p=>p.ShapeModule.randomDirectionAmount=.1,p=>p.InitialModule.startSpeed.scalar=2,p=>p.InitialModule.startLifetime.minMaxState=1]){
  const p=structuredClone(source);modify(p);assert.equal(unityProceduralSortCenter(p),null);
 }
});
