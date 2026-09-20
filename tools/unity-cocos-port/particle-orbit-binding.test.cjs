'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {attachOrbitRuntime,stageOrbitRuntime}=require('./particle-orbit-binding');
const constant=scalar=>({minMaxState:0,scalar});
const spec=()=>({enabled:true,simulationSpace:0,inWorldSpace:false,limitEnabled:false,velocity:{orbitalOffsetX:constant(0),orbitalOffsetY:constant(0),orbitalOffsetZ:constant(0),orbitalX:constant(0),orbitalY:constant(3),orbitalZ:constant(0),radial:constant(0)}});
function run(contract,limit=false,imported=true){
  const objects=[{__type__:'cc.Node',_name:'UnrelatedEffect'}, {__type__:'cc.ParticleSystem',node:{__id__:0},_limitVelocityOvertimeModule:{__id__:2},unityOrbitContract:contract},{_enable:limit}];
  const issues=[];
  const builder={objects,cocosDb:{findScriptClass:()=>imported?{classId:'assetdb-orbit-id'}:null},addComponent(node,type,props){objects.push({__type__:type,...props});}};
  attachOrbitRuntime(builder,{high:(code,a,b,message)=>issues.push({code,message}),low(){}},{dryRun:true,cocosRoot:path.join(__dirname,'fixtures/not-a-cocos-project')});
  return {objects,issues};
}
test('generic prefab porter binds native Orbit without any AOE controller or tool',()=>{
  const source=spec(),result=run(source);
  assert.deepEqual(result.issues,[]);
  assert.equal(result.objects.length,4);
  assert.equal(result.objects[3].__type__,'assetdb-orbit-id');
  assert.deepEqual(result.objects[3].source,{__id__:1});
  assert.deepEqual(JSON.parse(result.objects[3].sourceContract),source);
  const cli=fs.readFileSync(path.join(__dirname,'../unity-cocos-port.cjs'),'utf8');
  assert.match(cli,/attachOrbitRuntime\(builder, reporter, options\)/);
});
for(const [name,mutate,limit] of [
 ['world space',s=>s.inWorldSpace=true,false],['custom simulation',s=>s.simulationSpace=2,false],['noise composition',s=>s.noiseEnabled=true,false],['offset',s=>s.velocity.orbitalOffsetX.scalar=1,false],['weighted curve',s=>s.velocity.orbitalY.maxCurve={m_Curve:[{weightedMode:1}]},false],['limit',s=>s.limitEnabled=true,true],
])test(`${name} cannot silently pass as native Orbit`,()=>{
  const source=spec();mutate(source);const result=run(source,limit);
  assert.equal(result.objects.length,3);assert.equal(result.issues[0].code,'PARTICLE_ORBIT_ADAPTER_REQUIRED');
});
test('unimported script blocks binding instead of inventing meta UUID',()=>{
  const result=run(spec(),false,false);
  assert.match(result.issues[0].message,/AssetDB/);assert.equal(result.objects.length,3);
});
test('staging is idempotent and leaves metadata to AssetDB',()=>{
  const base=path.resolve(__dirname,'../../../.ai/orbit-binding-tests');fs.mkdirSync(base,{recursive:true});
  const root=fs.mkdtempSync(path.join(base,'project-'));
  try{
    stageOrbitRuntime({cocosRoot:root});
    const target=path.join(root,'assets/script/UnityParticleOrbitAdapter.ts');
    const before=fs.statSync(target).mtimeMs;stageOrbitRuntime({cocosRoot:root});
    assert.equal(fs.statSync(target).mtimeMs,before);assert.equal(fs.existsSync(target+'.meta'),false);
    for(const name of ['UnityNoiseKernel','UnityParticleOrbit','UnityParticleOrbitAdapter'])assert.equal(fs.readFileSync(path.join(root,'assets/script',name+'.ts'),'utf8'),fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'));
  }finally{
    assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(base));fs.rmSync(root,{recursive:true});
  }
});
