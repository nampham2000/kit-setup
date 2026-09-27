'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
const mod={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleStartRotation.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(mod,()=>({}));
function fixture(name,producer){const f=require('./fixtures/'+name+'.json');assert.equal(f.isPlaying,true);assert.equal(f.sourceProbeSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures',producer+'.cs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'));return f;}
function batch(k,count,size,three,map,mask=7){k.beginBatch(count,size,three);for(let i=0;i<count;i++)map.set(k.birthSeed(i),[three?(mask&1?k.value(i,0)*360:.3*180/Math.PI):0,three?(mask&2?k.value(i,1)*360:.5*180/Math.PI):0,mask&4?k.value(i,2)*360:.7*180/Math.PI]);}
function compare(map,particles){for(const p of particles){const v=map.get(p.seed??p.particleSeed);assert.ok(v,'native generated seed identifies the birth despite pool compaction');v.forEach((x,a)=>assert.ok(Math.abs(x-p.rotation[a])<1e-4,`${x} versus ${p.rotation[a]}, axis ${a}`));}}
test('240 native plain births: constants, independent axes, unsigned seeds and SIMD padding',()=>{const f=fixture('start-rotation-native','capture-start-rotation');assert.equal(f.rows.length,240);for(const r of f.rows){const k=new mod.UnityStartRotationKernel(17),map=new Map();k.reset(r.systemSeed);for(let b=0;b<(r.batched?1:r.count);b++)batch(k,r.batched?r.count:1,false,r.threeD,map,r.mask);compare(map,r.particles);}});
test('64 native two-batch cases preserve rotation across size, shape, speed and color options',()=>{const rows=fixture('start-rotation-options-native','capture-start-rotation-options').rows.filter(r=>r.emitStyle===0);assert.equal(rows.length,64);for(const r of rows){const k=new mod.UnityStartRotationKernel(10),map=new Map();k.reset(r.systemSeed);batch(k,5,r.size3D,r.threeD,map);batch(k,5,r.size3D,r.threeD,map);compare(map,r.particles);}});
test('actual automatic PlayerLoop births match without Emit or Simulate',()=>{const f=fixture('start-rotation-gameplay-native','capture-start-rotation-gameplay');assert.match(f.driver,/no Emit or Simulate/);assert.equal(f.rows.length,4);for(const r of f.rows){const k=new mod.UnityStartRotationKernel(5),map=new Map();k.reset(f.systemSeed);batch(k,5,r.size3D,r.rotation3D,map);compare(map,r.particles);}});
test('CPU adapter composes birth callbacks, signs, capacity and replay',()=>{
 class V{set(x,y,z){if(typeof x==='object')Object.assign(this,x);else Object.assign(this,{x,y,z});}}
 const pool=[],s={capacity:5,processor:{_particles:pool,setNewParticle(p){p.original=true;},clear(){pool.length=0;}},emit(n){for(let i=0;i<n&&pool.length<this.capacity;i++){const p={startEuler:new V(),rotation:new V()};pool.push(p);this.processor.setNewParticle(p);}}};
 const c={minMaxState:3,minScalar:0,scalar:2*Math.PI};mod.installUnityParticleStartRotation(s,{autoRandomSeed:false,randomSeed:17,size3D:false,x:c,y:c,z:c,signs:[-1,-1,1]});
 const born=s.processor.setNewParticle;s.processor.setNewParticle=function(p){born.call(this,p);p.after={...p.rotation};};
 s.emit(7);assert.equal(pool.length,5);const first=JSON.stringify(pool);assert.ok(pool.every(p=>p.original&&p.after.x===p.startEuler.x&&p.rotation.x<=0&&p.rotation.z>=0));assert.notEqual(pool[0].rotation.x,pool[0].rotation.y);s.emit(1);s.processor.clear();s.emit(5);assert.equal(JSON.stringify(pool),first);
 const k=new mod.UnityStartRotationKernel(1);assert.throws(()=>k.beginBatch(2,false),/capacity/);
});
test('automatic PlayerLoop repeated bursts retain RNG state over twelve frames',()=>{
 const f=fixture('start-rotation-sequence-native','capture-start-rotation-sequence');assert.equal(f.rows.length,48);
 for(const size of [false,true])for(const three of [false,true]){const k=new mod.UnityStartRotationKernel(20),map=new Map();k.reset(f.systemSeed);let count=0;for(const row of f.rows.filter(r=>r.size3D===size&&r.rotation3D===three)){const born=row.particles.length-count;if(born)batch(k,born,size,three,map);compare(map,row.particles);count=row.particles.length;}assert.equal(count,15);}
});
test('binding requires measured source modes and imported class metadata',()=>{
 const {startRotationContract,attachStartRotationRuntime}=require('./particle-start-rotation-binding.cjs');
 const c={minMaxState:3,minScalar:0,scalar:6.283185},source={autoRandomSeed:false,randomSeed:17,InitialModule:{rotation3D:1,size3D:0,startRotationX:c,startRotationY:c,startRotation:c}};
 const contract=startRotationContract(source);assert.deepEqual(contract.reasons,[]);assert.equal(contract.autoRandomSeed,false);
 assert.deepEqual(startRotationContract({...source,prewarm:true}).reasons,['prewarm-before-adapter-start']);
 assert.deepEqual(startRotationContract({...source,ShapeModule:{alignToDirection:1}}).reasons,['shape-align-to-direction']);
 assert.equal(startRotationContract({...source,InitialModule:{...source.InitialModule,rotation3D:0}}),null);
 const p={node:{__id__:0},unityStartRotationContract:contract,unityRendererContract:{eulerSigns:[1,1,-1]}},errors=[],added=[];
 const builder={objects:[{_name:'ring'},p],cocosDb:{findScriptClass:()=>({classId:'registered'})},addComponent(...args){added.push(args);}};
 attachStartRotationRuntime(builder,{high(...args){errors.push(args);},low(){}},{dryRun:true,cocosRoot:__dirname});assert.equal(added.length,1);assert.equal(errors.length,0);assert.deepEqual(JSON.parse(added[0][2].sourceContract).signs,[1,1,-1]);
 builder.cocosDb.findScriptClass=()=>null;attachStartRotationRuntime(builder,{high(...args){errors.push(args);},low(){}},{dryRun:true,cocosRoot:__dirname});assert.equal(errors[0][0],'PARTICLE_START_ROTATION_ADAPTER_REQUIRED');
});
