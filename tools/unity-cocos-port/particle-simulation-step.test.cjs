'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'runtime/UnityParticleSimulationStep.ts'),'utf8');
const moduleStub={exports:{}};
new Function('exports','module',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(moduleStub.exports,moduleStub);
const install=moduleStub.exports.installUnityParticleSimulationStep;
function engine(duration=.1,delay=0){return {duration,loop:false,_isEmitting:true,_isPlaying:true,_time:0,startDelay:{evaluate:()=>delay},emitted:0,steps:[],
  _emit(dt){if(this._time>delay){if(this._time-(this.duration+delay)>dt&&!this.loop)this._isEmitting=false;
    if(this._isEmitting)this.emitted+=2000*dt;}},
  update(dt){this.steps.push(dt);this._time+=dt;this._emit(dt);}};}
test('250ms render frame does not emit 500 particles from a 100ms source window',()=>{
  const original=engine();original.update(.25);assert.equal(original.emitted,500);
  const patched=engine();install(patched,.03);patched.update(.25);
  assert.ok(Math.abs(patched.emitted-200)<1e-8);assert.ok(Math.abs(patched._time-.25)<1e-8);
  assert.ok(patched.steps.every(dt=>dt<=.03));assert.equal(patched._isEmitting,false);
});
test('partial first/last steps respect source start delay and duration',()=>{
  const system=engine(.1,.05);install(system,.03);system.update(.27);
  assert.ok(Math.abs(system.emitted-200)<1e-8);assert.ok(Math.abs(system._time-.27)<1e-8);
});
test('installation is idempotent and rejects an invalid source timestep',()=>{
  const system=engine();install(system,.03);const update=system.update;install(system,.03);assert.equal(system.update,update);
  assert.throws(()=>install(engine(),0),/maximumParticleDeltaTime/);
});

const {maximumParticleDeltaTime,attachSimulationStepRuntime}=require('./particle-simulation-step-binding');
test('porter binds the real project timestep and reports missing source/AssetDB registration',()=>{
  const base=path.resolve(__dirname,'../../.ai/simulation-step-tests');fs.mkdirSync(base,{recursive:true});
  const root=fs.mkdtempSync(path.join(base,'project-'));
  try {
    assert.equal(maximumParticleDeltaTime(root),null);
    fs.mkdirSync(path.join(root,'ProjectSettings'));fs.writeFileSync(path.join(root,'ProjectSettings/TimeManager.asset'),'TimeManager:\n  Maximum Particle Timestep: 0.017\n');
    assert.equal(maximumParticleDeltaTime(root),.017);
    for(const imported of [false,true]) {
      const calls=[],issues=[],builder={objects:[{__type__:'cc.Node',_name:'emitter'},{__type__:'cc.ParticleSystem',node:{__id__:0}}],
        cocosDb:{findScriptClass:()=>imported?{classId:'actual-assetdb-class'}:null},addComponent:(...args)=>calls.push(args)};
      attachSimulationStepRuntime(builder,{high:code=>issues.push(code)},{unityRoot:root,cocosRoot:root});
      assert.deepEqual(issues,imported?[]:['PARTICLE_TIMESTEP_ADAPTER_REQUIRED']);
      if(imported)assert.deepEqual(calls[0].slice(0,3),[0,'actual-assetdb-class',{source:{__id__:1},maximumDeltaTime:.017}]);
      assert.equal(fs.existsSync(path.join(root,'assets/script/UnityParticleSimulationStepAdapter.ts.meta')),false);
    }
    assert.match(fs.readFileSync(path.join(__dirname,'../unity-cocos-port.cjs'),'utf8'),/attachSimulationStepRuntime\(builder, reporter, options\)/);
  }finally{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(base));fs.rmSync(root,{recursive:true});}
});
