'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {attachNoiseRuntime,stageNoiseRuntime}=require('./particle-noise-binding');
const {LIMIT_VELOCITY_COMPOSITION}=require('./particle-limit-velocity-binding');
const constant=scalar=>({minMaxState:0,scalar});
const spec=()=>({enabled:true,quality:1,remapEnabled:false,strength:constant(.5),strengthY:constant(.5),strengthZ:constant(.5),scrollSpeed:constant(1),positionAmount:constant(1),rotationAmount:constant(0),sizeAmount:constant(0)});
function run(contract,limit=false,imported=true,renderer={mode:0,localBillboard:false,eulerSigns:[-1,1,-1]},rotationOverLifetime=false){
  const objects=[{__type__:'cc.Node',_name:'UnrelatedEffect'}, {__type__:'cc.ParticleSystem',node:{__id__:0},_limitVelocityOvertimeModule:{__id__:2},_rotationOvertimeModule:{__id__:3},unityNoiseContract:contract,unityRendererContract:renderer},{_enable:limit},{_enable:rotationOverLifetime}];
  const issues=[];
  const builder={objects,cocosDb:{findScriptClass:()=>imported?{classId:'assetdb-noise-id'}:null},addComponent(node,type,props){objects.push({__type__:type,...props});}};
  attachNoiseRuntime(builder,{high:(code,a,b,message)=>issues.push({code,message}),low(){}},{dryRun:true,cocosRoot:path.join(__dirname,'fixtures/not-a-cocos-project')});
  return {objects,issues};
}
test('generic prefab porter binds native Noise without any AOE controller or tool',()=>{
  const source=spec(),result=run(source);
  assert.deepEqual(result.issues,[]);
  assert.equal(result.objects.length,5);
  assert.equal(result.objects[4].__type__,'assetdb-noise-id');
  assert.deepEqual(result.objects[4].source,{__id__:1});
  assert.deepEqual(JSON.parse(result.objects[4].sourceContract),source);
  const cli=fs.readFileSync(path.join(__dirname,'../unity-cocos-port.cjs'),'utf8');
  assert.match(cli,/attachNoiseRuntime\(builder, reporter, options\)/);
});
for(const [name,mutate,limit,renderer,rotation] of [
  ['unknown quality',s=>s.quality=3,false],['remap',s=>s.remapEnabled=true,false],
  ['random curve',s=>s.strength.minMaxState=3,false],['size amount',s=>s.sizeAmount.scalar=1,false],
  ['weighted curve',s=>s.strength.maxCurve={m_Curve:[{weightedMode:1}]},false],
  ['random rotation amount',s=>s.rotationAmount={minMaxState:3,scalar:5,minScalar:0},false],
  ['rotation amount with builtin rotation over lifetime',s=>s.rotationAmount=constant(5),false,{mode:0,localBillboard:false,eulerSigns:[-1,1,-1]},true],
  ['rotation amount without renderer signs',s=>s.rotationAmount=constant(5),false,{mode:4}],
])test(`${name} cannot silently pass as native Noise`,()=>{
  const source=spec();mutate(source);const result=run(source,limit,true,renderer,rotation);
  assert.equal(result.objects.length,4);assert.equal(result.issues[0].code,'PARTICLE_NOISE_ADAPTER_REQUIRED');
});
for(const quality of [0,1,2])test(`quality ${quality} binds the native validated Noise kernel`,()=>{
  const source={...spec(),quality},result=run(source);
  assert.deepEqual(result.issues,[]);assert.equal(result.objects.length,5);
  assert.equal(JSON.parse(result.objects[4].sourceContract).quality,quality);
});
test('rotation amount binds with the renderer Euler signs (Mesh with rotation over lifetime)',()=>{
  const source={...spec(),rotationAmount:{minMaxState:1,scalar:5,maxCurve:{m_Curve:[{time:0,value:0,inSlope:0,outSlope:0},{time:1,value:1,inSlope:0,outSlope:0}]}}};
  const result=run(source,false,true,{mode:4,localBillboard:false,eulerSigns:[-1,-1,1]},true);
  assert.deepEqual(result.issues,[]);assert.deepEqual(JSON.parse(result.objects[4].sourceContract).rotationSigns,[-1,-1,1]);
});
test('a velocity limit binds only with the measured limit composition runtime',()=>{
  const result=run(spec(),true);
  if(LIMIT_VELOCITY_COMPOSITION==='animated-velocity-before-limit'){assert.deepEqual(result.issues,[]);assert.equal(result.objects.length,5);}
  else{assert.equal(result.issues[0].code,'PARTICLE_NOISE_ADAPTER_REQUIRED');assert.match(result.issues[0].message,/velocity-limit-integration/);}
});
test('unimported script blocks binding instead of inventing meta UUID',()=>{
  const result=run(spec(),false,false);
  assert.match(result.issues[0].message,/AssetDB/);assert.equal(result.objects.length,4);
});
test('staging is idempotent and leaves metadata to AssetDB',()=>{
  const base=path.resolve(__dirname,'../../../.ai/noise-binding-tests');fs.mkdirSync(base,{recursive:true});
  const root=fs.mkdtempSync(path.join(base,'project-'));
  try{
    stageNoiseRuntime({cocosRoot:root});
    const target=path.join(root,'assets/script/UnityParticleNoiseAdapter.ts');
    const before=fs.statSync(target).mtimeMs;stageNoiseRuntime({cocosRoot:root});
    assert.equal(fs.statSync(target).mtimeMs,before);assert.equal(fs.existsSync(target+'.meta'),false);
    for(const name of ['UnityNoiseKernel','UnityParticleLimitVelocity','UnityParticleNoise','UnityParticleNoiseAdapter'])assert.equal(fs.readFileSync(path.join(root,'assets/script',name+'.ts'),'utf8'),fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'));
  }finally{
    assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(base));fs.rmSync(root,{recursive:true});
  }
});
