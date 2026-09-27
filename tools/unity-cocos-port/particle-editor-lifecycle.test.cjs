'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const names=['UnityParticleInitialStateAdapter','UnityParticleStartRotationAdapter','UnityParticleSimulationStepAdapter','UnityParticleEulerRotationAdapter','UnityParticleShapeDistributionAdapter','UnityParticleBirthStateAdapter','UnityParticleNoiseAdapter'];
test('generated semantic adapters opt into Editor lifecycle and preserve installer order',()=>{
 const calls=[],classes=[];
 const cc={Component:class{},ParticleSystem:class{},_decorator:{ccclass:()=>c=>c,executeInEditMode:c=>{c.editor=true;return c;},playOnFocus:c=>{c.focus=true;return c;},executionOrder:n=>c=>{c.order=n;return c;},property:(...args)=>args.length>1?undefined:()=>{}}};
 for(const name of names){
  const m={exports:{}};
  const source=fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,experimentalDecorators:true}}).outputText;
  new Function('exports','module','require',code)(m.exports,m,id=>id==='cc'?cc:new Proxy({},{get:(_,key)=>(...args)=>{calls.push(String(key));return true;}}));
  const C=m.exports[name];assert.equal(C.editor,true,name+' must execute in Scene/Prefab Editor');assert.equal(C.focus,true,name+' needs focused preview updates');
  const c=new C();c.source={};c.sourceContract='{}';c.sourceForceContract='{}';classes.push(c);
 }
 classes.sort((a,b)=>a.constructor.order-b.constructor.order);
 for(const c of classes)c.onLoad?.();for(const c of classes)c.start?.();
 assert.ok(calls.indexOf('installUnityParticleInitialState')<calls.indexOf('installUnityParticleStartRotation'));
 assert.ok(calls.indexOf('installUnityParticleRandomForce')<calls.indexOf('installUnityParticleBirthState'));
 for(const name of ['installUnityParticleSimulationStep','installUnityShapeDistribution','installUnityParticleEulerRotation','installUnityParticleNoise'])assert.ok(calls.includes(name),name);
});
