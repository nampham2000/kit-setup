'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const m={exports:{}};
new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleBirthState.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m.exports,m,()=>({Mat4:class {}}));
const {installUnityParticleBirthState}=m.exports;
test('late sub-emitter births initialize appearance before render, without stepping simulation',()=>{
  const calls=[];
  const system={processor:{setNewParticle(p){calls.push('born');p.startLifetime=2;}},
    rotationOvertimeModule:{enable:true,animate(p,dt){assert.equal(dt,0);calls.push('rotation');p.rotation=Math.sin(p.euler/2);}},
    sizeOvertimeModule:{enable:true,animate(p,dt){assert.equal(dt,0);calls.push('size');p.size=0;}},
    colorOverLifetimeModule:{enable:true,animate(p){calls.push('color');p.alpha=.5;}}};
  installUnityParticleBirthState(system);const hook=system.processor.setNewParticle;
  installUnityParticleBirthState(system);assert.equal(system.processor.setNewParticle,hook);
  for(const euler of [-5.7483,3.14956,6.2]){
    const p={euler,rotation:euler,size:.3,remainingLifetime:2,startLifetime:2,position:7,velocity:3};
    calls.length=0;system.processor.setNewParticle(p);
    assert.deepEqual(calls,['born','rotation','size','color']);assert.ok(p.rotation*p.rotation<=1);
    assert.equal(p.euler,euler);assert.equal(p.size,0);assert.equal(p.alpha,.5);
    assert.equal(p.position,7);assert.equal(p.velocity,3);assert.equal(p.remainingLifetime,2);
  }
  system.rotationOvertimeModule.enable=false;system.sizeOvertimeModule.enable=false;system.colorOverLifetimeModule.enable=false;
  calls.length=0;system.processor.setNewParticle({});assert.deepEqual(calls,['born']);
});
const {attachBirthStateRuntime}=require('./particle-birth-state-binding');
test('staging preserves unchanged bytes and mtime and never invents AssetDB metadata',()=>{
  const base=path.resolve(__dirname,'../../.ai/birth-state-tests');fs.mkdirSync(base,{recursive:true});
  const root=fs.mkdtempSync(path.join(base,'project-'));
  try{
    const builder={objects:[{__type__:'cc.Node'},{__type__:'cc.ParticleSystem',node:{__id__:0},_sizeOvertimeModule:{__id__:2}},{_enable:true}]};
    const options={cocosRoot:root};const reporter={high(){}};
    attachBirthStateRuntime(builder,reporter,{...options,dryRun:true});assert.equal(fs.existsSync(path.join(root,'assets')),false);
    attachBirthStateRuntime(builder,reporter,options);
    const target=path.join(root,'assets/script/UnityParticleBirthState.ts');const before=fs.statSync(target).mtimeMs;
    attachBirthStateRuntime(builder,reporter,options);assert.equal(fs.statSync(target).mtimeMs,before);
    assert.equal(fs.existsSync(target+'.meta'),false);
    assert.equal(fs.readFileSync(target,'utf8'),fs.readFileSync(path.join(__dirname,'runtime/UnityParticleBirthState.ts'),'utf8'));
  }finally{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(base));fs.rmSync(root,{recursive:true});}
});
test('generic porter binds enabled appearance modules and reports missing AssetDB registration',()=>{
  for(const imported of [true,false])for(const enabled of [true,false]){
    const objects=[{__type__:'cc.Node',_name:'AnyEffect'},{__type__:'cc.ParticleSystem',node:{__id__:0},_rotationOvertimeModule:{__id__:2}},{_enable:enabled}],issues=[];
    const builder={objects,cocosDb:{findScriptClass:()=>imported?{classId:'registered'}:null},addComponent(node,type,props){objects.push({node,type,...props});}};
    attachBirthStateRuntime(builder,{high:code=>issues.push(code)},{dryRun:true,cocosRoot:path.join(__dirname,'fixtures/no-project')});
    assert.equal(objects.length,enabled&&imported?4:3);
    assert.equal(issues.length,enabled&&!imported?1:0);
    if(objects[3])assert.deepEqual(objects[3].source,{__id__:1});
  }
});
