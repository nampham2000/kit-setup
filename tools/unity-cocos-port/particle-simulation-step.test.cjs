'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'runtime/UnityParticleSimulationStep.ts'),'utf8');
const moduleStub={exports:{}};
const birthStub={exports:{}};
new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleBirthTiming.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(birthStub.exports,birthStub,()=>({}));
new Function('exports','module','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(moduleStub.exports,moduleStub,()=>birthStub.exports);
const install=moduleStub.exports.installUnityParticleSimulationStep;
function engine(duration=.1,delay=0){return {duration,loop:false,_isEmitting:true,_isPlaying:true,_time:0,startDelay:{evaluate:()=>delay},emitted:0,steps:[],
  _emit(dt){if(this._time>delay){if(this._time-(this.duration+delay)>dt&&!this.loop)this._isEmitting=false;
    if(this._isEmitting)this.emitted+=2000*dt;}},
  update(dt){this.steps.push(dt);this._time+=dt;this._emit(dt);}};}
test('250ms render frame does not emit 500 particles from a 100ms source window',()=>{
  const original=engine();original.update(.25);assert.equal(original.emitted,500);
  const patched=engine();install(patched,.03);patched.update(.25);
  assert.ok(Math.abs(patched.emitted-180)<1e-4);assert.ok(Math.abs(patched._time-.25)<1e-8);
  assert.ok(patched.steps.every(dt=>dt<=.03));assert.equal(patched._isEmitting,false);
});
test('partial first step and excluded terminal step respect native start delay and duration',()=>{
  const system=engine(.1,.05);install(system,.03);system.update(.27);
  assert.ok(Math.abs(system.emitted-140)<1e-4);assert.ok(Math.abs(system._time-.27)<1e-8);
});
const nativeWindow=require('./fixtures/emission-window-native.json');
test('short-window native fixture binds exact probe source',()=>{
  const producer=fs.readFileSync(path.join(__dirname,'fixtures/capture-emission-window.cs'),'utf8').replace(/\r\n/g,'\n');
  assert.equal(require('node:crypto').createHash('sha256').update(producer).digest('hex'),nativeWindow.producerSha256);
  assert.equal(nativeWindow.rows.length,54);
});
for(const row of nativeWindow.rows)test(`native emission window duration=${row.duration} delay=${row.delay} rate=${row.rate} step=${row.step}`,()=>{
  const system=engine(Math.fround(row.duration),Math.fround(row.delay));let emissionClock=0,dispatched=false;
  system._emit=function(dt){if(!this._isEmitting)return;dispatched=true;emissionClock=Math.fround(emissionClock+Math.fround(dt));this.emitted=Math.floor(emissionClock/Math.fround(1/row.rate));};
  install(system,1);
  const lastBirth=row.frames.reduce((last,f,i)=>f.count>(row.frames[i-1]?.count||0)?f.frame:last,-1);
  for(const frame of row.frames){
    // Lifetime expiry belongs to the processor, not this emission adapter.
    if(frame.frame*Math.fround(row.step)>row.delay+1)break;
    dispatched=false;system.update(Math.fround(row.step));
    if(frame.frame>lastBirth)assert.equal(dispatched,false,`terminal emission at frame ${frame.frame}`);
    // Counter quantization is a separate known +/-1 birth-kernel limitation.
    // The terminal-step check above is exact and rejects an extra whole batch.
    assert.ok(Math.abs(system.emitted-frame.count)<=1,`frame ${frame.frame}: ${system.emitted} vs ${frame.count}`);
  }
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
