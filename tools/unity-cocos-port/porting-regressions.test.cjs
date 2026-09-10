'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('../lib/unity-yaml.cjs');
const createAnimationPorter = require('./animation-porter');
const createColliderPorter = require('./collider-porter');
const createRuntimePorter = require('./runtime-component-porter');
const createParticlePorter = require('./particle-porter');
const createMaterialPorter = require('./material-porter');
const { applyParticleRendererMaterial, applyUnityParticleDataToCocos } = require('./particle-system-converter');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hidden-suspect-port-regressions-'));
test.after(() => {
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(temp).startsWith('hidden-suspect-port-regressions-'));
  fs.rmSync(temp, { recursive: true });
});
const reports = () => {
  const entries = [];
  return { entries, ...Object.fromEntries(['high','medium','low'].map(level => [level, (...args) => entries.push({level,args})])) };
};
test('particle UV tiling emits a typed Vec4 for a single FLOAT4 uniform',()=>{
  const source=path.join(temp,'uv-mask.mat');
  fs.writeFileSync(source,`%YAML 1.1
--- !u!21 &2100000
Material:
  m_Name: Mask
  m_TexEnvs:
  - _MainTex:
      m_Scale: {x: 1, y: 0.99}
      m_Offset: {x: 0.2, y: -0.3}
`);
  const porter=createMaterialPorter({
    parseUnityScalar:yaml.parseScalar,
    parseUnityYaml:file=>[{classId:21,lines:fs.readFileSync(file,'utf8').split(/\r?\n/)}],
    getField:(doc,key,fallback)=>{const line=doc.lines.find(l=>l.trim().startsWith(key+':'));return line?yaml.parseScalar(line.slice(line.indexOf(':')+1)):fallback;},
    getIndentedBlock:(doc,key)=>key==='m_TexEnvs'?doc.lines.slice(doc.lines.findIndex(l=>l.trim()==='m_TexEnvs:')+1).filter(Boolean):[],
    unityRefGuid:r=>r?.guid||'',
    importedUnityAssetPath:()=>path.join(temp,'assets','uv-mask.mat'),
    ensureDirectoryMetas:()=>{},ensureMaterialAssetMeta:()=>null,
  });
  const result=porter.convertUnityParticleMaterialToCocos({path:source,relativePath:'uv-mask.mat',stem:'Mask'},{cocosRoot:temp},new Map(),reports());
  const output=JSON.parse(fs.readFileSync(result.file,'utf8'));
  assert.deepEqual(output._props[0].mainTiling_Offset,{__type__:'cc.Vec4',x:1,y:.99,z:.2,w:-.3});
});
const animation = createAnimationPorter({
  parseUnityYaml: file => [{classId:74,lines:fs.readFileSync(file,'utf8').split(/\r?\n/)}],
  getField: (doc,key,fallback) => {const line=doc.lines.find(l=>new RegExp(`^\\s*${key}:`).test(l));return line ? yaml.parseScalar(line.slice(line.indexOf(':')+1)) : fallback;},
  parseUnityScalar: yaml.parseScalar,
  unityRefGuid: r => r?.guid || '', unityRefFileId: r => String(r?.fileID ?? ''),
});
function spriteClip(frameCount, missing=false) {
  const file=path.join(temp, `sprite-${frameCount}-${missing}.anim`);
  fs.writeFileSync(file, `AnimationClip:
  m_Name: Tutorial
  m_SampleRate: 12
  m_PPtrCurves:
  - curve:
${Array.from({length:frameCount},(_,i)=>`    - time: ${i/12}\n      value: {fileID: 21300000, guid: frame${i}, type: 3}`).join('\n')}
    - time: ${frameCount/12}
      value: {fileID: 0}
    attribute: m_Sprite
    path: Hand
    classID: 114
    script: {fileID: 11500000, guid: fe87c0e1cc204ed48ad3b37840f39efc, type: 3}
  m_AnimationClipSettings:
    m_StopTime: ${(frameCount+1)/12}
    m_LoopTime: 1
`);
  const reporter=reports();
  return {reporter,clip:animation.parseUnityAnimationClip(file,reporter,{resolveSpriteReference:r=>missing&&r.guid==='frame1'?'':r.guid+'-uuid'})};
}
for(const frames of [4,7]) test(`${frames}-frame sprite FTUE preserves timing, component binding, and null frame`,()=>{
  const {clip,reporter}=spriteClip(frames);
  assert.equal(clip._tracks.length,1);assert.equal(clip.sample,12);assert.equal(clip.wrapMode,2);
  const track=clip._tracks[0];
  assert.equal(track._binding.path._paths[1].component,'cc.Sprite');
  assert.equal(track._binding.path._paths[2],'spriteFrame');
  assert.deepEqual(track._channel._curve._times,Array.from({length:frames+1},(_,i)=>i/12));
  assert.equal(track._channel._curve._values[frames],null);
  assert.equal(track._channel._curve._values[1].__uuid__,'frame1-uuid');
  assert.equal(reporter.entries.length,0);
});
test('unresolved animation frames report high and never emit a partial track',()=>{
  const {clip,reporter}=spriteClip(4,true);
  assert.equal(clip._tracks.length,0);
  assert.equal(reporter.entries[0].level,'high');
});
for(const type of ['SphereCollider','CapsuleCollider','BoxCollider','CharacterController']) test(`${type} reflects local center Z without changing shape size`,()=>{
  const porter=createColliderPorter({getField:(d,k,f)=>d[k]??f,unityRefGuid:r=>r?.guid});let result;
  const builder={['add'+type]:(_n,_c,props)=>{result=props;}};
  porter['emit'+type](1,2,{m_Center:{x:2,y:-3,z:4},m_Size:{x:5,y:6,z:7},m_Radius:.4,m_Height:2}, {},{},builder,reports(),{},new Map());
  assert.deepEqual(result.center,{x:2,y:-3,z:-4});
  if(type==='BoxCollider')assert.deepEqual(result.size,{x:5,y:6,z:7});else assert.equal(result.radius,.4);
});
test('Unity particle Local/World/Custom enum maps to Cocos by meaning',()=>{
  for(const [unity,cocos] of [[0,1],[1,0],[2,2]]) {
    const builder={objects:[{},{}]};applyUnityParticleDataToCocos(builder,1,{moveWithTransform:unity});
    assert.equal(builder.objects[1]._simulationSpace,cocos);
  }
});
test('cache from before the parity repairs cannot hide newly corrected output',()=>{
  const {PortCache}=require('./port-cache');
  const dir=path.join(temp,'cache');fs.mkdirSync(dir);
  const source=path.join(dir,'source.prefab'),output=path.join(dir,'output.prefab'),cacheFile=path.join(dir,'cache.json');
  fs.writeFileSync(source,'source');fs.writeFileSync(output,'output');
  const cache=new PortCache(cacheFile,{},true,source);cache.record(source,output);cache.save();
  assert.equal(new PortCache(cacheFile,{},true,source).canSkip(source,output),true);
  const legacy=JSON.parse(fs.readFileSync(cacheFile));legacy.version=1;fs.writeFileSync(cacheFile,JSON.stringify(legacy));
  assert.equal(new PortCache(cacheFile,{},true,source).canSkip(source,output),false);
});
function particleBuilder() {
  return {objects:[{}, {_textureAnimationModule:{__id__:2},renderer:{__id__:3}}, {_enable:false,_numTilesX:1,_numTilesY:1},{}],addParticleSystemFromTemplate:()=>1};
}
test('renderer View and emitter Local alignment use the correct Cocos CPU frames',()=>{
  for(const [source,expected] of [[0,2],[2,0]]){
    const b=particleBuilder();applyUnityParticleDataToCocos(b,1,{}, {m_RenderAlignment:source,m_RenderMode:4});
    assert.equal(b.objects[3]._alignSpace,expected);
  }
  const b=particleBuilder();applyUnityParticleDataToCocos(b,1,{}, {m_RenderMode:5,m_Enabled:1});
  assert.equal(b.objects[1]._enabled,false);
});
test('Unity gradient alpha before first authored key remains constant',()=>{
  const b=particleBuilder();b.add=o=>b.objects.push(o)-1;b.objects[1].startColor={__id__:b.objects.push({})-1};
  applyUnityParticleDataToCocos(b,1,{InitialModule:{startColor:{minMaxState:1,maxGradient:{
    m_NumColorKeys:2,m_NumAlphaKeys:2,key0:{r:1,g:1,b:1,a:1},key1:{r:1,g:1,b:1,a:0},ctime0:0,ctime1:65535,atime0:52428,atime1:65535,
  }}}});
  const range=b.objects[b.objects[1].startColor.__id__],g=b.objects[range.gradient.__id__];
  assert.deepEqual(g.alphaKeys.map(r=>b.objects[r.__id__]).map(k=>[k.time,k.alpha]),[[0,255],[.8,255],[1,0]]);
});
test('particle trail material is preserved in Cocos material slot 1',()=>{
  const b=particleBuilder();
  applyParticleRendererMaterial(b,1,'particle-mat','particle-texture');
  applyParticleRendererMaterial(b,1,'trail-mat','',1);
  assert.equal(b.objects[1]._materials[0].__uuid__,'particle-mat');
  assert.equal(b.objects[1]._materials[1].__uuid__,'trail-mat');
  assert.equal(b.objects[3]._cpuMaterial.__uuid__,'particle-mat');
  assert.equal(b.objects[3]._mainTexture.__uuid__,'particle-texture');
});
test('particle porter resolves Unity renderer material 1 for enabled trails',()=>{
  const db=new Map([
    ['particle-mat',{guid:'particle-mat',path:'particle.mat',relativePath:'particle.mat'}],
    ['trail-mat',{guid:'trail-mat',path:'trail.mat',relativePath:'trail.mat'}],
  ]);
  const usages=[];
  const porter=createParticlePorter({resolveUnityParticleMaterial:(a,_o,_d,_r,_n,_s,usage)=>{usages.push(usage||'particle');return {materialUuid:`cocos-${a.guid}`};}});
  const renderer=`ParticleSystemRenderer:
  m_Materials:
  - {fileID: 2100000, guid: particle-mat, type: 2}
  - {fileID: 2100000, guid: trail-mat, type: 2}`;
  const doc=`ParticleSystem:
  TrailModule:
    enabled: 1`;
  const b=particleBuilder(),r=reports();
  porter.emitParticleSystem(0,1,doc,{name:'Firework'},b,r,{},db,{},renderer);
  assert.equal(b.objects[1]._materials[0].__uuid__,'cocos-particle-mat');
  assert.equal(b.objects[1]._materials[1].__uuid__,'cocos-trail-mat');
  assert.deepEqual(usages,['particle','trail']);
  assert.ok(r.entries.some(e=>e.args[0]==='PARTICLE_TRAIL_MATERIAL_CONVERTED'));
});
test('Sprites UV mode never reuses stale grid tile counts',()=>{
  const b=particleBuilder();applyUnityParticleDataToCocos(b,1,{UVModule:{enabled:1,mode:1,tilesX:2,tilesY:3}});
  assert.equal(b.objects[2]._enable,false);assert.equal(b.objects[2]._numTilesX,1);assert.equal(b.objects[2]._numTilesY,1);
  const grid=particleBuilder();applyUnityParticleDataToCocos(grid,1,{UVModule:{enabled:1,mode:0,tilesX:2,tilesY:3}});
  assert.equal(grid.objects[2]._enable,true);assert.equal(grid.objects[2]._numTilesX,2);assert.equal(grid.objects[2]._numTilesY,3);
});
test('single particle sprite overrides texture per emitter; multiple sprites report high',()=>{
  let override;
  const material={guid:'mat',path:'material.mat'},sprite={guid:'sprite',path:'glow.png'};
  const db=new Map([['mat',material],['sprite',sprite]]);
  const porter=createParticlePorter({resolveUnityParticleMaterial:(a,o,d,r,n,s)=>{override=s;return {materialUuid:'scoped',textureUuid:'glow'};}});
  const doc=count=>`ParticleSystem:\n  UVModule:\n    enabled: 1\n    mode: 1\n    sprites:\n${Array.from({length:count},()=>`    - sprite: {fileID: 21300000, guid: sprite, type: 3}`).join('\n')}`;
  const renderer='ParticleSystemRenderer:\n  m_Materials:\n  - {fileID: 2100000, guid: mat, type: 2}';
  const b=particleBuilder(),r=reports();porter.emitParticleSystem(0,1,doc(1),{name:'Glow'},b,r,{},db,{},renderer);
  assert.equal(override,sprite);assert.equal(b.objects[3]._mainTexture.__uuid__,'glow');assert.ok(!r.entries.some(e=>e.level==='high'));
  const r2=reports();porter.emitParticleSystem(0,1,doc(2),{name:'Glow'},particleBuilder(),r2,{},db,{},renderer);
  assert.ok(r2.entries.some(e=>e.args[0]==='PARTICLE_SPRITE_SHEET_UNRESOLVED'));
});
test('runtime helper migrates to canonical script path while retaining UUID',()=>{
  const root=path.join(temp,'runtime'),legacy=path.join(root,'assets/scripts/UnityParticleRateOverDistanceEmitter.ts');
  const template=path.join(__dirname,'runtime/UnityParticleRateOverDistanceEmitter.ts');
  fs.mkdirSync(path.dirname(legacy),{recursive:true});fs.copyFileSync(template,legacy);
  fs.writeFileSync(legacy+'.meta',JSON.stringify({uuid:'old-stable-uuid',importer:'typescript'}));
  const porter=createRuntimePorter({ensureDirectoryMetas:()=>{}});
  porter.ensureParticleRateOverDistanceEmitterScript({cocosRoot:root},reports());
  const output=path.join(root,'assets/script/UnityParticleRateOverDistanceEmitter.ts');
  assert.ok(fs.readFileSync(output,'utf8').includes('class UnityParticleRateOverDistanceEmitter'));
  assert.equal(JSON.parse(fs.readFileSync(output+'.meta')).uuid,'old-stable-uuid');
  assert.ok(!fs.existsSync(legacy));
});
test('runtime helper reuses an existing assets/script subfolder class without registering a duplicate',()=>{
  const root=path.join(temp,'runtime-existing'),name='UnityParticleHierarchyTransformSync';
  const template=path.join(__dirname,'runtime',`${name}.ts`);
  const existing=path.join(root,'assets/script/unity-adapters',`${name}.ts`);
  fs.mkdirSync(path.dirname(existing),{recursive:true});fs.copyFileSync(template,existing);
  fs.writeFileSync(existing+'.meta',JSON.stringify({uuid:'existing-adapter-uuid',importer:'typescript'}));
  const porter=createRuntimePorter({ensureDirectoryMetas:()=>{}});
  porter.ensureParticleHierarchyTransformSyncScript({cocosRoot:root},reports());
  assert.ok(fs.existsSync(existing));
  assert.ok(!fs.existsSync(path.join(root,'assets/script',`${name}.ts`)));
});
test('runtime helper removes an Editor-remapped duplicate that shares the existing script UUID',()=>{
  const root=path.join(temp,'runtime-remapped'),name='UnityParticleHierarchyTransformSync';
  const template=path.join(__dirname,'runtime',`${name}.ts`);
  const existing=path.join(root,'assets/script/unity-adapters',`${name}.ts`);
  const duplicate=path.join(root,'assets/script',`${name}.ts`);
  fs.mkdirSync(path.dirname(existing),{recursive:true});fs.copyFileSync(template,existing);fs.copyFileSync(template,duplicate);
  for(const file of [existing,duplicate])fs.writeFileSync(file+'.meta',JSON.stringify({uuid:'82583f58-8309-4153-91e6-2c8a3e8e6347',importer:'typescript'}));
  fs.mkdirSync(path.join(root,'assets/resources'),{recursive:true});
  fs.writeFileSync(path.join(root,'assets/resources/ref.prefab'),'825839YgwlBU5HmLIo+jmNH');
  const porter=createRuntimePorter({ensureDirectoryMetas:()=>{}});
  porter.ensureParticleHierarchyTransformSyncScript({cocosRoot:root},reports());
  assert.ok(fs.existsSync(existing));assert.ok(!fs.existsSync(duplicate));assert.ok(!fs.existsSync(duplicate+'.meta'));
});
test('nested GameObject inactive override is serialized against the descendant node fileId',()=>{
  const {portPrefab,parseArgs}=require('../unity-cocos-port.cjs');
  const root=path.join(temp,'nested'),unity=path.join(root,'Unity/Assets'),cocos=path.join(root,'Cocos');
  fs.mkdirSync(unity,{recursive:true});fs.mkdirSync(path.join(cocos,'assets'),{recursive:true});
  const guid='1234567890abcdef1234567890abcdef';
  const source=path.join(unity,'Avatar.prefab');
  fs.writeFileSync(source,`%YAML 1.1
--- !u!1 &1
GameObject:
  m_Name: Avatar
  m_IsActive: 1
  m_Component:
  - component: {fileID: 2}
--- !u!4 &2
Transform:
  m_GameObject: {fileID: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children:
  - {fileID: 4}
  m_Father: {fileID: 0}
--- !u!1 &3
GameObject:
  m_Name: FrameBG
  m_IsActive: 1
  m_Component:
  - component: {fileID: 4}
--- !u!4 &4
Transform:
  m_GameObject: {fileID: 3}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 2}
`);
  fs.writeFileSync(source+'.meta',`fileFormatVersion: 2\nguid: ${guid}\n`);
  const input=path.join(unity,'HUD.prefab');
  fs.writeFileSync(input,`%YAML 1.1
--- !u!1 &101
GameObject:
  m_Name: HUD
  m_IsActive: 1
  m_Component:
  - component: {fileID: 102}
--- !u!4 &102
Transform:
  m_GameObject: {fileID: 101}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children:
  - {fileID: 201}
  m_Father: {fileID: 0}
--- !u!1001 &200
PrefabInstance:
  m_Modification:
    m_TransformParent: {fileID: 102}
    m_Modifications:
    - target: {fileID: 3, guid: ${guid}, type: 3}
      propertyPath: m_IsActive
      value: 0
      objectReference: {fileID: 0}
    m_RemovedComponents: []
  m_SourcePrefab: {fileID: 100100000, guid: ${guid}, type: 3}
--- !u!4 &201 stripped
Transform:
  m_CorrespondingSourceObject: {fileID: 2, guid: ${guid}, type: 3}
  m_PrefabInstance: {fileID: 200}
  m_PrefabAsset: {fileID: 0}
`);
  const out=path.join(cocos,'assets/HUD.prefab');
  const options=parseArgs(['port','--src',input,'--out',out,'--unity-root',unity,'--cocos-root',cocos,'--overwrite','--no-cache','--recursive','--report',path.join(root,'report.csv')]);
  portPrefab(options);
  const objects=JSON.parse(fs.readFileSync(out));
  const override=objects.find(o=>o.__type__==='CCPropertyOverrideInfo'&&objects[o.targetInfo.__id__].localID.includes('node-framebg-4'));
  assert.ok(override,'inactive child override must survive linking');
  assert.deepEqual(override.propertyPath,['_active']);
  const target=objects[override.targetInfo.__id__];
  assert.equal(override.value,false);
  assert.ok(target.localID.includes('node-framebg-4'),JSON.stringify(target));
  const rootActive=objects.find(o=>o.__type__==='CCPropertyOverrideInfo'&&objects[o.targetInfo.__id__].localID.includes('node-avatar-2')&&o.propertyPath[0]==='_active');
  assert.equal(rootActive?.value,true,'a child active override must not disable its parent');
});
