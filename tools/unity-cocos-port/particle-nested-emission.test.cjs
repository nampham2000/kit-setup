'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
// Cocos 3.8.8 caches world transform once outside its birth loop.
let world=0,rotation=0,randomDraws=0;
class ParticleSystem {
  constructor(position,angle){this.position=position;this.angle=angle;this.rows=[];this.processor={setNewParticle:p=>this.rows.push(p)};}
  emit(count,dt){world=this.position;rotation=this.angle;for(let i=0;i<count;i++){randomDraws++;this.processor.setNewParticle({position:world,rotation,dt});}}
}
const m={exports:{}};
new Function('require','exports','module',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleNestedEmission.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(()=>({ParticleSystem}),m.exports,m);
const {installUnityParticleNestedEmission:install}=m.exports;
test('nested births preserve parent transform, burst count, delay and random draw order',()=>{
  for(const fixed of [false,true]){
    const parent=new ParticleSystem(2,.7),child=new ParticleSystem(-5,-1.2),grandchild=new ParticleSystem(11,2.5);
    const p=parent.processor.setNewParticle,c=child.processor.setNewParticle;
    parent.processor.setNewParticle=v=>{p(v);child.emit(2,.02);};
    child.processor.setNewParticle=v=>{c(v);grandchild.emit(1,.03);};
    if(fixed){install(parent);install(child);const hook=parent.processor.setNewParticle;install(parent);assert.equal(parent.processor.setNewParticle,hook);}
    randomDraws=0;parent.emit(4,.01);
    assert.equal(randomDraws,20);assert.equal(parent.rows.length,4);assert.equal(child.rows.length,8);
    assert.ok(parent.rows.every(v=>v.dt===.01));assert.ok(child.rows.every(v=>v.dt===.02));
    assert.equal(parent.rows.every(v=>v.position===2&&v.rotation===.7),fixed);
    assert.equal(child.rows.every(v=>v.position===-5&&v.rotation===-1.2),fixed);
  }
});
test('engine restoration bypasses instance wrappers and supports an added birth listener',()=>{
  const parent=new ParticleSystem(3,.2),child=new ParticleSystem(9,1);
  let batches=0;parent.emit=function(n,dt){batches++;ParticleSystem.prototype.emit.call(this,n,dt);};
  install(parent);const previous=parent.processor.setNewParticle;
  parent.processor.setNewParticle=p=>{previous(p);child.emit(1,0);};install(parent);
  parent.emit(5,.1);assert.equal(batches,1);assert.ok(parent.rows.every(v=>v.position===3&&v.rotation===.2));
});
