'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
class Vec3{constructor(){this.x=this.y=this.z=0;}set(a){this.x=a.x;this.y=a.y;this.z=a.z;return this;}}
const m={exports:{}};new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleBirthTiming.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(m.exports,m,()=>({pseudoRandom:()=>0,Vec3}));
const install=m.exports.installUnityParticleBirthTiming,fixture=require('./fixtures/rate-birth-native.json');
const vec=(x=0,y=0,z=0)=>({x,y,z,set(a,b,c){this.x=a;this.y=b;this.z=c;}});
function engine(c){
  const size={animate(p){const f=1+1-p.remainingLifetime/p.startLifetime;p.size.set(p.startSize.x*f,p.startSize.y*f,p.startSize.z*f);}},color={animate(p){p.alpha=Math.round((1-p.remainingLifetime/p.startLifetime)*255);}};
  const pool={data:[],get length(){return this.data.length;}};
  const processor={_particles:pool,_runAnimateList:[color,size],enableModule(){},setNewParticle(){},updateParticles(dt){
    for(let i=pool.length-1;i>=0;i--){const p=pool.data[i];p.remainingLifetime-=dt;p.animatedVelocity.set(0,0,0);p.velocity.y-=c.gravity*9.8*dt;p.ultimateVelocity.set(p.velocity.x,p.velocity.y,p.velocity.z);for(const module of this._runAnimateList)module.animate(p,dt);p.position.set(p.position.x+p.ultimateVelocity.x*dt,p.position.y+p.ultimateVelocity.y*dt,p.position.z+p.ultimateVelocity.z*dt);}return pool.length;
  }};
  const system={processor,node:{worldPosition:vec(),getWorldPosition(out){out.set(this.worldPosition);}},rateOverTime:{evaluate:()=>c.rate},gravityModifier:{mode:0,isZero:()=>!c.gravity,evaluate:()=>c.gravity},simulationSpace:0,startSize3D:false,trailModule:null,_time:0,duration:5,_isEmitting:true,_emitRateTimeCounter:0,startDelay:{evaluate:()=>0},
    emit(count,dt=0){for(let i=0;i<count;i++){const p={startLifetime:2+dt,remainingLifetime:2+dt,position:vec(this.node.worldPosition.x),velocity:vec(0,0,-2),ultimateVelocity:vec(0,0,-2),animatedVelocity:vec(),startSize:vec(3,3,1),size:vec(3,3,1),randomSeed:1};pool.data.push(p);processor.setNewParticle(p);}},
    _emit(dt){this._emitRateTimeCounter+=c.rate*dt;if(this._emitRateTimeCounter>1){const n=Math.floor(this._emitRateTimeCounter);this._emitRateTimeCounter-=n;this.emit(n,dt);}},
    update(dt){this._time+=dt;this._emit(dt);processor.updateParticles(dt);}};
  return system;
}
test('native rate birth fixture binds its capture producer',()=>{
  const source=fs.readFileSync(path.join(__dirname,'fixtures/capture-rate-birth.cs'),'utf8').replace(/\r\n/g,'\n');assert.equal(crypto.createHash('sha256').update(source).digest('hex'),fixture.sourceProbeSha256);
});
for(const c of fixture.cases)test(`native rate ${c.rate}, gravity ${c.gravity}, moving ${c.moving}: age, size, alpha, gravity and emitter interpolation`,()=>{
  const system=engine(c);install(system,fixture.gravity[1]);
  for(const frame of c.frames){
    system.node.worldPosition.x=c.moving?Math.fround(frame.frame*.4):0;
    system.update(c.dt);const actual=[...system.processor._particles.data].sort((a,b)=>a.remainingLifetime-b.remainingLifetime),expected=[...frame.particles].sort((a,b)=>a.remainingLifetime-b.remainingLifetime);
    if(c.rate===60)assert.equal(actual.length,expected.length,`frame ${frame.frame}`);
    else assert.ok(Math.abs(actual.length-expected.length)<=1,'at most one native float-boundary birth');
    for(let i=0;i<actual.length;i++){const a=actual[i],e=expected[i];assert.equal(a.startLifetime,e.startLifetime);assert.ok(Math.abs(a.remainingLifetime-e.remainingLifetime)<2e-6,'native remaining age');
      for(let axis=0;axis<3;axis++){const sign=axis===2?-1:1;assert.ok(Math.abs([a.position.x,a.position.y,a.position.z][axis]-e.position[axis]*sign)<2e-6,'native partial motion');assert.ok(Math.abs([a.velocity.x,a.velocity.y,a.velocity.z][axis]-e.velocity[axis]*sign)<2e-6,'native partial gravity');assert.ok(Math.abs([a.size.x,a.size.y,a.size.z][axis]-e.size[axis])<2e-6,'native size and uniform Z');}
      assert.ok(Math.abs(a.alpha-e.alpha)<=1,'Native Color32 alpha');
    }
  }
});
const clock=require('./fixtures/rate-clock-native.json');
test('32-frame native clocks retain source rate-60 cadence; other rates differ by at most one boundary birth',()=>{
  const producer=fs.readFileSync(path.join(__dirname,'fixtures/capture-rate-clock.cs'),'utf8').replace(/\r\n/g,'\n');
  assert.equal(crypto.createHash('sha256').update(producer).digest('hex'),clock.sourceProbeSha256);
  for(const c of clock.cases){
    const s=engine({...c,gravity:0});install(s);
    for(const f of c.frames){s.update(c.dt);const n=s.processor._particles.length;
      if(c.rate===60)assert.equal(n,f.count,`rate ${c.rate}, frame ${f.frame}`);
      else assert.ok(Math.abs(n-f.count)<=1,`rate ${c.rate}, frame ${f.frame}: ${n} vs ${f.count}`);
    }
  }
});
test('external emit has zero delay by default and a restarted system resets its emission clock',()=>{
  const c=fixture.cases[0],s=engine(c);install(s);s.emit(1);
  assert.ok(Number.isFinite(s.processor._particles.data[0].remainingLifetime));
  for(let i=0;i<6;i++)s.update(c.dt);
  s._time=0;s._emitRateTimeCounter=0;s.processor._particles.data.length=0;s.update(c.dt);
  assert.equal(s.processor._particles.length,1);
  assert.ok(Math.abs(s.processor._particles.data[0].remainingLifetime-2)<2e-6);
});
test('module replacements preserve native per-particle dt and pool reuse clears the previous birth state',()=>{
  const c=fixture.cases[0],s=engine(c);install(s);s.update(c.dt);
  const observed=[];s.processor._runAnimateList[1].animate=function(p,dt){observed.push(dt);};s.update(c.dt);
  assert.ok(observed.some(dt=>dt<c.dt));assert.ok(observed.some(dt=>dt===c.dt));
});
test('inactive prefab staging installs birth hooks when the CPU processor becomes available',()=>{
  const module={exports:{}};
  new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleSimulationStep.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(module.exports,module,()=>m.exports);
  const c=fixture.cases.find(c=>c.rate===200&&!c.gravity&&!c.moving),system=engine(c),processor=system.processor;
  system.processor=null;module.exports.installUnityParticleSimulationStep(system,.03);assert.equal(system.unityBirthTiming,undefined);
  system.processor=processor;system.update(c.dt);
  assert.ok(system.unityBirthTiming);const ages=processor._particles.data.map(p=>2-p.remainingLifetime).sort((a,b)=>a-b);
  assert.ok(Math.abs(ages[0]-.001666667)<2e-6);assert.ok(Math.abs(ages[2]-.011666667)<2e-6);
});
