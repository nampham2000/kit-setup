'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
const heldout=require('./fixtures/fixed-force-native.json'),original=require('./fixtures/random-force-native.json');
const kernel={};new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityRandomForceKernel.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(kernel);
test('held-out fixed Force fixture binds its native producer',()=>{
 assert.equal(heldout.cases.length,64);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/capture-fixed-force.cs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'),heldout.sourceProbeSha256);
});
test('fixed Force source binding distinguishes measured random ranges from ordinary force',()=>{
 const {randomForceContract}=require('./particle-random-force-contract.cjs');
 const axis={minMaxState:3,minScalar:-2,scalar:2};const source={ForceModule:{enabled:true,randomizePerFrame:false,inWorldSpace:true,x:axis,y:axis,z:axis}};
 assert.equal(randomForceContract(source).randomized,false);
 assert.equal(randomForceContract({ForceModule:{...source.ForceModule,x:{minMaxState:0},y:{minMaxState:0},z:{minMaxState:0}}}),null);
 assert.throws(()=>randomForceContract({ForceModule:{...source.ForceModule,inWorldSpace:false}}),/Local/);
});
for(const [name,cases,dt,ranges] of [['original',original.cases.filter(c=>!c.randomize),original.dt,[[original.min,original.max],[original.min,original.max],[original.min,original.max]]],['held-out high/wrapping seeds',heldout.cases,heldout.dt,heldout.ranges]])
test('fixed Force matches '+name+' native XYZ trajectories',()=>{
 const random={x:0,y:0,z:0},f=Math.fround;
 for(const c of cases){const states=[];
  for(const frame of c.frames)for(let i=0;i<frame.particles.length;i++){
   const native=frame.particles[i],state=states[i]||(states[i]={v:[0,0,0],p:[0,0,0]});kernel.unityFixedForceRandom(random,native.seed);
   for(let axis=0;axis<3;axis++){const u=random[['x','y','z'][axis]],range=ranges[axis],force=f(range[0]+f((range[1]-range[0])*u));
    state.v[axis]=f(state.v[axis]+f(force*dt));state.p[axis]=f(state.p[axis]+f(state.v[axis]*dt));
    assert.ok(Math.abs(state.v[axis]-native.velocity[axis])<3e-6,`seed ${native.seed}, frame ${frame.frame}, axis ${axis}: ${state.v[axis]} vs ${native.velocity[axis]}`);
    assert.ok(Math.abs(state.p[axis]-native.position[axis])<3e-6,'native position');
   }
  }
 }
});
test('fixed Force adapter preserves independent axes, source Z sign and pool-order independence',()=>{
 class Vec3{constructor(){this.x=this.y=this.z=0;}set(a,b,c){if(typeof a==='object'){this.x=a.x;this.y=a.y;this.z=a.z;}else{this.x=a;this.y=b;this.z=c;}}static scaleAndAdd(o,a,b,t){o.set(a.x+b.x*t,a.y+b.y*t,a.z+b.z*t);}}
 const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleRandomForce.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(out,id=>id==='cc'?{Vec3}:kernel);
 for(const c of heldout.cases){const pool={data:[],get length(){return this.data.length;}},module={enable:true,needTransform:false};const update=function(){};
  const s={capacity:17,forceOvertimeModule:module,processor:{_particles:pool,updateParticles:update}};
  out.installUnityParticleRandomForce(s,{randomized:false,autoRandomSeed:false,randomSeed:991,x:[-3,7],y:[-5,11],z:[-2,13]});assert.equal(s.processor.updateParticles,update);
  for(const frame of c.frames){while(pool.length<frame.particles.length)pool.data.push({randomSeed:frame.particles[pool.length].seed,velocity:new Vec3(),ultimateVelocity:new Vec3(),position:new Vec3()});
   for(let i=pool.length-1;i>=0;i--){const p=pool.data[i];module.animate(p,heldout.dt);Vec3.scaleAndAdd(p.position,p.position,p.ultimateVelocity,heldout.dt);
    for(let axis=0;axis<3;axis++){const key=['x','y','z'][axis],sign=axis===2?-1:1,n=frame.particles[i];assert.ok(Math.abs(p.velocity[key]-n.velocity[axis]*sign)<3e-6,'adapter velocity');assert.ok(Math.abs(p.position[key]-n.position[axis]*sign)<3e-6,'adapter position');}
   }
  }
 }
});
