'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {attachNoiseRuntime,stageNoiseRuntime}=require('./particle-noise-binding');
const constant=scalar=>({minMaxState:0,scalar});
const spec=()=>({enabled:true,quality:1,remapEnabled:false,strength:constant(.5),strengthY:constant(.5),strengthZ:constant(.5),scrollSpeed:constant(1),positionAmount:constant(1),rotationAmount:constant(0),sizeAmount:constant(0)});
function run(contract,limit=false,imported=true){
  const objects=[{__type__:'cc.Node',_name:'UnrelatedEffect'}, {__type__:'cc.ParticleSystem',node:{__id__:0},_limitVelocityOvertimeModule:{__id__:2},unityNoiseContract:contract},{_enable:limit}];
  const issues=[];
  const builder={objects,cocosDb:{findScriptClass:()=>imported?{classId:'assetdb-noise-id'}:null},addComponent(node,type,props){objects.push({__type__:type,...props});}};
  attachNoiseRuntime(builder,{high:(code,a,b,message)=>issues.push({code,message}),low(){}},{dryRun:true,cocosRoot:path.join(__dirname,'fixtures/not-a-cocos-project')});
  return {objects,issues};
}
test('generic prefab porter binds native Noise without any AOE controller or tool',()=>{
  const source=spec(),result=run(source);
  assert.deepEqual(result.issues,[]);
  assert.equal(result.objects.length,4);
  assert.equal(result.objects[3].__type__,'assetdb-noise-id');
  assert.deepEqual(result.objects[3].source,{__id__:1});
  assert.deepEqual(JSON.parse(result.objects[3].sourceContract),source);
  const cli=fs.readFileSync(path.join(__dirname,'../unity-cocos-port.cjs'),'utf8');
  assert.match(cli,/attachNoiseRuntime\(builder, reporter, options\)/);
});
for(const [name,mutate,limit] of [
  ['High',s=>s.quality=2,false],['Low',s=>s.quality=0,false],['remap',s=>s.remapEnabled=true,false],
  ['random curve',s=>s.strength.minMaxState=3,false],['size amount',s=>s.sizeAmount.scalar=1,false],
  ['weighted curve',s=>s.strength.maxCurve={m_Curve:[{weightedMode:1}]},false],['velocity limit',()=>{},true],
])test(`${name} cannot silently pass as native Noise`,()=>{
  const source=spec();mutate(source);const result=run(source,limit);
  assert.equal(result.objects.length,3);assert.equal(result.issues[0].code,'PARTICLE_NOISE_ADAPTER_REQUIRED');
});
test('unimported script blocks binding instead of inventing meta UUID',()=>{
  const result=run(spec(),false,false);
  assert.match(result.issues[0].message,/AssetDB/);assert.equal(result.objects.length,3);
});
test('staging is idempotent and leaves metadata to AssetDB',()=>{
  const base=path.resolve(__dirname,'../../../.ai/noise-binding-tests');fs.mkdirSync(base,{recursive:true});
  const root=fs.mkdtempSync(path.join(base,'project-'));
  try{
    stageNoiseRuntime({cocosRoot:root});
    const target=path.join(root,'assets/script/UnityParticleNoiseAdapter.ts');
    const before=fs.statSync(target).mtimeMs;stageNoiseRuntime({cocosRoot:root});
    assert.equal(fs.statSync(target).mtimeMs,before);assert.equal(fs.existsSync(target+'.meta'),false);
    for(const name of ['UnityNoiseKernel','UnityParticleNoise','UnityParticleNoiseAdapter'])assert.equal(fs.readFileSync(path.join(root,'assets/script',name+'.ts'),'utf8'),fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'));
  }finally{
    assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(base));fs.rmSync(root,{recursive:true});
  }
});
