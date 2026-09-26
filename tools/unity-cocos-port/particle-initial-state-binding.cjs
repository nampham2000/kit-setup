'use strict';
const fs=require('node:fs'),path=require('node:path');
const {compressUuid}=require('./core-utils');
function initialStateContract(source){
 const i=source.InitialModule;if(!i)return null;
 const reasons=[],rotation=[i.startRotationX,i.startRotationY,i.startRotation],size=[i.startSize,i.startSizeY,i.startSizeZ];
 const copy=c=>({minMaxState:c?.minMaxState??0,scalar:c?.scalar??0,minScalar:c?.minScalar??0});
 const curves=[i.startLifetime,i.startSpeed,...(i.size3D?size:[size[0]]),...(i.rotation3D?rotation:[rotation[2]])];
 if(curves.some(c=>!c||![0,3].includes(c.minMaxState)||!Number.isFinite(c.scalar)||!Number.isFinite(c.minScalar??0)))reasons.push('initial-constant-or-two-constant-curves-required');
 if(size.filter((c,j)=>i.size3D||j===0).some(c=>c?.scalar<0||(c?.minMaxState===3&&c.minScalar<0)))reasons.push('negative-start-size-unmeasured');
 if(source.prewarm||i.randomizeRotationDirection||source.ShapeModule?.alignToDirection)reasons.push('initial-prewarm-flip-or-shape-alignment-unmeasured');
 const g=i.startColor,rgba=c=>['r','g','b','a'].map(k=>c?.[k]);
 const min=rgba(g?.minColor),max=rgba(g?.maxColor);
 if(![0,2].includes(g?.minMaxState)||[...max,...(g?.minMaxState===2?min:[])].some(x=>!Number.isFinite(x)||x<0||x>1))reasons.push('initial-normalized-constant-or-two-colors-required');
 return {autoRandomSeed:source.autoRandomSeed!==false&&source.autoRandomSeed!==0,randomSeed:Number(source.randomSeed||0)>>>0,size3D:!!i.size3D,rotation3D:!!i.rotation3D,
  lifetime:copy(i.startLifetime),speed:copy(i.startSpeed),size:size.map((c,j)=>copy(i.size3D?c:size[0])),rotation:rotation.map(copy),color:{min:g?.minMaxState===2?min:max,max,random:g?.minMaxState===2},reasons};
}
function stageInitialStateRuntime(options){
 if(options.dryRun)return;
 for(const name of ['UnityParticleInitialState','UnityParticleInitialStateAdapter','UnityParticleStartRotation']){
  const target=path.join(options.cocosRoot,'assets/script',name+'.ts'),text=fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8');
  fs.mkdirSync(path.dirname(target),{recursive:true});if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==text)fs.writeFileSync(target,text);
 }
}
function attachInitialStateRuntime(builder,reporter,options){
 const particles=builder.objects.map((p,id)=>({p,id})).filter(({p})=>p?.unityInitialStateContract);
 if(!particles.length)return;stageInitialStateRuntime(options);
 let classId=builder.cocosDb?.findScriptClass?.('UnityParticleInitialStateAdapter')?.classId;
 const meta=path.join(options.cocosRoot,'assets/script/UnityParticleInitialStateAdapter.ts.meta');
 if(!classId&&fs.existsSync(meta))classId=compressUuid(JSON.parse(fs.readFileSync(meta,'utf8')).uuid);
 for(const {p,id}of particles){
  const {reasons,...spec}=p.unityInitialStateContract,signs=p.unityRendererContract?.eulerSigns,node=builder.objects[p.node.__id__]?._name||'';
  if(reasons.length||!classId||signs?.length!==3){reporter.high('PARTICLE_INITIAL_STATE_ADAPTER_REQUIRED',options.src||'',node,reasons.join(', ')||(!classId?'Refresh AssetDB and rerun to import UnityParticleInitialStateAdapter':'Missing native renderer Euler signs'));continue;}
  builder.addComponent(p.node.__id__,classId,{source:{__id__:id},sourceContract:JSON.stringify({...spec,signs})},null,`cmp-unity-initial-state-${id}`);
 }
}
module.exports={initialStateContract,stageInitialStateRuntime,attachInitialStateRuntime};
