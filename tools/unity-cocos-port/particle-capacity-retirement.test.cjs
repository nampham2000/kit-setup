'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
class Vec3 {constructor(){this.x=this.y=this.z=0;}set(v){Object.assign(this,v);}}
const load=name=>{const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{compilerOptions:{module:1}}).outputText)(out,()=>({Vec3,pseudoRandom:()=>0}));return out;};
const timing=load('UnityParticleBirthTiming'),{UnityStartRotationKernel}=load('UnityParticleStartRotation');
const fixture=require('./fixtures/saturated-capacity-native.json');
test('source callback modules retain the existing death path',()=>{
 const {capacityRetirementEligible}=require('./particle-capacity-contract.cjs');
 assert.equal(capacityRetirementEligible({EmissionModule:{enabled:true}}),true);
 for(const name of ['SubModule','CollisionModule','TrailModule','TriggerModule']){assert.equal(capacityRetirementEligible({[name]:{enabled:true}}),false);assert.equal(capacityRetirementEligible({[name]:{enabled:false}}),true);}
});
function simulate(row,retire){
 const pool={data:[],get length(){return this.data.length;},removeAt(i){this.data[i]=this.data[this.data.length-1];this.data.pop();}};
 const kernel=new UnityStartRotationKernel(row.capacity);kernel.reset(row.seed);
 const processor={_particles:pool,_runAnimateList:[],enableModule(){},setNewParticle(){},updateParticles(dt){for(let i=pool.length-1;i>=0;i--){const p=pool.data[i];p.remainingLifetime-=dt;if(p.remainingLifetime<0)pool.removeAt(i);else for(const m of this._runAnimateList)m.animate(p,dt);}return pool.length;}};
 const vec=()=>({x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});}});
 const s={processor,capacity:row.capacity,node:{getWorldPosition(out){out.set({x:0,y:0,z:0});}},simulationSpace:1,startSize3D:false,gravityModifier:{isZero:()=>true},rateOverTime:{mode:0,evaluate:()=>row.rate},startDelay:{evaluate:()=>0},duration:4,_time:0,_isEmitting:true,_emitRateTimeCounter:0,
  emit(count,dt=0){const n=Math.max(0,Math.min(Math.ceil(count),row.capacity-pool.length));if(!n)return;kernel.beginBatch(n,false,false);
   for(let i=0;i<n;i++){const c=row.lifetime,life=c.minMaxState===0?c.scalar:Math.fround(c.minScalar+Math.fround(Math.fround(c.scalar-c.minScalar)*kernel.value(i,3)));
    const p={seed:kernel.birthSeed(i),startLifetime:life+dt,remainingLifetime:life+dt,startSize:vec(),size:vec(),position:vec(),ultimateVelocity:vec()};pool.data.push(p);processor.setNewParticle(p);}},
  _emit(dt){this._emitRateTimeCounter+=row.rate*dt;if(this._emitRateTimeCounter>1){const n=Math.floor(this._emitRateTimeCounter);this._emitRateTimeCounter-=n;this.emit(n,dt);}}};
 timing.installUnityParticleBirthTiming(s);if(retire)timing.installUnityParticleCapacityRetirement(s);
 const result=[];
 for(let f=0;f<=300;f++){const dt=Math.fround(1/60);s._time+=dt;s._emit(dt);processor.updateParticles(dt);if(row.frames.some(r=>r.frame===f))result.push({frame:f,particles:pool.data.map(p=>({seed:p.seed,remaining:p.remainingLifetime}))});}
 return result;
}
for(const row of fixture.rows)test('native saturated retirement '+row.name+' '+row.viewport,()=>{
 const actual=simulate(row,true);
 for(let i=0;i<row.frames.length;i++){const a=actual[i],u=row.frames[i];assert.equal(a.particles.length,u.particles.length,'count frame '+a.frame);for(const p of u.particles){const q=a.particles.find(q=>q.seed===p.seed);assert.ok(q,'seed '+p.seed+' frame '+a.frame);assert.ok(Math.abs(q.remaining-p.remaining)<.0001,'age frame '+a.frame);}}
});
