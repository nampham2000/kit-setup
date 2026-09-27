'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
class V{set(x,y,z){if(typeof x==='object')Object.assign(this,x);else Object.assign(this,{x,y,z});return this;}}
class Color{set(r,g,b,a){Object.assign(this,{r,g,b,a});return this;}}
const modules={};function load(name){if(modules[name])return modules[name];const out=modules[name]={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(out,n=>n==='cc'?{Color}:load(n.slice(2)));return out;}
const runtime=load('UnityParticleInitialState');
function fixture(file,probe){const f=require('./fixtures/'+file+'.json');assert.equal(f.isPlaying,true);assert.equal(f.sourceProbeSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/capture-'+probe+'.cs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'));return f;}
function spec(row,units=false){const c=(a,b)=>({minMaxState:3,minScalar:a,scalar:b}),rot=c(0,units?1:2*Math.PI),size=units?[c(0,1),c(0,1),c(0,1)]:[c(2,4),c(5,7),c(8,10)];return {autoRandomSeed:false,randomSeed:row.seed,size3D:row.size3D,rotation3D:row.rotation3D,lifetime:units?c(0,1):c(10,20),speed:units?c(0,1):c(1,3),size:row.size3D?size:[size[0],size[0],size[0]],rotation:[rot,rot,rot],signs:[1,1,1],color:{min:[1,0,0,1],max:[1,1,0,1],random:true}};}
function system(spec){
 const pool=[],s={capacity:32,startSize3D:spec.size3D,startRotation3D:spec.rotation3D,processor:{_particles:pool,setNewParticle(p){p.original=true;},clear(){pool.length=0;}},emit(n,dt=0){for(let i=0;i<n&&pool.length<this.capacity;i++){
  const evalAt=k=>this[k].evaluate(0,.5),p={randomSeed:123,startEuler:new V(),rotation:new V(),startSize:new V(),size:new V()};
  p.speed=evalAt('startSpeed');p.startEuler.set(this.startRotation3D?evalAt('startRotationX'):0,this.startRotation3D?evalAt('startRotationY'):0,evalAt('startRotationZ'));p.rotation.set(p.startEuler);
  p.startSize.set(evalAt('startSizeX'),this.startSize3D?evalAt('startSizeY'):evalAt('startSizeX'),this.startSize3D?evalAt('startSizeZ'):1);p.size.set(p.startSize);
  p.startColor={...evalAt('startColor')};p.startLifetime=evalAt('startLifetime')+dt;p.remainingLifetime=p.startLifetime;pool.push(p);this.processor.setNewParticle(p);
 }} };
 for(const k of ['startLifetime','startSpeed','startSizeX','startSizeY','startSizeZ','startRotationX','startRotationY','startRotationZ','startColor'])s[k]={evaluate:()=>-123};
 return s;
}
test('native automatic initialization: independent life/size/rotation/color and separate speed channel',()=>{
 let total=0;
 for(const [file,probe]of [['main-initialization-native','main-initialization'],['main-initialization-gameplay','main-initialization-gameplay']]){
  const f=fixture(file,probe);if(file.endsWith('gameplay'))assert.match(f.driver,/no Emit or Simulate/);
  for(const row of f.rows){const settings=spec(row),s=system(settings);runtime.installUnityParticleInitialState(s,settings);s.emit(row.particles.length);
   row.particles.forEach((p,i)=>{const got=s.processor._particles[i];assert.equal(got.unityNativeSeed,p.seed);assert.equal(got.randomSeed,123,'preserve stock signed-XOR-safe seed');assert.ok(Math.abs(got.startLifetime-p.lifetime)<3e-6);assert.ok(Math.abs(got.speed-p.speed)<1e-6);assert.equal(got.startColor.g,p.green);for(const [j,k]of ['x','y','z'].entries()){assert.ok(Math.abs(got.startSize[k]-p.size[j])<1.1e-6);assert.ok(Math.abs(got.startEuler[k]-p.rotation[j]*Math.PI/180)<1.1e-6);}total++;});
  }
 }
 assert.equal(total,816);
});
test('native lifetime clamps zero endpoints before interpolation',()=>{
 const f=fixture('main-units-native','main-units');
 for(const row of f.rows){const k=new (load('UnityParticleStartRotation').UnityStartRotationKernel)(17);k.reset(row.seed);k.beginBatch(17,row.size3D,row.rotation3D);row.particles.forEach((p,i)=>assert.ok(Math.abs(runtime.sampleUnityInitialCurve({minMaxState:3,minScalar:0,scalar:1},k.value(i,3),.0001)-p.lifetime)<2e-7));}
});
test('initial state composes legacy rotation, pool capacity, callbacks, signs and replay',()=>{
 const settings=spec({seed:17,size3D:false,rotation3D:true});settings.signs=[-1,1,-1];const s=system(settings);s.capacity=5;
 runtime.installUnityParticleInitialState(s,settings);load('UnityParticleStartRotation').installUnityParticleStartRotation(s,{});
 const prior=s.processor.setNewParticle;s.processor.setNewParticle=function(p){prior.call(this,p);assert.equal(p.size.z,p.size.x);assert.ok(p.rotation.x<=0&&p.rotation.z<=0);};
 s.emit(9);assert.equal(s.processor._particles.length,5);const first=JSON.stringify(s.processor._particles);s.emit(9);s.processor.clear();s.emit(5);assert.equal(JSON.stringify(s.processor._particles),first);
 assert.equal(s.startLifetime.evaluate(0,.7),-123,'non-emission evaluations remain untouched');
 let resetSeed;s.unityNoise={seed:17,reset(seed){this.seed=seed;resetSeed=seed;}};s.processor.clear();assert.equal(resetSeed,17);
});
test('source contract explicitly rejects unmeasured initialization modes',()=>{
 const {initialStateContract}=require('./particle-initial-state-binding.cjs'),c={minMaxState:3,minScalar:1,scalar:2},source={InitialModule:{startLifetime:c,startSpeed:c,startSize:c,startRotation:c,startColor:{minMaxState:0,maxColor:{r:1,g:1,b:1,a:1}}}};
 assert.deepEqual(initialStateContract(source).reasons,[]);assert.ok(initialStateContract({...source,ShapeModule:{alignToDirection:true}}).reasons.length);assert.ok(initialStateContract({...source,prewarm:true}).reasons.length);
});
