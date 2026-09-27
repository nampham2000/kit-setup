'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {constantPointPrewarm,initialStateContract,attachInitialStateRuntime}=require('./particle-initial-state-binding.cjs');
const fixture=require('./fixtures/constant-point-prewarm-native.json');
test('native constant point billboard prewarm has invariant initialization across five effects',()=>{
 assert.equal(fixture.rows.length,5);
 for(const row of fixture.rows){
  assert.equal(constantPointPrewarm(row.source),true,row.prefab);assert.equal(row.frames.length,5);
  for(const frame of row.frames){assert.equal(frame.count,1);const p=frame.particles[0];assert.deepEqual(p.position,[0,0,0]);assert.deepEqual(p.rotation,[0,0,0]);assert.deepEqual(p.color,[1,1,1,1]);assert.deepEqual(p.size,[10,10,10]);assert.equal(p.startLifetime,1);assert.ok(p.remainingLifetime>0&&p.remainingLifetime<=1);}
 }
});
test('constant billboard is explicitly resolved while mesh initial-state obligations remain',()=>{
 const source=fixture.rows[0].source;
 for(const mode of [0,4]){
  const high=[],low=[],builder={objects:[{_name:'point'},{node:{__id__:0},unityInitialStateContract:initialStateContract(source),unityRendererContract:{mode,eulerSigns:[1,1,1]}}],addComponent:()=>assert.fail('No RNG adapter should be installed for this invariant')};
  attachInitialStateRuntime(builder,{high:code=>high.push(code),low:code=>low.push(code)},{dryRun:true,cocosRoot:path.join(__dirname,'nonexistent-test-project')});
  assert.deepEqual(high,mode===0?[]:['PARTICLE_INITIAL_STATE_ADAPTER_REQUIRED']);assert.deepEqual(low,mode===0?['PARTICLE_INITIAL_STATE_CONSTANT_PREWARM']:[]);
 }
});
test('moving, random, non-point and newly enabled modules retain conservative prewarm guards',()=>{
 const edits=[s=>s.InitialModule.startSpeed.scalar=1,s=>s.InitialModule.startRotation.scalar=.1,s=>s.InitialModule.startLifetime.minMaxState=3,s=>s.InitialModule.startColor.minMaxState=2,s=>s.ShapeModule.m_Scale.x=1,s=>s.ShapeModule.randomPositionAmount=.1,s=>s.UVModule.startFrame.minMaxState=3,s=>s.NewFutureModule={enabled:true},s=>s.NoiseModule={enabled:true},s=>s.EmissionModule.m_Bursts=[{countCurve:{minMaxState:0,scalar:1},probability:.5}]];
 for(const edit of edits){const s=structuredClone(fixture.rows[0].source);edit(s);assert.equal(constantPointPrewarm(s),false);}
});
