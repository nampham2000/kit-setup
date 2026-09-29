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

test('generic porter binds a pre-2018.3 TrailRenderer (no textureScale) with the scene camera and material sort key',()=>{
  const {trailRendererContract,emitTrailRendererComponent}=require('./trail-renderer-binding');
  const trail={m_Enabled:1,m_Time:0.5,m_MinVertexDistance:0.01,m_SortingOrder:2,m_Autodestruct:0,
    m_Parameters:{widthMultiplier:1,widthCurve:{m_Curve:[{time:0,value:0.2,inSlope:0,outSlope:0},{time:1,value:0,inSlope:0,outSlope:0}]},
      colorGradient:{m_Mode:0,m_NumColorKeys:2,m_NumAlphaKeys:2,key0:{r:1,g:1,b:1,a:1},key1:{r:1,g:1,b:1,a:0},ctime0:0,ctime1:65535,atime0:0,atime1:65535},
      numCornerVertices:0,numCapVertices:0,alignment:0,textureMode:0}};
  assert.deepEqual(trailRendererContract(trail).unsupported,[]);
  assert.deepEqual(trailRendererContract({...trail,m_Emitting:0}).unsupported,['initially-not-emitting']);
  assert.deepEqual(trailRendererContract({...trail,m_Parameters:{...trail.m_Parameters,textureScale:{x:2,y:1}}}).unsupported,['texture-scale']);
  const added=[],reports=[],reporter={high:(...a)=>reports.push(['high',...a]),medium:(...a)=>reports.push(['medium',...a]),low:(...a)=>reports.push(['low',...a])};
  const builder={addComponent:(...a)=>added.push(a)};
  assert.equal(emitTrailRendererComponent({nodeId:3,componentId:'96001',trail,materialUuid:'mat-uuid',queue:3000,layer:{value:0,known:true},classId:'trail-class',name:'Trail',file:'Fx.prefab'},builder,reporter),true);
  const [node,type,body,unityId,fileId]=added[0];
  assert.deepEqual([node,type,unityId,fileId],[3,'trail-class','96001','cmp-trail-renderer-96001']);
  assert.equal(body.cameraPath,'');
  assert.deepEqual(body.sourceMaterial,{__uuid__:'mat-uuid',__expectedType__:'cc.Material'});
  const spec=JSON.parse(body.sourceContract);
  assert.deepEqual(spec.sorting,{path:'Trail',fudge:0,queue:3000,order:2});
  assert.equal(spec.unsupported,undefined);
  assert.equal(spec.time,0.5);
  assert.equal(emitTrailRendererComponent({nodeId:3,componentId:'96002',trail:{...trail,m_Parameters:{...trail.m_Parameters,alignment:1}},materialUuid:'m',queue:3000,layer:{value:0,known:true},classId:'c',name:'Z',file:'Fx.prefab'},builder,reporter),false);
  assert.ok(reports.some(r=>r[0]==='high'&&r[1]==='TRAIL_RENDERER_UNSUPPORTED'&&/alignment/.test(r[4])));
  assert.equal(emitTrailRendererComponent({nodeId:3,componentId:'96003',trail,materialUuid:'m',queue:3000,layer:{value:0,known:true},classId:'',name:'Y',file:'Fx.prefab'},builder,reporter),false);
  assert.ok(reports.some(r=>r[1]==='TRAIL_RENDERER_ADAPTER_REQUIRED'&&/rerun porter/.test(r[4])));
});
