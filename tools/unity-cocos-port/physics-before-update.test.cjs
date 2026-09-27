const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function fixture(){const calls=[],physics={physicsWorld:{syncSceneToPhysics(){calls.push(['sync']);}},postUpdate(dt){calls.push(['physics',dt]);}},director={_paused:false,_invalid:false,tick(dt){calls.push(['update',dt]);physics.postUpdate(dt);}};
const m={exports:{}};new Function('module','exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityPhysicsBeforeUpdate.ts'),'utf8'),{compilerOptions:{module:1}}).outputText)(m,m.exports,()=>({director,PhysicsSystem:{instance:physics}}));return{calls,physics,director,install:m.exports.installUnityPhysicsBeforeUpdate,clock:m.exports};}
test('explicit native scene phase uses the actual tick dt once before Update and restores both methods',()=>{const f=fixture(),tick=f.director.tick,post=f.physics.postUpdate,release=f.install();f.director.tick(Math.fround(1/60));assert.deepEqual(f.calls,[['physics',Math.fround(1/60)],['update',Math.fround(1/60)],['sync']]);assert.throws(f.install,/owner/);release();release();assert.equal(f.director.tick,tick);assert.equal(f.physics.postUpdate,post);});
test('paused or invalid directors never advance fixed physics',()=>{for(const key of ['_paused','_invalid']){const f=fixture();f.install();f.director[key]=true;f.director.tick(.1);assert.deepEqual(f.calls,[['update',.1],['sync']]);}});
test('Update-authored node poses reach the backend without a second simulation',()=>{const f=fixture();let node=0,body=0,simulations=0;f.physics.postUpdate=()=>{node=body;simulations++;};f.physics.physicsWorld.syncSceneToPhysics=()=>{body=node;};f.director.tick=dt=>{node+=.4;f.physics.postUpdate(dt);};f.install();for(let i=0;i<6;i++)f.director.tick(1/60);assert.equal(simulations,6);assert.ok(Math.abs(node-2.4)<1e-12);assert.equal(body,node);});
test('fixed-birth Destroy deadlines reproduce native impact expiry frames',()=>{
 const native=require('./fixtures/impact-expiry-native.json'),f=fixture(),expiry=[];let accumulator=0,next=0;
 f.physics.physicsWorld.step=()=>{};
 f.physics.resetAccumulator=(time=0)=>{accumulator=time;};
 f.physics.postUpdate=dt=>{accumulator+=dt;while(accumulator>=native.fixedDeltaTime){
   f.physics.physicsWorld.step(native.fixedDeltaTime);
   if(next<native.collisions.length&&Math.abs(f.clock.unityFixedTime()-native.collisions[next].fixedTime)<1e-6){expiry.push(Math.fround(f.clock.unityFixedTime()+native.lifetime));next++;}
   accumulator-=native.fixedDeltaTime;
 }};
 const step=f.physics.physicsWorld.step,reset=f.physics.resetAccumulator,release=f.install();
 for(let frame=0;frame<=218;frame++){
   f.director.tick(native.step);
   const sample=native.frames.find(s=>s.frame===frame);
   if(sample)assert.equal(expiry.filter(time=>f.clock.unityRenderTime()<time).length,sample.impactCount,`frame ${frame}`);
 }
 assert.equal(next,3);f.physics.resetAccumulator();assert.equal(f.clock.unityFixedTime(),0);assert.equal(f.clock.unityRenderTime(),0);
 release();assert.equal(f.physics.physicsWorld.step,step);assert.equal(f.physics.resetAccumulator,reset);
});
