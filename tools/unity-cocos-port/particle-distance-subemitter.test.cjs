'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),test=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript');
const native=require('./fixtures/distance-subemitters-native.json');
const delayNative=require('./fixtures/subemitter-delay-native.json');
const {distanceSubEmitterContract}=require('./particle-distance-subemitter-contract.cjs');
class Vec3 {
 constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
 set(a,b,c){if(typeof a==='object'){this.x=a.x;this.y=a.y;this.z=a.z;}else{this.x=a;this.y=b;this.z=c;}return this;}
 static distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);}
 static add(o,a,b){o.set(a.x+b.x,a.y+b.y,a.z+b.z);}
 static subtract(o,a,b){o.set(a.x-b.x,a.y-b.y,a.z-b.z);}
 static lerp(o,a,b,t){o.set(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);}
 static transformMat4(o,a,m){o.set(a.x+m.x,a.y+m.y,a.z+m.z);}
 static transformMat4Normal(o,a){o.set(a);}
}
class Mat4 {static invert(o,m){o.x=-m.x;o.y=-m.y;o.z=-m.z;}}
const cc={Vec3,Mat4,ParticleSystem:class{},pseudoRandom:()=>0},modules={};
function load(name){
 if(modules[name])return modules[name];const out={};modules[name]=out;
 new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(out,id=>id==='cc'?cc:load(id.slice(2)));return out;
}
function engine(space,node,velocity){
 const pool={data:[],get length(){return this.data.length;}};
 const processor={_particles:pool,_runAnimateList:[],setNewParticle(){},enableModule(){},updateParticles(dt){
  for(const p of pool.data){p.remainingLifetime=Math.fround(p.remainingLifetime-dt);p.ultimateVelocity.set(p.velocity);for(const m of this._runAnimateList)m.animate(p,dt);p.position.z=Math.fround(p.position.z+Math.fround(p.ultimateVelocity.z*dt));}return pool.length;
 }};
 const s={capacity:1000,simulationSpace:space,node,processor,bursts:[],startDelay:{mode:0,evaluate:()=>0},startLifetime:{mode:0,evaluate:()=>2},rateOverTime:{evaluate:()=>0},rateOverDistance:{},gravityModifier:{isZero:()=>true},startSize3D:false,trailModule:null,
 stop(){pool.data.length=0;},play(){},_emit(){},emit(count,dt=0){for(let i=0;i<count;i++){
  const p={position:new Vec3(),velocity:new Vec3(0,0,velocity),ultimateVelocity:new Vec3(0,0,velocity),startSize:new Vec3(1,1,1),size:new Vec3(1,1,1),startLifetime:2+dt,remainingLifetime:2+dt,randomSeed:321};
  if(space===0)p.position.set(node.worldPosition);pool.data.push(p);processor.setNewParticle(p);
 }}};return s;
}
function setup(row){
 const root=new Vec3(),child=new Vec3(.5,.3,0),scale=new Vec3(1,1,1);
 const node=pos=>({worldPosition:pos,worldMatrix:pos,worldScale:scale,getWorldPosition(out){out.set(pos);}});
 const source=engine(row.sourceSpace===1?0:1,node(root),3),target=engine(row.targetSpace===1?0:1,node(child),0);
 const adapter=new (load('UnityParticleDistanceSubEmitter').UnityParticleDistanceSubEmitter)(source,target,row.rate,target.simulationSpace);
 source.emit(1);return{source,target,adapter,move(frame){root.x=row.moving?Math.fround(frame*.1):0;child.x=root.x+.5;}};
}
test('native distance fixture binds exact producer and documents acceptance scope',()=>{
 const producer=fs.readFileSync(path.join(__dirname,'fixtures/capture-distance-subemitters.cs'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(crypto.createHash('sha256').update(producer).digest('hex'),native.sourceProbeSha256);assert.equal(native.rows.length,24);
});

test('native start-delay fixture binds its producer and both simulation spaces',()=>{
 const source=fs.readFileSync(path.join(__dirname,'fixtures/capture-subemitter-delay.cs'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),delayNative.sourceProbeSha256);
 assert.equal(delayNative.rows.length,8);
});
for(const row of delayNative.rows.filter(r=>r.delay>0))test(`native sub-emitter delay ${row.delay}, space ${row.targetSpace}`,()=>{
 const pos=new Vec3(),node={worldPosition:pos,worldMatrix:pos,worldScale:new Vec3(1,1,1),getWorldPosition(out){out.set(pos);}};
 const source=engine(0,node,3),target=engine(row.targetSpace===1?0:1,node,0);
 target.startDelay={mode:0,evaluate:()=>row.delay};
 const construct=()=>new (load('UnityParticleDistanceSubEmitter').UnityParticleDistanceSubEmitter)(source,target,20,target.simulationSpace);
 if(row.delay<delayNative.sourceLifetime){assert.throws(construct,/partial.*start delay/);assert.ok(row.frames.some(f=>f.count>0));return;}
 const adapter=construct();source.emit(1);
 for(const sample of row.frames){if(sample.frame)source.processor.updateParticles(delayNative.deltaTime);assert.equal(target.processor._particles.length,sample.count);}
 assert.equal(adapter.emitted,0);
});
for(const row of native.rows.filter(r=>!r.moving||r.sourceSpace===r.targetSpace))test(`native Birth distance ${row.rate}, source ${row.sourceSpace}, target ${row.targetSpace}, moving ${row.moving}: counts, positions and partial ages`,()=>{
 const f=setup(row);let last=0;
 for(const sample of row.frames){
  while(last<sample.frame){f.move(++last);f.source.processor.updateParticles(native.deltaTime);f.target.processor.updateParticles(native.deltaTime);}
  const actual=f.target.processor._particles.data.map(p=>({position:[p.position.x+(f.target.simulationSpace?f.target.node.worldPosition.x:0),p.position.y+(f.target.simulationSpace?f.target.node.worldPosition.y:0),p.position.z],remaining:p.remainingLifetime,lifetime:p.startLifetime}));
  assert.ok(Math.abs(actual.length-sample.count)<=1,'one float-crossing count');
  const expected=[...sample.children];let unmatched=0;
  for(const a of actual){
   const index=expected.findIndex(e=>Math.abs(e.position[2]-a.position[2])<3e-6);
   if(index<0){unmatched++;continue;}const e=expected.splice(index,1)[0];
   for(let axis=0;axis<3;axis++)assert.ok(Math.abs(a.position[axis]-e.position[axis])<3e-6,`frame ${sample.frame} position ${axis}: ${a.position} vs ${e.position}`);
   assert.ok(Math.abs(a.lifetime-e.lifetime)<1e-12,'fixed source lifetime');assert.ok(Math.abs(a.remaining-e.remaining)<3e-6,'native partial age');
  }
  assert.ok(unmatched+expected.length<=1,'only one unpaired boundary birth permitted');
 }
 f.adapter.destroy();
});
test('measured moving cross-space ambiguity remains an explicit unsupported case',()=>{
 for(const row of native.rows.filter(r=>r.moving&&r.sourceSpace!==r.targetSpace)){
  const f=setup(row);f.move(1);assert.throws(()=>f.source.processor.updateParticles(native.deltaTime),/Unverified moving cross-space/);f.adapter.destroy();
 }
});
test('constant distance contract rejects approximations and preserves target space',()=>{
 const entry={type:0,properties:0,emitProbability:1},target={moveWithTransform:0,EmissionModule:{enabled:true,rateOverTime:{minMaxState:0,scalar:0},rateOverDistance:{minMaxState:0,scalar:6},m_BurstCount:0,m_Bursts:[]}};
 assert.deepEqual(distanceSubEmitterContract(entry,target),{rate:6,simulationSpace:1});
 for(const mutate of [t=>t.EmissionModule.rateOverTime.scalar=1,t=>t.EmissionModule.rateOverDistance.minMaxState=3,t=>t.EmissionModule.m_BurstCount=1,t=>t.moveWithTransform=2]){const t=structuredClone(target);mutate(t);assert.throws(()=>distanceSubEmitterContract(entry,t),/Unverified/);}
 assert.throws(()=>distanceSubEmitterContract({...entry,properties:1},target),/inheritance/);
 assert.throws(()=>distanceSubEmitterContract({...entry,emitProbability:.5},target),/probability/);
});
test('reset clears old parents and native distance never moves the emitter node',()=>{
 const f=setup(native.rows[0]),before={...f.target.node.worldPosition};f.source.processor.updateParticles(.4);
 assert.deepEqual({...f.target.node.worldPosition},before);const count=f.adapter.emitted;
 f.adapter.reset();f.source.processor.updateParticles(.4);assert.equal(f.adapter.emitted,count);f.adapter.destroy();
});
test('generic prefab porter binds source distance instead of hardcoded 36/second and is idempotent',()=>{
 const objects=[{__type__:'cc.Node',_name:'parent',_components:[{__id__:1}]},{__type__:'cc.ParticleSystem',node:{__id__:0}},
  {__type__:'cc.Node',_name:'child',_components:[{__id__:3}]},{__type__:'cc.ParticleSystem',node:{__id__:2},rateOverTime:{__id__:4},rateOverDistance:{__id__:5}},
  {constant:99},{constant:99}];
 const data={classId:198,ParticleSystem:{moveWithTransform:0,EmissionModule:{enabled:1,rateOverTime:{minMaxState:0,scalar:0},rateOverDistance:{minMaxState:0,scalar:6},m_BurstCount:0,m_Bursts:[]}}};
 const source={classId:198,ParticleSystem:{SubModule:{enabled:1,subEmitters:[{type:0,properties:0,emitProbability:1,emitter:{fileID:'11'}}]}}};
 const model={file:'native.prefab',componentDocs:new Map([['10',source],['11',data]])},events=[];
 const builder={objects,componentMap:new Map([['10',1],['11',3]]),cocosDb:{findScriptClass:()=>({classId:'registered-helper'})},addComponent(node,type,props){const id=objects.length;objects.push({__type__:type,...props});objects[node]._components.push({__id__:id});return id;}};
 const reporter={low(code){events.push(code);},medium(code){events.push(code);},high(code){events.push(code);}};
 const porter=require('./runtime-component-porter')({});porter.attachParticleSubEmitterFollowers(model,builder,reporter);porter.attachParticleSubEmitterFollowers(model,builder,reporter);
 const helper=objects.find(o=>o.__type__==='registered-helper');assert.equal(helper.entries.length,1);
 assert.equal(helper.entries[0].sourceDistanceRate,6);assert.equal(helper.entries[0].emitRatePerParticle,0);
 assert.equal(objects[3]._simulationSpace,1);assert.equal(objects[4].constant,0);assert.equal(objects[5].constant,0);
 assert.deepEqual(events,['PARTICLE_DISTANCE_SUB_EMITTER_BOUND']);
});
