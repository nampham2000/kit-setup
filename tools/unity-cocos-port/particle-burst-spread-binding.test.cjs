'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const m={exports:{}};
new Function('exports','module',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleBurstEmission.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m.exports,m);
const {installUnityParticleBurstSpread}=m.exports;
const {attachBurstSpreadRuntime}=require('./particle-burst-spread-binding');
for(const sample of require('./fixtures/burst-spread.json'))test(`spread-only install matches Unity count=${sample.count}, arc=${sample.arc}`,()=>{
  const shape={arcMode:3,_arc:sample.arc*Math.PI/180,arcSpread:0,generateArcAngle(){throw new Error('Stock Cocos arc cannot distribute a burst');}};
  const update=()=>{},burst={update};
  let positions=[];
  const ps={shapeModule:shape,bursts:[burst],emit(n){for(let i=0;i<n;i++){const a=shape.generateArcAngle();positions.push([2*Math.cos(a),2*Math.sin(a),0]);}}};
  installUnityParticleBurstSpread(ps);installUnityParticleBurstSpread(ps);
  assert.equal(burst.update,update,'burst catch-up stays a conditional fix');
  for(let replay=0;replay<2;replay++){
    positions=[];ps.emit(sample.count,0);
    for(let i=0;i<sample.count;i++)for(let axis=0;axis<3;axis++)assert.ok(Math.abs(positions[i][axis]-sample.positions[i][axis])<1e-6,`particle ${i} axis ${axis}`);
  }
});
test('LevelUp GlowBlast burst of 15 spreads 24 degrees apart instead of one stock angle',()=>{
  const shape={arcMode:3,_arc:Math.PI*2,arcSpread:0,generateArcAngle(){return 0.1;}};
  const angles=[],ps={shapeModule:shape,bursts:[],emit(n){for(let i=0;i<n;i++)angles.push(shape.generateArcAngle());}};
  installUnityParticleBurstSpread(ps);ps.emit(15,0);
  assert.deepEqual(angles.map(a=>Math.round(a*180/Math.PI)),Array.from({length:15},(_,i)=>i*24));
});
function builderFor(arcMode,imported,rate=0){
  const objects=[{__type__:'cc.Node',_name:'GlowBlast'},{__type__:'cc.ParticleSystem',node:{__id__:0},_shapeModule:{__id__:2},rateOverTime:{__id__:3}},{arcMode,_enable:true},{mode:0,constant:rate}];
  return {objects,cocosDb:{findScriptClass:()=>imported?{classId:'registered'}:null},addComponent(node,type,props){objects.push({node,type,...props});}};
}
test('porter binds arc mode 3 emitters and reports missing AssetDB registration',()=>{
  for(const imported of [true,false])for(const arcMode of [3,0]){
    const builder=builderFor(arcMode,imported),issues=[];
    attachBurstSpreadRuntime(builder,{high:code=>issues.push(code),medium:code=>issues.push(code),low(){}},{dryRun:true,cocosRoot:path.join(__dirname,'fixtures/no-project')});
    const bound=arcMode===3&&imported;
    assert.equal(builder.objects.length,bound?5:4);
    assert.deepEqual(issues,arcMode===3&&!imported?['PARTICLE_BURST_SPREAD_ADAPTER_REQUIRED']:[]);
    if(bound)assert.deepEqual(builder.objects[4].source,{__id__:1});
  }
});
test('Burst Spread with rate emission is bound but flagged as unmeasured',()=>{
  const builder=builderFor(3,true,10),issues=[];
  attachBurstSpreadRuntime(builder,{high:code=>issues.push(code),medium:code=>issues.push(code),low(){}},{dryRun:true,cocosRoot:path.join(__dirname,'fixtures/no-project')});
  assert.deepEqual(issues,['PARTICLE_BURST_SPREAD_RATE_UNMEASURED']);
});
