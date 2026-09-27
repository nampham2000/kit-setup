'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const m={exports:{}};
new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleEulerRotation.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m.exports,m,()=>({}));
const {installUnityParticleEulerRotation,packUnityEulerRotation}=m.exports;
const native=require('./fixtures/particle-rotation-over-lifetime-native.json');
test('native fixture is bound to its capture script',()=>{
  const script=fs.readFileSync(path.join(__dirname,'fixtures/capture-rotation-over-lifetime.cs'),'utf8').replace(/\r\n/g,'\n');
  assert.equal(require('node:crypto').createHash('sha256').update(script).digest('hex'),native.source.captureSha256Lf);
});
const D=Math.PI/180;
const vec=(x=0,y=0,z=0)=>({x,y,z,set(a,b,c){this.x=a;this.y=b;this.z=c;return this;}});
const constant=value=>({evaluate:()=>value});
// Vertex-shader ABI: xyz of the quaternion; w rebuilt from |xyz| (x>5 flags negative w).
function unpack(r){let x=r.x,s=1;if(x>5){x-=10;s=-1;}return [x,r.y,r.z,s*Math.sqrt(Math.abs(1-x*x-r.y*r.y-r.z*r.z))];}
function rotate(q,v){const [x,y,z,w]=q,tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);return [v[0]+w*tx+y*tz-z*ty,v[1]+w*ty+z*tx-x*tz,v[2]+w*tz+x*ty-y*tx];}
function simulate(c,curves){
  // Converter signs: Mesh (-X,-Y,+Z); Local billboard (+X,+Y,-Z) (particle-renderer-contract eulerSigns).
  const signs=c.renderMode==='Mesh'?[-1,-1,1]:[1,1,-1];
  const rotation={separateAxes:c.separateAxes,...(curves||{x:constant(c.angularVelocityDegPerSecond[0]*D*signs[0]),y:constant(c.angularVelocityDegPerSecond[1]*D*signs[1]),z:constant(c.angularVelocityDegPerSecond[2]*D*signs[2])})};
  const system={rotationOvertimeModule:rotation};
  assert.equal(installUnityParticleEulerRotation(system),true);
  const p={startLifetime:c.lifetime,remainingLifetime:c.lifetime,randomSeed:4321,startEuler:vec(...c.startRotation3D.map((v,i)=>v*D*signs[i])),rotation:vec()};
  rotation.animate(p,0); // UnityParticleBirthState initializes appearance at birth with dt=0.
  for(let i=0;i<c.steps;i++){p.remainingLifetime-=c.dt;rotation.animate(p,c.dt);}
  return {p,signs};
}
for(const c of native.cases)test(`native ${c.name}: Euler components integrate like rotation3D and render Z-X-Y`,()=>{
  const {p,signs}=simulate(c);
  [p.startEuler.x,p.startEuler.y,p.startEuler.z].forEach((v,i)=>assert.ok(Math.abs(v-c.rotation3D[i]*D*signs[i])<2e-5,`axis ${i}: ${v} vs ${c.rotation3D[i]*D*signs[i]}`));
  const q=unpack(p.rotation);
  if(c.renderMode==='Mesh'){
    native.mesh.forEach((v,i)=>{
      const actual=rotate(q,[v[0],v[1],-v[2]]),expected=[c.vertices[i][0],c.vertices[i][1],-c.vertices[i][2]];
      for(let j=0;j<3;j++)assert.ok(Math.abs(actual[j]-expected[j])<2e-5,`vertex ${i}.${j}: ${actual[j]} vs ${expected[j]}`);
    });
  }else{
    // Local billboard quad: Unity vertex with UV (u,v) is corner (u-0.5, v-0.5) in the particle frame.
    const uv=[[0,1],[1,1],[1,0],[0,0]];
    c.vertices.forEach((v,i)=>{
      const actual=rotate(q,[uv[i][0]-.5,uv[i][1]-.5,0]),expected=[v[0],v[1],-v[2]];
      for(let j=0;j<3;j++)assert.ok(Math.abs(actual[j]-expected[j])<2e-5,`corner ${i}.${j}: ${actual[j]} vs ${expected[j]}`);
    });
  }
});
test('angular velocity curve is sampled at the start-of-step age (native 175.5, not 184.5 deg)',()=>{
  const row=native.timing.rows.find(r=>r.steps===40);
  assert.ok(Math.abs(row.rotation3DZ-native.timing.startOfStep40)<1e-3);
  const ramp={evaluate:age=>360*D*age};
  const {p}=simulate({renderMode:'Mesh',separateAxes:false,startRotation3D:[0,0,0],lifetime:row.lifetime,steps:row.steps,dt:row.dt},{x:constant(0),y:constant(0),z:ramp});
  // Unity stores rotation3D as float32; the end-of-step age would give 184.5.
  assert.ok(Math.abs(p.startEuler.z/D-row.rotation3DZ)<1e-3,`${p.startEuler.z/D}`);
});
test('one random draw is shared by X/Y/Z, as in native TwoConstants samples',()=>{
  for(const s of native.sharedRandom.rotation3D)assert.ok(Math.abs(s[0]-s[1])<1e-3&&Math.abs(s[1]-s[2])<1e-3);
  const draws=[];const spy=()=>({evaluate:(age,random)=>{draws.push(random);return 0;}});
  const system={rotationOvertimeModule:{separateAxes:true,x:spy(),y:spy(),z:spy()}};
  installUnityParticleEulerRotation(system);
  system.rotationOvertimeModule.animate({startLifetime:1,remainingLifetime:.5,randomSeed:77,startEuler:vec(),rotation:vec()},.02);
  assert.equal(draws.length,3);assert.ok(draws.every(v=>v===draws[0]&&v>=0&&v<1));
});
test('non-separate mode integrates Z only, and install is idempotent',()=>{
  const x={evaluate:()=>{throw new Error('X must not be sampled without separateAxes');}};
  const rotation={separateAxes:false,x,y:x,z:constant(1)};const system={rotationOvertimeModule:rotation};
  installUnityParticleEulerRotation(system);const animate=rotation.animate;
  installUnityParticleEulerRotation(system);assert.equal(rotation.animate,animate);
  const p={startLifetime:2,remainingLifetime:1,randomSeed:1,startEuler:vec(.3,.4,.5),rotation:vec()};
  rotation.animate(p,.1);assert.deepEqual([p.startEuler.x,p.startEuler.y],[.3,.4]);assert.ok(Math.abs(p.startEuler.z-.6)<1e-12);
  assert.equal(installUnityParticleEulerRotation({}),false);
});
test('packing keeps w non-negative for the Cocos vertex ABI',()=>{
  for(const e of [[0,0,0],[3,0,0],[3.1,2.9,-3],[-2.5,1.7,3.14],[6,6,6]]){
    const out=vec();packUnityEulerRotation(out,...e);
    const q=unpack(out);assert.ok(q[3]>=0&&out.x<=1);
    // Compare with an explicit Y*X*Z product (Unity Quaternion.Euler).
    const probe=[.3,-.2,.9];
    const mul=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
    const axis=(i,a)=>{const r=[0,0,0,Math.cos(a/2)];r[i]=Math.sin(a/2);return r;};
    const ref=mul(mul(axis(1,e[1]),axis(0,e[0])),axis(2,e[2]));
    const a=rotate(q,probe),b=rotate(ref,probe);for(let j=0;j<3;j++)assert.ok(Math.abs(a[j]-b[j])<1e-9);
  }
});

const {attachEulerRotationRuntime,stageEulerRotationRuntime,eulerRotationRequired}=require('./particle-euler-rotation-binding');
function graph(contract,enabled){
  const objects=[{__type__:'cc.Node',_name:'Glow'},{__type__:'cc.ParticleSystem',node:{__id__:0},_rotationOvertimeModule:{__id__:2}},{_enable:enabled}];
  Object.defineProperty(objects[1],'unityRendererContract',{value:contract});
  return objects;
}
const {particleRendererContract}=require('./particle-renderer-contract');
const withRotation={RotationModule:{enabled:1}};
test('binding attaches the adapter only to Mesh/Local-billboard renderers with rotation over lifetime',()=>{
  for(const [renderer,enabled,expected] of [
    [{m_RenderMode:4,m_RenderAlignment:2},true,true],[{m_RenderMode:0,m_RenderAlignment:2},true,true],
    [{m_RenderMode:0,m_RenderAlignment:0},true,false],[{m_RenderMode:1},true,false],[{m_RenderMode:4,m_RenderAlignment:2},false,false]]){
    const objects=graph(particleRendererContract(withRotation,renderer),enabled),issues=[],bound=[];
    assert.equal(eulerRotationRequired(objects[1],objects),expected);
    const builder={objects,cocosDb:{findScriptClass:()=>({classId:'euler-rotation-id'})},addComponent(node,type,props){bound.push({node,type,...props});}};
    attachEulerRotationRuntime(builder,{high:code=>issues.push(code),low(){}},{dryRun:true,cocosRoot:path.join(__dirname,'fixtures/not-a-cocos-project')});
    assert.equal(bound.length,expected?1:0);assert.deepEqual(issues,[]);
    if(expected){assert.equal(bound[0].type,'euler-rotation-id');assert.deepEqual(bound[0].source,{__id__:1});
      assert.deepEqual(JSON.parse(bound[0].sourceContract).eulerSigns,renderer.m_RenderMode===4?[-1,-1,1]:[1,1,-1]);}
  }
});
test('unimported adapter is a high obligation instead of an invented UUID',()=>{
  const objects=graph(particleRendererContract(withRotation,{m_RenderMode:4,m_RenderAlignment:2}),true),issues=[],bound=[];
  attachEulerRotationRuntime({objects,cocosDb:{findScriptClass:()=>null},addComponent(){bound.push(1);}},{high:(code,a,b,message)=>issues.push({code,message}),low(){}},{dryRun:true,cocosRoot:path.join(__dirname,'fixtures/not-a-cocos-project')});
  assert.equal(bound.length,0);assert.equal(issues[0].code,'PARTICLE_EULER_ROTATION_ADAPTER_REQUIRED');assert.match(issues[0].message,/AssetDB/);
});
test('porter hands Euler rotation to the binding instead of a generic alignment high',()=>{
  const createParticlePorter=require('./particle-porter');
  const reports=[];const reporter=Object.fromEntries(['high','medium','low'].map(level=>[level,(...args)=>reports.push({level,args})]));
  const objects=[{__type__:'cc.Node',_name:'VerticalGlow'},{__type__:'cc.ParticleSystem',node:{__id__:0},renderer:{__id__:3},_rotationOvertimeModule:{__id__:2},_textureAnimationModule:{__id__:4}},
    {_enable:false,x:{__id__:5},y:{__id__:6},z:{__id__:7}},{},{_enable:false},{},{},{}];
  const builder={objects,addParticleSystemFromTemplate:()=>1,cocosDb:{findScriptClass:()=>({classId:'euler-rotation-id'})},addComponent(node,type,props){objects.push({__type__:type,...props});}};
  const doc='ParticleSystem:\n  RotationModule:\n    enabled: 1\n    separateAxes: 1\n    y:\n      minMaxState: 0\n      scalar: 1.0471976';
  const renderer='ParticleSystemRenderer:\n  m_RenderMode: 4\n  m_RenderAlignment: 2';
  createParticlePorter().emitParticleSystem(0,1,doc,{name:'VerticalGlow'},builder,reporter,{},new Map(),{},renderer);
  assert.ok(!reports.some(r=>r.args[0]==='PARTICLE_RENDER_ALIGNMENT_ADAPTER_REQUIRED'),JSON.stringify(reports));
  assert.equal(objects[2]._enable,true);assert.equal(objects[6].constant,-1.0471976);
  attachEulerRotationRuntime(builder,reporter,{dryRun:true,cocosRoot:path.join(__dirname,'fixtures/not-a-cocos-project')});
  assert.equal(objects.at(-1).__type__,'euler-rotation-id');
  assert.ok(reports.some(r=>r.level==='low'&&r.args[0]==='PARTICLE_EULER_ROTATION_ADAPTER_BOUND'));
  const cli=fs.readFileSync(path.join(__dirname,'../unity-cocos-port.cjs'),'utf8');
  assert.match(cli,/attachEulerRotationRuntime\(builder, reporter, options\)/);
});
test('staging is idempotent and leaves metadata to AssetDB',()=>{
  const base=path.resolve(__dirname,'../../.ai/euler-rotation-tests');fs.mkdirSync(base,{recursive:true});
  const root=fs.mkdtempSync(path.join(base,'project-'));
  try{
    stageEulerRotationRuntime({cocosRoot:root,dryRun:true});assert.equal(fs.existsSync(path.join(root,'assets')),false);
    stageEulerRotationRuntime({cocosRoot:root});
    const target=path.join(root,'assets/script/UnityParticleEulerRotationAdapter.ts');
    const before=fs.statSync(target).mtimeMs;stageEulerRotationRuntime({cocosRoot:root});
    assert.equal(fs.statSync(target).mtimeMs,before);assert.equal(fs.existsSync(target+'.meta'),false);
    for(const name of ['UnityParticleEulerRotation','UnityParticleEulerRotationAdapter'])
      assert.equal(fs.readFileSync(path.join(root,'assets/script',name+'.ts'),'utf8'),fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'));
  }finally{
    assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(base));fs.rmSync(root,{recursive:true});
  }
});
