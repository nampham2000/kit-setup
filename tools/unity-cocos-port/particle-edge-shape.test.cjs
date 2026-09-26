'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
class Vec3{
 constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
 static set(o,x,y,z){Object.assign(o,{x,y,z});return o;}
 static normalize(o,a){const l=Math.hypot(a.x,a.y,a.z)||1;return this.set(o,a.x/l,a.y/l,a.z/l);}
 static transformQuat(o,a){return this.set(o,a.x,a.y,a.z);}
 static transformMat4(o,a){return this.set(o,a.x,a.y,a.z);}
}
const cc={Vec3,Mat4:class{},Quat:class{}},modules={};
function load(name){if(modules[name])return modules[name];const out=modules[name]={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(out,n=>n==='cc'?cc:load(n.slice(2)));return out;}
const runtime=load('UnityParticleEdgeShape');
function fixture(name){const f=require('./fixtures/'+name+'-native.json');assert.equal(f.isPlaying,true);assert.equal(f.sourceProbeSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/capture-'+name+'.cs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'));return f;}
test('native continuous Edge travels 2*speed units/sec independent of radius; wrap endpoints remain explicitly unaccepted',()=>{
 const native=fixture('edge-shape');let checked=0,wraps=0;
 for(const row of native.rows.filter(r=>r.mode===1&&!r.burst))for(const [i,p]of row.frames.at(-1).particles.entries()){
  const phase=(i+1)*.05*row.speed/row.radius,got=runtime.unityEdgeLoopPosition(row.radius,row.speed,(i+1)*.05);
  assert.equal(p.position[1],0);assert.equal(p.position[2],0);
  if(Math.abs(phase-Math.round(phase))<1e-7){wraps++;continue;}
  assert.ok(Math.abs(got-p.position[0])<1e-5);checked++;
 }
 assert.equal(checked,38);assert.equal(wraps,6);
});
test('native initial direction +Y and spherical blend precede jitter',()=>{
 for(const name of ['edge-direction','edge-direction-jitter'])for(const row of fixture(name).rows.filter(r=>r.random===0)){
  const shape={randomDirectionAmount:0,sphericalDirectionAmount:row.spherical,randomPositionAmount:name.endsWith('jitter')?.3:0};
  const system={shapeModule:shape,unityBirthTiming:{rateDispatch:true,clock:0,dt:0,first:0,index:0,interval:0,batchCount:1}};
  runtime.installUnityParticleEdgeShape(system,{radius:1,speed:0});
  for(const sample of row.velocity){const v=sample.velocity||sample,p={position:new Vec3(),velocity:new Vec3()};shape.emit(p);assert.ok(Math.hypot(p.velocity.x-v[0],p.velocity.y-v[1],p.velocity.z-v[2])<2e-7);}
 }
});
test('Edge requires birth timing and refuses unmeasured manual/burst dispatch',()=>{
 assert.throws(()=>runtime.installUnityParticleEdgeShape({shapeModule:{}},{radius:1,speed:1}),/birth timing/);
 const system={shapeModule:{},unityBirthTiming:{rateDispatch:false}};runtime.installUnityParticleEdgeShape(system,{radius:1,speed:1});assert.throws(()=>system.shapeModule.emit({}),/burst\/manual/);
});
test('binding gates unsupported Edge settings and keeps wrap uncertainty visible',()=>{
 const {edgeShapeContract,attachEdgeShapeRuntime}=require('./particle-edge-shape-binding.cjs');
 const source={ShapeModule:{enabled:true,type:12,radius:{value:4.33,mode:1,spread:0,speed:{minMaxState:0,scalar:10}}},EmissionModule:{enabled:true,rateOverTime:{minMaxState:0,scalar:100},rateOverDistance:{minMaxState:0,scalar:0},m_BurstCount:0,m_Bursts:[]}};
 const spec=edgeShapeContract(source);assert.deepEqual(spec.reasons,[]);
 assert.ok(edgeShapeContract({...source,prewarm:true}).reasons.length);
 assert.ok(edgeShapeContract({...source,EmissionModule:{...source.EmissionModule,m_BurstCount:1}}).reasons.length);
 const messages=[],added=[],builder={objects:[{_name:'wave'},{node:{__id__:0},unityEdgeShapeContract:spec}],cocosDb:{findScriptClass:()=>({classId:'edge'})},addComponent(...args){added.push(args);}};
 const reporter={high(code){messages.push(code);},medium(code){messages.push(code);}};
 attachEdgeShapeRuntime(builder,reporter,{cocosRoot:__dirname,dryRun:true});assert.equal(added.length,1);assert.deepEqual(messages,['PARTICLE_EDGE_LOOP_ENDPOINT_UNVERIFIED']);
 builder.cocosDb.findScriptClass=()=>null;attachEdgeShapeRuntime(builder,reporter,{cocosRoot:__dirname,dryRun:true});assert.equal(messages.at(-1),'PARTICLE_EDGE_SHAPE_ADAPTER_REQUIRED');
});
