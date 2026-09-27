'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {attachTrailRenderer,trailRendererContract}=require('./trail-renderer-binding');
const source=require('./fixtures/trail-playback-native.json').source;
test('native TrailRenderer binds actual imported IDs, source material, camera and sorting',()=>{
  const calls=[],issues=[],builder={addComponent:(...args)=>calls.push(args)},binding={classId:'assetdb-registered-class',materialUuid:'source-color-mesh-material',cameraPath:'Main Camera',sorting:{queue:3000,order:0,layer:0,path:'ribbon',fudge:0}};
  assert.equal(attachTrailRenderer(builder,12,source,binding,{high:(...args)=>issues.push(args),low(){}}),true);
  assert.deepEqual(issues,[]);assert.deepEqual(calls[0].slice(0,2),[12,binding.classId]);
  assert.deepEqual(calls[0][2].sourceMaterial,{__uuid__:binding.materialUuid,__expectedType__:'cc.Material'});
  assert.deepEqual(JSON.parse(calls[0][2].sourceContract).widthKeys,source.m_Parameters.widthCurve.m_Curve);
});
for(const [field,value] of [['alignment',1],['textureMode',1],['numCornerVertices',1],['numCapVertices',1]])test(`unsupported native ${field} remains explicit`,()=>{
  const bad=structuredClone(source);bad.m_Parameters[field]=value;assert.ok(trailRendererContract(bad).unsupported.length);
});
test('absent material/script/camera cannot silently omit a TrailRenderer',()=>{
  const issues=[];assert.equal(attachTrailRenderer({addComponent(){throw new Error('Must not bind');}},0,source,{}, {high:(...args)=>issues.push(args),low(){}}),false);
  assert.equal(issues[0][0],'TRAIL_RENDERER_ADAPTER_REQUIRED');assert.match(issues[0][3],/source-color-mesh-material/);
});
