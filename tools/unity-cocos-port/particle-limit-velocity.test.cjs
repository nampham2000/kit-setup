'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function compile(name,deps={}){const m={exports:{}};new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m.exports,m,k=>deps[k]||{});return m.exports;}
const kernel=compile('UnityNoiseKernel');
const {installUnityParticleLimitVelocity,unityDampenKeep,unityDragSpeed}=compile('UnityParticleLimitVelocity',{'./UnityNoiseKernel':kernel});
const dragNative=require('./fixtures/limit-drag-native.json');
const {attachLimitVelocityRuntime}=require('./particle-limit-velocity-binding');
const {applyUnityParticleDataToCocos}=require('./particle-system-converter');
const native=require('./fixtures/limit-velocity-native.json');
// Stock Cocos 3.8.8 cocos/particle/animator/limit-velocity-overtime.ts for constant limits.
function dampenBeyondLimit(vel,limit,dampen){const sign=Math.sign(vel);let abs=Math.abs(vel);if(abs>limit){const give=abs-abs*dampen;abs=give>limit?give:limit;}return abs*sign;}
function cocosModule(sample){
  return {dampen:sample.dampen,separateAxes:sample.separateAxes,animate(p){
    const u=p.ultimateVelocity;let x,y,z;
    if(this.separateAxes){x=dampenBeyondLimit(u.x,sample.limit[0],this.dampen);y=dampenBeyondLimit(u.y,sample.limit[1],this.dampen);z=dampenBeyondLimit(u.z,sample.limit[2],this.dampen);}
    else{const length=Math.hypot(u.x,u.y,u.z),s=length>0?dampenBeyondLimit(length,sample.limit[0],this.dampen)/length:0;x=u.x*s;y=u.y*s;z=u.z*s;}
    u.x=x;u.y=y;u.z=z;p.velocity.x=x;p.velocity.y=y;p.velocity.z=z;
  }};
}
// Mirrors the CPU processor: ultimateVelocity restarts from velocity, then modules animate.
function run(sample,unity){
  const module=cocosModule(sample);
  if(unity)installUnityParticleLimitVelocity({limitVelocityOvertimeModule:module});
  const [x,y,z]=sample.startVelocity,p={velocity:{x,y,z},ultimateVelocity:{x:0,y:0,z:0},animatedVelocity:{x:0,y:0,z:0}};
  return sample.velocity.map(()=>{
    Object.assign(p.ultimateVelocity,p.velocity);module.animate(p,sample.dt);
    assert.equal(module.dampen,sample.dampen,'the engine dampen is restored after each step');
    return [p.velocity.x,p.velocity.y,p.velocity.z];
  });
}
for(const sample of native)test(`native Limit Velocity: ${sample.case}`,()=>{
  const got=run(sample,true);
  sample.velocity.forEach((velocity,step)=>velocity.forEach((value,axis)=>assert.ok(Math.abs(got[step][axis]-value)<2e-4,`step ${step} axis ${axis}: ${got[step][axis]} vs ${value}`)));
});
test('Unity dampen is frame-rate independent; stock Cocos halves the Spikes spread at 60 fps',()=>{
  const at60=native.find(s=>s.case==='spikes-magnitude-60fps'),at30=native.find(s=>s.case==='spikes-magnitude-30fps');
  assert.ok(Math.abs(run(at60,true).at(-1)[0]-run(at30,true).at(-1)[0])<1e-3,'same simulated time, same Unity speed');
  assert.ok(Math.abs(run(at60,false).at(-1)[0]-run(at30,false).at(-1)[0])>1,'stock Cocos speed depends on the frame rate');
  const stock=run(at60,false).at(-1)[0],unity=at60.velocity.at(-1)[0];
  assert.ok(stock<unity/2,`stock ${stock} vs Unity ${unity}`);
  assert.equal(unityDampenKeep(1,1/60),0);assert.equal(unityDampenKeep(0,1/60),1);
});
test('converter maps Unity separateAxis and keeps drag/speed modifier for the binding',()=>{
  const builder={objects:[{},{_limitVelocityOvertimeModule:{__id__:2}},{}]};
  applyUnityParticleDataToCocos(builder,1,{ClampVelocityModule:{enabled:1,separateAxis:1,dampen:0.15,drag:{minMaxState:0,scalar:0.5}},NoiseModule:{enabled:1}});
  assert.equal(builder.objects[2].separateAxes,true);
  assert.deepEqual(builder.objects[1].unityLimitVelocityContract,{enabled:true,separateAxes:true,dampen:0.15,drag:{minMaxState:0,scalar:0.5},multiplyBySize:false,multiplyByVelocity:false,animatedVelocity:true,speedModifier:{minMaxState:0,scalar:1}});
});
test('porter binds enabled limits, keeps drag honest and waits for AssetDB',()=>{
  const drag={drag:{minMaxState:0,scalar:0.5},multiplyBySize:true,multiplyByVelocity:false};
  for(const imported of [true,false])for(const enabled of [true,false]){
    const objects=[{__type__:'cc.Node',_name:'Spikes'},{__type__:'cc.ParticleSystem',node:{__id__:0}}],issues=[];
    Object.defineProperty(objects[1],'unityLimitVelocityContract',{value:{enabled,separateAxes:false,dampen:0.15,...drag,drag:{minMaxState:0,scalar:enabled?0.5:0},animatedVelocity:true,speedModifier:{minMaxState:0,scalar:1}}});
    const builder={objects,cocosDb:{findScriptClass:()=>imported?{classId:'registered'}:null},addComponent(node,type,props){objects.push({node,type,...props});}};
    attachLimitVelocityRuntime(builder,{high:code=>issues.push(code),medium:code=>issues.push(code),low(){}},{dryRun:true,cocosRoot:path.join(__dirname,'fixtures/no-project')});
    assert.equal(objects.length,enabled&&imported?3:2);
    if(!enabled)assert.deepEqual(issues,[]);
    else assert.deepEqual(issues,imported?[]:['PARTICLE_LIMIT_VELOCITY_ADAPTER_REQUIRED']);
    if(objects[2]){assert.deepEqual(objects[2].source,{__id__:1});assert.deepEqual(JSON.parse(objects[2].sourceContract),drag);}
  }
});

// Mirrors the CPU processor for the drag fixture: size is animated before the limit (end-of-step
// age), then the limit/drag module, then position integrates the limited total velocity.
function runDrag(sample){
  const module=cocosModule({dampen:sample.dampen,separateAxes:false,limit:[sample.limit]});
  const drag=sample.dragCurve?{minMaxState:1,scalar:sample.drag,maxCurve:{m_Curve:[{time:0,value:1,inSlope:-1,outSlope:-1},{time:1,value:0,inSlope:-1,outSlope:-1}]}}:{minMaxState:0,scalar:sample.drag};
  installUnityParticleLimitVelocity({limitVelocityOvertimeModule:module},{drag,multiplyBySize:sample.multiplyBySize,multiplyByVelocity:sample.multiplyByVelocity});
  const size=Array.isArray(sample.size)?sample.size:[sample.size,sample.size,sample.size];
  const animated=[sample.animatedVelocityX||0,0,0];
  const [x,y,z]=sample.startVelocity,p={velocity:{x,y,z},ultimateVelocity:{x:0,y:0,z:0},animatedVelocity:{x:animated[0],y:0,z:0},
    size:{x:size[0],y:size[1],z:size[2]},startSize:{x:size[0],y:size[1],z:size[2]},startLifetime:sample.startLifetime,remainingLifetime:sample.startLifetime,randomSeed:1};
  const pos=[0,0,0];
  return sample.velocity.map(()=>{
    p.remainingLifetime-=sample.dt;
    const k=sample.sizeOverLifetime?1-(1-p.remainingLifetime/p.startLifetime):1;
    p.size.x=size[0]*k;p.size.y=size[1]*k;p.size.z=size[2]*k;
    p.ultimateVelocity.x=p.velocity.x+animated[0];p.ultimateVelocity.y=p.velocity.y;p.ultimateVelocity.z=p.velocity.z;
    module.animate(p,sample.dt);
    pos[0]+=p.ultimateVelocity.x*sample.dt;pos[1]+=p.ultimateVelocity.y*sample.dt;pos[2]+=p.ultimateVelocity.z*sample.dt;
    return {velocity:[p.velocity.x,p.velocity.y,p.velocity.z],position:pos.slice()};
  });
}
for(const sample of dragNative)test(`native Limit Velocity drag: ${sample.case}`,()=>{
  const got=runDrag(sample);
  const tolerance=2e-5;
  sample.velocity.forEach((velocity,step)=>velocity.forEach((value,axis)=>assert.ok(Math.abs(got[step].velocity[axis]-value)<tolerance,`step ${step} axis ${axis}: ${got[step].velocity[axis]} vs ${value}`)));
  sample.position.forEach((position,step)=>position.forEach((value,axis)=>assert.ok(Math.abs(got[step].position[axis]-value)<tolerance*10,`position step ${step} axis ${axis}: ${got[step].position[axis]} vs ${value}`)));
});
test('drag speed rule: area, velocity squared, zero clamp',()=>{
  const spec={multiplyBySize:true,multiplyByVelocity:true};
  assert.ok(Math.abs(unityDragSpeed(1.3,4.71,0.45,spec,1/60)-(1.3-4.71*Math.PI*0.225*0.225*1.69/60))<1e-12);
  assert.equal(unityDragSpeed(1,1000,1,{multiplyBySize:false,multiplyByVelocity:false},1/60),0);
});
test('drag fixture binds its producer',()=>{
  const text=fs.readFileSync(path.join(__dirname,'fixtures/capture-limit-drag.cs'),'utf8');
  assert.match(text,/limit-drag-native.json/);
  assert.equal(dragNative.length,20);
});
