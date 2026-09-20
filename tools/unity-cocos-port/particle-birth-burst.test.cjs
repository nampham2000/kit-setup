'use strict';
const fs=require('node:fs'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript');
class Vec3 {constructor(){this.x=0;this.y=0;this.z=0;}set(v){Object.assign(this,v);}static subtract(o,a,b){for(const k of ['x','y','z'])o[k]=a[k]-b[k];}static add(o,a,b){for(const k of ['x','y','z'])o[k]=a[k]+b[k];}}
const result={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleBirthBurst.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(result,id=>id==='cc'?{Vec3,Mat4:class{},ParticleSystem:class{emit(){}}}:id.endsWith('NestedEmission')?{installUnityParticleNestedEmission(){}}:{UnityParticleSubEmitterFollower:class{}});
function fixture(delay=0,min=1,max=1){
 const p={position:new Vec3(),randomSeed:5,startLifetime:1,remainingLifetime:1};
 const node={getComponents(){return[];},worldPosition:new Vec3()};let count=0;
 const source={capacity:1,simulationSpace:0,node,processor:{setNewParticle(){},updateParticles(dt){p.remainingLifetime-=dt;return 1;}}};
 const target={simulationSpace:0,node,processor:{setNewParticle(){}},stop(){},play(){},bursts:[],rateOverTime:{},rateOverDistance:{},emit(n){count+=n;this.processor.setNewParticle({position:new Vec3()});}};
 const adapter=new result.UnityParticleBirthBurst(source,target,max,true,delay,min);
 return {p,source,target,adapter,count:()=>count};
}
test('native delayed burst is absent before .2 seconds and emitted once after it',()=>{
 const f=fixture(Math.fround(.2));f.source.processor.setNewParticle(f.p);
 for(const sample of require('./fixtures/birth-schedule.json')[1].samples){f.source.processor.updateParticles(Math.fround(.02));assert.equal(f.count(),sample.count,`time=${sample.time}`);}
 f.adapter.destroy();
});
test('recycled parent cannot receive an old scheduled callback',()=>{
 const f=fixture(.2);f.source.processor.setNewParticle(f.p);f.p.randomSeed++;
 f.source.processor.updateParticles(.3);assert.equal(f.count(),0);f.adapter.destroy();
});
test('native burst range is inclusive and uniformly partitioned',()=>{
 const f=fixture(0,4,8),random=Math.random;
 try{for(let i=0;i<5;i++){Math.random=()=>i/5+.001;const before=f.count();f.source.processor.setNewParticle(f.p);assert.equal(f.count()-before,4+i);}}finally{Math.random=random;f.adapter.destroy();}
 const histogram=require('./fixtures/burst-distribution.json')[0].histogram;
 assert.equal(histogram.reduce((n,v)=>n+v,0),1000);
 for(let i=4;i<=8;i++)assert.ok(histogram[i]>140&&histogram[i]<260,'native range endpoints must have full-width probability');
});
