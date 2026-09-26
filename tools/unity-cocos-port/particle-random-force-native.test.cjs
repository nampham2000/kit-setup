'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('./fixtures/random-force-native.json'),mod={};
new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityRandomForceKernel.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(mod);
test('randomized force fixture binds its exact native producer',()=>{
 const p=fs.readFileSync(path.join(__dirname,'fixtures/capture-random-force.cs'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(crypto.createHash('sha256').update(p).digest('hex'),fixture.sourceProbeSha256);
 assert.equal(fixture.isPlaying,true,'Edit Mode consumes extra RNG and is not a gameplay oracle');
});
test('native randomized force matches per-tick velocity and position in 196 cases, including 17 lanes and staggered births',()=>{
 const cases=fixture.cases.filter(c=>c.randomize);assert.equal(cases.length,196);
 for(const c of cases){
  const kernel=new mod.UnityRandomForceKernel(c.count),states=Array.from({length:c.count},()=>({v:[0,0,0],p:[0,0,0]})),random={x:0,y:0,z:0};
  for(const f of c.frames){
   kernel.beginFrame(c.systemSeed,f.particles.length);
   for(let i=0;i<f.particles.length;i++){
    kernel.sample(random,i);const native=f.particles[i],actual=states[i],u=[random.x,random.y,random.z];
    for(let axis=0;axis<3;axis++){
     actual.v[axis]=Math.fround(actual.v[axis]+Math.fround(Math.fround(fixture.min+Math.fround((fixture.max-fixture.min)*u[axis]))*fixture.dt));
     actual.p[axis]=Math.fround(actual.p[axis]+Math.fround(actual.v[axis]*fixture.dt));
     assert.ok(Math.abs(actual.v[axis]-native.velocity[axis])<3e-6,`seed ${c.systemSeed}, lane ${i}, tick ${f.frame}, velocity axis ${axis}`);
     assert.ok(Math.abs(actual.p[axis]-native.position[axis])<3e-6,`seed ${c.systemSeed}, lane ${i}, tick ${f.frame}, position axis ${axis}`);
    }
   }
  }
 }
});
test('replay resets lane clocks; repeated reads do not consume extra draws',()=>{
 const k=new mod.UnityRandomForceKernel(2),a={x:0,y:0,z:0},b={x:0,y:0,z:0};k.beginFrame(123,2);k.sample(a,1);k.sample(b,1);assert.deepEqual(a,b);
 k.beginFrame(123,2);k.sample(b,1);assert.notDeepEqual(a,b);k.reset(123);k.beginFrame(123,2);k.sample(b,1);assert.deepEqual(a,b);
});
test('production CPU adapter matches native traces with Z reflection and late births',()=>{
 class Vec3{constructor(){this.x=this.y=this.z=0;}set(a,b,c){if(typeof a==='object'){this.x=a.x;this.y=a.y;this.z=a.z;}else{this.x=a;this.y=b;this.z=c;}}
  static scaleAndAdd(o,a,b,t){o.set(a.x+b.x*t,a.y+b.y*t,a.z+b.z*t);}}
 const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleRandomForce.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(out,id=>id==='cc'?{Vec3}:mod);
 for(const c of fixture.cases.filter(c=>c.randomize)){
  const pool={data:[],get length(){return this.data.length;}},force={enable:true,needTransform:false},s={time:0,capacity:c.count,forceOvertimeModule:force,unityNoise:{seed:c.systemSeed},processor:{_particles:pool,updateParticles(dt){for(const p of pool.data){force.animate(p,dt);Vec3.scaleAndAdd(p.position,p.position,p.ultimateVelocity,dt);}return pool.length;}}};
  out.installUnityParticleRandomForce(s,{autoRandomSeed:false,randomSeed:c.systemSeed,x:[-10,10],y:[-10,10],z:[-10,10]});
  for(const f of c.frames){
   while(pool.length<f.particles.length)pool.data.push({position:new Vec3(),velocity:new Vec3(),ultimateVelocity:new Vec3()});
   s.time+=fixture.dt;s.processor.updateParticles(fixture.dt);
   for(let i=0;i<pool.length;i++)for(let axis=0;axis<3;axis++){
    const key=['x','y','z'][axis],sign=axis===2?-1:1;
    assert.ok(Math.abs(pool.data[i].velocity[key]-f.particles[i].velocity[axis]*sign)<3e-6,'native signed adapter velocity');
    assert.ok(Math.abs(pool.data[i].position[key]-f.particles[i].position[axis]*sign)<3e-6,'native signed adapter position');
   }
  }
 }
});
test('randomized force contract keeps source Z correlation and rejects unmeasured modes',()=>{
 const {randomForceContract}=require('./particle-random-force-contract.cjs');
 const source={autoRandomSeed:false,randomSeed:123,ForceModule:{enabled:true,randomizePerFrame:true,inWorldSpace:true,x:{minMaxState:3,minScalar:-1,scalar:2},y:{minMaxState:3,minScalar:-3,scalar:4},z:{minMaxState:3,minScalar:-5,scalar:6}}};
 assert.deepEqual(randomForceContract(source),{autoRandomSeed:false,randomSeed:123,x:[-1,2],y:[-3,4],z:[-6,5]});
 assert.throws(()=>randomForceContract({...source,ForceModule:{...source.ForceModule,inWorldSpace:false}}),/Local/);
 assert.throws(()=>randomForceContract({...source,ForceModule:{...source.ForceModule,x:{minMaxState:1}}}),/two-constant/);
});
test('native Play Mode retained slots, deaths, swaps and late births consume pre-update pool lanes',()=>{
 const retained=require('./fixtures/retained-force-native.json');assert.equal(retained.isPlaying,true);assert.equal(retained.cases.length,12);
 const producer=fs.readFileSync(path.join(__dirname,'fixtures/capture-retained-force.cs'),'utf8').replace(/\r\n/g,'\n');assert.equal(crypto.createHash('sha256').update(producer).digest('hex'),retained.sourceProbeSha256);
 for(const c of retained.cases){
  const kernel=new mod.UnityRandomForceKernel(64);let previous=Array.from({length:c.count},(_,i)=>({seed:i+1,velocity:[1,0,0],remaining:i%3===0?.05:10}));
  for(const frame of c.frames){
   if(frame.frame===7)previous.push({seed:55,velocity:[1,0,0],remaining:10});
   kernel.beginFrame(c.systemSeed,previous.length);
   for(const particle of frame.particles){
    if(particle.remaining<=0)continue;
    const index=previous.findIndex(p=>p.seed===particle.seed),random={};assert.ok(index>=0);kernel.sample(random,index);
    for(let axis=0;axis<3;axis++){
     const expected=previous[index].velocity[axis]+(-10+20*[random.x,random.y,random.z][axis])*retained.dt;
     assert.ok(Math.abs(expected-particle.velocity[axis])<1e-5,`trails ${c.trails}, pool ${c.count}, seed ${c.systemSeed}, tick ${frame.frame}, slot ${index}, axis ${axis}`);
    }
   }
   previous=frame.particles;
  }
 }
});
