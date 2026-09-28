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

test('scalar Sphere mesh axis and rotated vertices match independent native BakeMesh',()=>{
 const f=require('./fixtures/scalar-mesh-axis-native.json'),mesh=require('./fixtures/builtin-meshes-native.json').meshes.find(m=>m.fileID===10207);
 assert.equal(f.axes.length,3);
 for(const p of f.axes){const [x,y]=p.position,length=Math.hypot(x,y);assert.ok(Math.abs(-y/length-p.axis[0])<2e-6);assert.ok(Math.abs(x/length-p.axis[1])<2e-6);assert.equal(p.axis[2],0);}
 const p=f.rows[1].particles[0],e=new V();runtime.packUnityScalarMeshRotation(e,p.rotation[2]*Math.PI/180,p.position[0],p.position[1]);
 const sx=Math.sin(e.x/2),cx=Math.cos(e.x/2),sy=Math.sin(e.y/2),cy=Math.cos(e.y/2),sz=Math.sin(e.z/2),cz=Math.cos(e.z/2);
 const q=[sx*cy*cz+cx*sy*sz,cx*sy*cz-sx*cy*sz,cx*cy*sz-sx*sy*cz,cx*cy*cz+sx*sy*sz];
 const rotate=(v)=>{const [x,y,z,w]=q,[a,b,c]=v,tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];};
 for(let i=0;i<f.vertices.length;i++){
  const v=mesh.positions.slice(i*3,i*3+3).map((x,j)=>4*x*(j===2?-1:1)),r=rotate(v);
  const world=[r[0]+p.position[0],-r[2]+p.position[2],r[1]+p.position[1]];
  world.forEach((x,j)=>assert.ok(Math.abs(x-f.vertices[i][j]*(j===2?-1:1))<2e-6));
 }
});

test('nested prefab instance overrides re-derive the attached initial-state adapter contract',()=>{
 const {initialStateContract,refreshInitialStateContract}=require('./particle-initial-state-binding.cjs');
 // ScrewOut SOF_Box/smoke: smoke.prefab startSize 0.85-1.1, SOF_Box instance override 1.5-2.
 const curve=(a,b)=>({minMaxState:3,minScalar:a,scalar:b}),white={r:1,g:1,b:1,a:1};
 const source={InitialModule:{startLifetime:curve(0.4,0.7),startSpeed:curve(8,11),startSize:curve(0.85,1.1),startRotation:curve(0,6.283185),startColor:{minMaxState:0,maxColor:white}}};
 const particle={node:{__id__:0}};
 const define=data=>Object.defineProperty(particle,'unityInitialStateContract',{value:initialStateContract(data),configurable:true});
 Object.defineProperty(particle,'unityRendererContract',{value:{eulerSigns:[-1,-1,-1]},configurable:true});
 define(source);
 const stale=JSON.stringify({...(({reasons,constantPrewarm,...spec})=>spec)(particle.unityInitialStateContract),nativeRadiusVersion:'6000.3.1f1',signs:[-1,-1,-1]});
 const adapter={source:{__id__:1},sourceContract:stale,__prefab:{__id__:3}},other={source:{__id__:1},sourceContract:'{"path":"smoke"}',__prefab:{__id__:4}};
 const builder={objects:[{_name:'smoke'},particle,adapter,{fileId:'cmp-unity-initial-state-1'},{fileId:'cmp-unity-sorting-1'},other]};
 const codes=[],reporter={low:c=>codes.push(c),high:c=>codes.push(c)};
 assert.equal(refreshInitialStateContract(builder,1,reporter),0,'unchanged source keeps the contract');
 define({...source,InitialModule:{...source.InitialModule,startSize:curve(1.5,2)}});
 assert.equal(refreshInitialStateContract(builder,1,reporter),1);
 const next=JSON.parse(adapter.sourceContract);
 assert.deepEqual(next.size[0],{minMaxState:3,scalar:2,minScalar:1.5});
 assert.equal(next.nativeRadiusVersion,'6000.3.1f1');assert.deepEqual(next.signs,[-1,-1,-1]);
 assert.equal(other.sourceContract,'{"path":"smoke"}','other adapters are untouched');
 assert.deepEqual(codes,['PARTICLE_INITIAL_STATE_OVERRIDE_SYNCED']);
 const porter=fs.readFileSync(path.join(__dirname,'..','unity-cocos-port.cjs'),'utf8');
 assert.match(porter,/applyUnityParticleDataToCocos\(builder, particleId, particleData, rendererData\);[\s\S]{0,200}refreshInitialStateContract\(builder, particleId/);
});
