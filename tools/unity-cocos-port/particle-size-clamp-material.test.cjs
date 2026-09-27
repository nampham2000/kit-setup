'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const yaml=require('../lib/unity-yaml.cjs');
const createMaterialPorter=require('./material-porter');
const {particleRendererContract}=require('./particle-renderer-contract');
function fixture(shaderRef){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'particle-size-clamp-'));
  const shader=path.join(temp,'LegacyPreviewURPEffect.shader');
  fs.writeFileSync(shader,'Shader "LegacyPreview/URP Effect" { }\n');
  const source=path.join(temp,'glow.mat');
  fs.writeFileSync(source,`%YAML 1.1\n--- !u!21 &2100000\nMaterial:\n  m_Name: Glow\n  m_Shader: ${shaderRef}\n`);
  const porter=createMaterialPorter({
    parseUnityScalar:yaml.parseScalar,
    parseUnityYaml:file=>[{classId:21,lines:fs.readFileSync(file,'utf8').split(/\r?\n/)}],
    getField:(doc,key,fallback)=>{const line=doc.lines.find(l=>l.trim().startsWith(key+':'));return line?yaml.parseScalar(line.slice(line.indexOf(':')+1)):fallback;},
    getIndentedBlock:()=>[],unityRefGuid:r=>r?.guid||'',
    importedUnityAssetPath:()=>path.join(temp,'assets','glow.mat'),
    ensureDirectoryMetas:()=>{},ensureMaterialAssetMeta:()=>null,
  });
  const entries=[];
  const reporter=Object.fromEntries(['high','medium','low'].map(level=>[level,(code)=>entries.push({level,code})]));
  const unityDb=new Map([['legacypreviewshader',{path:shader,relativePath:'LegacyPreviewURPEffect.shader',stem:'LegacyPreviewURPEffect'}]]);
  const write=renderer=>{
    const result=porter.convertUnityParticleMaterialToCocos({path:source,relativePath:'glow.mat',stem:'Glow'},{cocosRoot:temp},unityDb,reporter,null,'particle',particleRendererContract({},renderer));
    return {name:path.basename(result.file),props:JSON.parse(fs.readFileSync(result.file,'utf8'))._props[0]};
  };
  return {temp,write,entries};
}
test('renderers sharing one LegacyPreview material keep their own Min/Max Particle Size',()=>{
  const {temp,write}=fixture('{fileID: 4800000, guid: legacypreviewshader, type: 3}');
  try{
    const unityDefault=write({m_RenderMode:0});
    const levelUpRing=write({m_RenderMode:0,m_MaxParticleSize:25});
    const glowBlast=write({m_RenderMode:1,m_MaxParticleSize:5});
    assert.equal(unityDefault.name,'glow.mtl','the Unity default clamp keeps the shared file name');
    assert.equal(levelUpRing.name,'glow.size-0_25.mtl');
    assert.equal(glowBlast.name,'glow.size-0_5.mtl');
    assert.deepEqual(unityDefault.props.sourceRendererSize,{__type__:'cc.Vec4',x:0,y:0.5,z:0,w:1});
    assert.deepEqual(levelUpRing.props.sourceRendererSize,{__type__:'cc.Vec4',x:0,y:25,z:0,w:1});
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'assets','glow.mtl'),'utf8'))._props[0].sourceRendererSize.y,0.5,'a later renderer never overwrites the default variant');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('builtin particle materials report an unbound clamp; source adapters carry it',()=>{
  const {temp,write,entries}=fixture('{fileID: 200, guid: 0000000000000000f000000000000000, type: 0}');
  try{
    const builtin=write({m_RenderMode:0,m_MaxParticleSize:1});
    assert.equal(builtin.props.sourceRendererSize,undefined);
    assert.ok(entries.some(e=>e.level==='medium'&&e.code==='PARTICLE_SIZE_CLAMP_UNBOUND'));
    entries.length=0;
    write({m_RenderMode:4,m_MaxParticleSize:1});
    assert.equal(entries.some(e=>e.code==='PARTICLE_SIZE_CLAMP_UNBOUND'),false,'mesh particles are never clamped by Unity');
    const local=write({m_RenderMode:0,m_RenderAlignment:2,m_MaxParticleSize:1});
    assert.equal(local.name,'glow.renderer-0-0_0_0_2.size-0_1.mtl');
    assert.deepEqual(local.props.sourceRendererSize,{__type__:'cc.Vec4',x:0,y:1,z:0,w:1});
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
