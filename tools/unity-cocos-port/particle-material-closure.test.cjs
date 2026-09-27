'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const createParticlePorter=require('./particle-porter');
for(const slot of ['- {fileID: 2100000, guid: missing-material-guid, type: 2}','- {fileID: 0}'])test('missing primary material is a blocking source closure obligation: '+slot,()=>{
 const objects=[{__type__:'cc.Node',_name:'Effect'},{__type__:'cc.ParticleSystem',node:{__id__:0},renderer:{__id__:2},_textureAnimationModule:{__id__:3}},{},{_enable:false}];
 const reports=[],reporter=Object.fromEntries(['high','medium','low'].map(level=>[level,(...args)=>reports.push({level,args})]));
 const builder={objects,addParticleSystemFromTemplate:()=>1};
 createParticlePorter({}).emitParticleSystem(0,1,'ParticleSystem:\n  looping: 1',{name:'Effect'},builder,reporter,{},new Map(),{},'ParticleSystemRenderer:\n  m_Materials:\n  '+slot);
 assert.ok(reports.some(r=>r.level==='high'&&r.args[0]==='PARTICLE_PRIMARY_MATERIAL_UNRESOLVED'));
 assert.ok(!reports.some(r=>r.args[0]==='PARTICLE_MATERIAL_CONVERTED'));
});
