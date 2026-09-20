'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {emissionBudget}=require('./particle-emission-budget');
const upper=c=>c?.scalar||0;
const burst=(count,cycles=1,interval=0)=>({time:0,countCurve:{scalar:count},cycleCount:cycles,repeatInterval:interval});
function node(path,bursts,links=[],looping=false){return {path,components:[{type:'UnityEngine.ParticleSystem',particleSubEmitters:links,json:JSON.stringify({ParticleSystem:{lengthInSec:2,looping,EmissionModule:{enabled:true,rateOverTime:{scalar:0},rateOverDistance:{scalar:0},m_Bursts:bursts}}})}]};}
const link=path=>({path,type:0,probability:1});
test('collision child inherits 25 parent births, rather than one child burst',()=>{
 const nodes=[node('root',[burst(1,25,.08)],[link('child')]),node('child',[burst(1)])];
 assert.equal(emissionBudget(nodes,'child',2.5,upper),25);
});
test('loop boundary, delayed trigger and nested child multiplicity are bounded',()=>{
 const nodes=[node('root',[burst(1,25,.08)],[link('child')],true),node('child',[{...burst(2),time:.2}],[link('grandchild')]),node('grandchild',[burst(3)])];
 assert.equal(emissionBudget(nodes,'grandchild',2.5,upper),32*6);
});
test('cyclic and unsupported triggers fail instead of under-sizing',()=>{
 const nodes=[node('a',[burst(1)],[link('b')]),node('b',[burst(1)],[link('a')])];
 assert.throws(()=>emissionBudget(nodes,'b',1,upper),/cyclic/);
 nodes[0].components[0].particleSubEmitters[0].type=2;
 assert.throws(()=>emissionBudget(nodes,'b',1,upper),/Unsupported/);
});
