'use strict';
const fs=require('node:fs'),path=require('node:path');
const {compressUuid}=require('./core-utils');
// A deliberately narrow invariant: a looping zero-size Box emitter with no
// random or moving inputs has no observable initialization RNG. Native captures
// cover this billboard subset; randomized, mesh and other module paths retain
// the prewarm obligation below.
function constantPointPrewarm(source){
 const i=source.InitialModule,s=source.ShapeModule,e=source.EmissionModule,u=source.UVModule;
 const constant=c=>c?.minMaxState===0&&Number.isFinite(c.scalar);
 if(!source.prewarm||!source.looping||!i||i.size3D||i.rotation3D||i.randomizeRotationDirection)return false;
 if(![i.startLifetime,i.startSpeed,i.startSize,i.startRotation,i.gravityModifier].every(constant)||i.startSpeed.scalar!==0||i.startRotation.scalar!==0||i.gravityModifier.scalar!==0)return false;
 if(i.startColor?.minMaxState!==0||!constant(source.startDelay)||source.startDelay.scalar!==0)return false;
 if(!s?.enabled||s.type!==5||!['x','y','z'].every(k=>s.m_Scale?.[k]===0)||s.alignToDirection||s.randomDirectionAmount||s.randomPositionAmount||s.sphericalDirectionAmount||s.m_Texture?.instanceID||s.m_Texture?.fileID)return false;
 if(!e?.enabled||!constant(e.rateOverTime)||!constant(e.rateOverDistance)||e.rateOverDistance.scalar!==0)return false;
 if((e.m_Bursts||[]).some(b=>!constant(b.countCurve)||b.probability!==1))return false;
 if(u?.enabled&&(!constant(u.startFrame)||![0,1].includes(u.frameOverTime?.minMaxState)))return false;
 return !Object.entries(source).some(([key,value])=>key.endsWith('Module')&&value?.enabled&&!['InitialModule','ShapeModule','EmissionModule','UVModule'].includes(key));
}
function nativeBurstCountContract(source){
 const e=source.EmissionModule,bursts=e?.m_Bursts||[],zero=c=>c?.minMaxState===0&&c.scalar===0;
 if(!e?.enabled||!bursts.length||!zero(source.startDelay)||e.rateOverTime?.minMaxState!==0||!Number.isFinite(e.rateOverTime.scalar)||e.rateOverTime.scalar<0||!zero(e.rateOverDistance))return null;
 if(bursts.some(b=>b.probability!==1||b.cycleCount!==1||b.countCurve?.minMaxState!==3||!Number.isFinite(b.time)||b.time<0||!Number.isInteger(b.countCurve.minScalar)||!Number.isInteger(b.countCurve.scalar)||b.countCurve.minScalar<0||b.countCurve.scalar<b.countCurve.minScalar||b.countCurve.scalar>65535))return null;
 if(bursts.some((b,i)=>i>0&&b.time<bursts[i-1].time))return null;
 return bursts.map(b=>({time:b.time,min:b.countCurve.minScalar,max:b.countCurve.scalar}));
}
function initialStateContract(source){
 const i=source.InitialModule;if(!i)return null;
 const burstRandom=nativeBurstCountContract(source);
 const reasons=[],rotation=[i.startRotationX,i.startRotationY,i.startRotation],size=[i.startSize,i.startSizeY,i.startSizeZ];
 const copy=c=>({minMaxState:c?.minMaxState??0,scalar:c?.scalar??0,minScalar:c?.minScalar??0});
 const curves=[i.startLifetime,i.startSpeed,...(i.size3D?size:[size[0]]),...(i.rotation3D?rotation:[rotation[2]])];
 if(curves.some(c=>!c||![0,3].includes(c.minMaxState)||!Number.isFinite(c.scalar)||!Number.isFinite(c.minScalar??0)))reasons.push('initial-constant-or-two-constant-curves-required');
 if(size.filter((c,j)=>i.size3D||j===0).some(c=>c?.scalar<0||(c?.minMaxState===3&&c.minScalar<0)))reasons.push('negative-start-size-unmeasured');
 if(source.prewarm||i.randomizeRotationDirection||source.ShapeModule?.alignToDirection)reasons.push('initial-prewarm-flip-or-shape-alignment-unmeasured');
 if(!burstRandom&&source.EmissionModule?.enabled&&(source.EmissionModule.m_Bursts||[]).some(b=>b.countCurve?.minMaxState===3&&b.countCurve.scalar!==b.countCurve.minScalar))reasons.push('random-burst-count-contract-unmeasured');
 const g=i.startColor,rgba=c=>['r','g','b','a'].map(k=>c?.[k]);
 const min=rgba(g?.minColor),max=rgba(g?.maxColor);
 if(![0,2].includes(g?.minMaxState)||[...max,...(g?.minMaxState===2?min:[])].some(x=>!Number.isFinite(x)||x<0||x>1))reasons.push('initial-normalized-constant-or-two-colors-required');
 return {...(burstRandom?{burstRandom}:{}),constantPrewarm:constantPointPrewarm(source),autoRandomSeed:source.autoRandomSeed!==false&&source.autoRandomSeed!==0,randomSeed:Number(source.randomSeed||0)>>>0,size3D:!!i.size3D,rotation3D:!!i.rotation3D,
  lifetime:copy(i.startLifetime),speed:copy(i.startSpeed),size:size.map((c,j)=>copy(i.size3D?c:size[0])),rotation:rotation.map(copy),color:{min:g?.minMaxState===2?min:max,max,random:g?.minMaxState===2},reasons};
}
function stageInitialStateRuntime(options){
 if(options.dryRun)return;
 for(const name of ['UnityParticleShapeRandom','UnityParticleNativeRadius','UnityParticleSizeRandom','UnityParticleInitialState','UnityParticleInitialStateAdapter','UnityParticleStartRotation','UnityParticleBurstRandom']){
  const target=path.join(options.cocosRoot,'assets/script',name+'.ts'),text=fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8');
  fs.mkdirSync(path.dirname(target),{recursive:true});if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==text)fs.writeFileSync(target,text);
 }
}
// Serialized adapter contract of one particle (spec minus porter-only fields, native radius
// version and renderer Euler signs).
function adapterContract(p,version){
 const {reasons,constantPrewarm,...spec}=p.unityInitialStateContract,signs=p.unityRendererContract?.eulerSigns;
 return JSON.stringify({...spec,...(version==='6000.3.1f1'?{nativeRadiusVersion:version}:{}),signs,...(p.unityRendererContract?.meshScalarAxis?{meshScalarAxis:true}:{})});
}
// A flattened nested particle prefab is built (and its adapters attached) from the source prefab,
// then the PrefabInstance m_Modifications are merged into the particle (applyUnityParticleDataToCocos
// recomputes unityInitialStateContract). The adapter must follow the merged contract, otherwise the
// runtime re-samples the source prefab's start lifetime/speed/size/rotation/colour and silently undoes
// the instance override (ScrewOut SOF_Box/smoke: startSize 0.85-1.1 instead of the override 1.5-2).
function refreshInitialStateContract(builder,particleId,reporter,options={}){
 const p=builder.objects[particleId];if(!p?.unityInitialStateContract)return 0;
 let refreshed=0;
 for(const c of builder.objects){
  if(!c||c.source?.__id__!==particleId||typeof c.sourceContract!=='string')continue;
  const fileId=builder.objects[c.__prefab?.__id__]?.fileId||'';
  if(!fileId.startsWith('cmp-unity-initial-state-'))continue;
  const node=builder.objects[p.node?.__id__]?._name||'';
  if(p.unityInitialStateContract.reasons.length){reporter?.high?.('PARTICLE_INITIAL_STATE_ADAPTER_REQUIRED',options.src||'',node,'Instance override: '+p.unityInitialStateContract.reasons.join(', '));continue;}
  let version=null;try{version=JSON.parse(c.sourceContract).nativeRadiusVersion||null;}catch{}
  const next=adapterContract(p,version);
  if(next!==c.sourceContract){c.sourceContract=next;refreshed++;reporter?.low?.('PARTICLE_INITIAL_STATE_OVERRIDE_SYNCED',options.src||'',node,'Initial-state adapter contract re-derived from the prefab instance overrides');}
 }
 return refreshed;
}
function attachInitialStateRuntime(builder,reporter,options){
 const particles=builder.objects.map((p,id)=>({p,id})).filter(({p})=>p?.unityInitialStateContract);
 if(!particles.length)return;stageInitialStateRuntime(options);
 let unityRoot=path.resolve(options.unityRoot||'');if(path.basename(unityRoot).toLowerCase()==='assets')unityRoot=path.dirname(unityRoot);
 const versionFile=path.join(unityRoot,'ProjectSettings/ProjectVersion.txt');
 const version=fs.existsSync(versionFile)?/^m_EditorVersion:\s*(\S+)/m.exec(fs.readFileSync(versionFile,'utf8'))?.[1]:null;
 let classId=builder.cocosDb?.findScriptClass?.('UnityParticleInitialStateAdapter')?.classId;
 const meta=path.join(options.cocosRoot,'assets/script/UnityParticleInitialStateAdapter.ts.meta');
 if(!classId&&fs.existsSync(meta))classId=compressUuid(JSON.parse(fs.readFileSync(meta,'utf8')).uuid);
 for(const {p,id}of particles){
  const {reasons,constantPrewarm,...spec}=p.unityInitialStateContract,signs=p.unityRendererContract?.eulerSigns,node=builder.objects[p.node.__id__]?._name||'';
  if(constantPrewarm&&p.unityRendererContract?.mode===0&&reasons.length===1&&reasons[0]==='initial-prewarm-flip-or-shape-alignment-unmeasured'){
   reporter.low('PARTICLE_INITIAL_STATE_CONSTANT_PREWARM',options.src||'',node,'Native-verified constant point billboard initialization; prewarm timing uses UnityParticlePrewarmAdapter. No initialization RNG claim.');continue;
  }
  if(reasons.length||!classId||signs?.length!==3){reporter.high('PARTICLE_INITIAL_STATE_ADAPTER_REQUIRED',options.src||'',node,reasons.join(', ')||(!classId?'Refresh AssetDB and rerun to import UnityParticleInitialStateAdapter':'Missing native renderer Euler signs'));continue;}
  builder.addComponent(p.node.__id__,classId,{source:{__id__:id},sourceContract:adapterContract(p,version)},null,`cmp-unity-initial-state-${id}`);
 }
}
module.exports={nativeBurstCountContract,initialStateContract,refreshInitialStateContract,constantPointPrewarm,stageInitialStateRuntime,attachInitialStateRuntime};
