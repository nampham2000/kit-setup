'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {unityShaderQueue,unityMaterialRenderQueue,unitySortingLayerValue,attachSortingRuntime,stageSortingRuntime}=require('./particle-sorting-binding');
const {particleRendererContract}=require('./particle-renderer-contract');
const base=path.resolve(__dirname,'../../.ai/sorting-binding-tests');
function tempDir(){fs.mkdirSync(base,{recursive:true});return fs.mkdtempSync(path.join(base,'case-'));}
function cleanup(dir){assert.equal(path.dirname(fs.realpathSync(dir)),fs.realpathSync(base));fs.rmSync(dir,{recursive:true});}
const noProject={dryRun:true,cocosRoot:path.join(__dirname,'fixtures/not-a-cocos-project')};

test('render queue: material override first, then the shader Queue tag',()=>{
  assert.equal(unityShaderQueue('Tags { "RenderType"="Transparent" "Queue"="Transparent" }'),3000);
  assert.equal(unityShaderQueue('Tags {"Queue" = "Transparent+1"}'),3001);
  assert.equal(unityShaderQueue('Tags { "Queue"="Geometry-10" }'),1990);
  assert.equal(unityShaderQueue('Tags { "RenderType"="Opaque" }'),null);
  const dir=tempDir();
  try{
    const shader=path.join(dir,'Effect.shader');fs.writeFileSync(shader,'Shader "X" { SubShader { Tags { "Queue"="Transparent+2" } } }');
    const db={get:guid=>guid==='a3d89569f9b34c7f8b8e88f9e56ea619'?{path:shader}:null};
    const mat=(queue,guid='a3d89569f9b34c7f8b8e88f9e56ea619')=>{const file=path.join(dir,`m${queue}.mat`);
      fs.writeFileSync(file,`Material:\n  m_Shader: {fileID: 4800000, guid: ${guid}, type: 3}\n  m_CustomRenderQueue: ${queue}\n`);return {path:file};};
    assert.equal(unityMaterialRenderQueue(mat(3000),db),3000);
    assert.equal(unityMaterialRenderQueue(mat(-1),db),3002);
    assert.equal(unityMaterialRenderQueue(mat(-1,'0000000000000000f000000000000000'),db),null);
    assert.equal(unityMaterialRenderQueue({path:path.join(dir,'missing.mat')},db),null);
  }finally{cleanup(dir);}
});
test('sorting layer value is the TagManager list position of the unique id',()=>{
  const dir=tempDir();
  try{
    fs.mkdirSync(path.join(dir,'Assets'));fs.mkdirSync(path.join(dir,'ProjectSettings'));
    fs.writeFileSync(path.join(dir,'ProjectSettings/TagManager.asset'),'TagManager:\n  layers:\n  - Default\n  m_SortingLayers:\n  - name: Back\n    uniqueID: 777\n    locked: 0\n  - name: Default\n    uniqueID: 0\n    locked: 0\n  - name: Front\n    uniqueID: 12345\n    locked: 0\n');
    const options={unityRoot:path.join(dir,'Assets')};
    assert.deepEqual(unitySortingLayerValue(12345,options),{value:2,known:true});
    assert.deepEqual(unitySortingLayerValue(0,options),{value:1,known:true});
    assert.deepEqual(unitySortingLayerValue(999,options),{value:0,known:false});
    assert.deepEqual(unitySortingLayerValue(0,{}),{value:0,known:true});
  }finally{cleanup(dir);}
});
function graph(renderers){
  const objects=[];
  for(const [name,renderer,queue] of renderers){
    const node=objects.length;objects.push({__type__:'cc.Node',_name:name});
    const rendererId=objects.length+1;
    const particle={__type__:'cc.ParticleSystem',node:{__id__:node},renderer:{__id__:rendererId}};
    Object.defineProperty(particle,'unityRendererContract',{value:particleRendererContract({},renderer)});
    Object.defineProperty(particle,'unityRenderQueue',{value:queue});
    objects.push(particle,{_lengthScale:Number(renderer.m_LengthScale??1),_velocityScale:Number(renderer.m_VelocityScale??0)});
  }
  return objects;
}
function bind(objects,imported=true,options=noProject){
  const bound=[],reports=[];
  const builder={objects,cocosDb:{findScriptClass:()=>imported?{classId:'sorting-adapter-id'}:null},addComponent(node,type,props){bound.push({node,type,...props});}};
  attachSortingRuntime(builder,Object.fromEntries(['high','medium','low'].map(level=>[level,(code,a,target,message)=>reports.push({level,code,target,message})])),options);
  return {bound,reports};
}
test('every transparent particle renderer gets the Unity key, including fudge 0; opaque queues are skipped',()=>{
  const objects=graph([['Glow',{m_SortingFudge:15,m_SortMode:3},3000],['Sparks',{},3000],['Rays',{m_RenderMode:1,m_LengthScale:3,m_VelocityScale:.5,m_SortingOrder:2},3001],['Solid',{},2000]]);
  const {bound,reports}=bind(objects);
  assert.deepEqual(bound.map(b=>JSON.parse(b.sourceContract)),[
    {path:'Glow',fudge:15,queue:3000,sortMode:3},{path:'Sparks',fudge:0,queue:3000},
    {path:'Rays',fudge:0,queue:3001,order:2,lengthScale:3,velocityScale:.5}]);
  assert.ok(bound.every(b=>b.type==='sorting-adapter-id'&&objects[b.source.__id__].__type__==='cc.ParticleSystem'));
  assert.deepEqual(reports.map(r=>r.code),['PARTICLE_SORTING_ADAPTER_BOUND']);assert.match(reports[0].message,/3 particle renderers \(2 with/);
});
test('unknown queue is assumed Transparent with a medium note; unknown sorting layer stays high',()=>{
  const {bound,reports}=bind(graph([['NoQueue',{},null],['Layered',{m_SortingLayerID:4242},3000]]));
  assert.equal(bound.length,1);assert.equal(JSON.parse(bound[0].sourceContract).queue,3000);
  assert.deepEqual(reports.filter(r=>r.level!=='low').map(r=>[r.level,r.code,r.target]),[['medium','PARTICLE_SORTING_QUEUE_ASSUMED','NoQueue'],['high','PARTICLE_SORTING_ADAPTER_REQUIRED','Layered']]);
});
test('unimported adapter is one high obligation instead of an invented UUID',()=>{
  const {bound,reports}=bind(graph([['A',{m_SortingFudge:1},3000],['B',{},3000]]),false);
  assert.equal(bound.length,0);assert.equal(reports.length,1);assert.equal(reports[0].code,'PARTICLE_SORTING_ADAPTER_REQUIRED');assert.match(reports[0].message,/AssetDB/);
});
test('contract keeps sorting data and no longer reports it as unsupported',()=>{
  const contract=particleRendererContract({},{m_SortingFudge:5,m_SortingOrder:1,m_SortingLayerID:3,m_SortMode:3});
  assert.deepEqual(contract.sorting,{fudge:5,order:1,layer:3,sortMode:3});
  assert.ok(!contract.unsupported.includes('source-renderer-sorting-requires-camera-adapter'));
});
test('porter records the source render queue and the CLI binds sorting',()=>{
  const createParticlePorter=require('./particle-porter');
  const dir=tempDir();
  try{
    const matFile=path.join(dir,'glow.mat');fs.writeFileSync(matFile,'Material:\n  m_CustomRenderQueue: 3000\n');
    const db=new Map([['glow-mat',{guid:'glow-mat',path:matFile,relativePath:'glow.mat'}]]);
    const objects=[{__type__:'cc.Node',_name:'Glow'},{__type__:'cc.ParticleSystem',node:{__id__:0},renderer:{__id__:2},_textureAnimationModule:{__id__:3}},{},{_enable:false}];
    const reports=[];const reporter=Object.fromEntries(['high','medium','low'].map(level=>[level,(...args)=>reports.push({level,args})]));
    const builder={objects,addParticleSystemFromTemplate:()=>1};
    createParticlePorter({resolveUnityParticleMaterial:()=>({materialUuid:'glow-material'})}).emitParticleSystem(0,1,'ParticleSystem:\n  looping: 1',{name:'Glow'},builder,reporter,{},db,{},
      'ParticleSystemRenderer:\n  m_SortingFudge: 15\n  m_SortMode: 3\n  m_Materials:\n  - {fileID: 2100000, guid: glow-mat, type: 2}');
    assert.equal(objects[1].unityRenderQueue,3000);assert.deepEqual(objects[1].unityRendererContract.sorting,{fudge:15,order:0,layer:0,sortMode:3});
    assert.ok(!reports.some(r=>r.args[0]==='PARTICLE_RENDER_ALIGNMENT_ADAPTER_REQUIRED'),JSON.stringify(reports));
    assert.ok(!Object.keys(objects[1]).includes('unityRenderQueue'),'source queue is not serialized into the prefab');
  }finally{cleanup(dir);}
  const cli=fs.readFileSync(path.join(__dirname,'../unity-cocos-port.cjs'),'utf8');
  assert.match(cli,/attachSortingRuntime\(builder, reporter, options\)/);
});
test('staging is idempotent and leaves metadata to AssetDB',()=>{
  const root=tempDir();
  try{
    stageSortingRuntime({cocosRoot:root,dryRun:true});assert.equal(fs.existsSync(path.join(root,'assets')),false);
    stageSortingRuntime({cocosRoot:root});
    const target=path.join(root,'assets/script/UnityParticleSortingAdapter.ts');
    const before=fs.statSync(target).mtimeMs;stageSortingRuntime({cocosRoot:root});
    assert.equal(fs.statSync(target).mtimeMs,before);assert.equal(fs.existsSync(target+'.meta'),false);
    for(const name of ['UnityParticleSorting','UnityParticleSortingAdapter'])
      assert.equal(fs.readFileSync(path.join(root,'assets/script',name+'.ts'),'utf8'),fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'));
  }finally{cleanup(root);}
});
