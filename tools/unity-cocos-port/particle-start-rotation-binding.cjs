'use strict';
const fs=require('node:fs'),path=require('node:path');
const {compressUuid}=require('./core-utils');
const names=['UnityParticleStartRotation','UnityParticleStartRotationAdapter'];
function startRotationContract(source){
 const i=source.InitialModule;
 if(Number(i?.rotation3D)!==1||![i.startRotationX,i.startRotationY].some(c=>c?.minMaxState===3&&c.scalar!==c.minScalar))return null;
 const curves=[i.startRotationX,i.startRotationY,i.startRotation],reasons=[];
 if(curves.some(c=>!c||![0,3].includes(c.minMaxState)||!Number.isFinite(c.scalar)||!Number.isFinite(c.minScalar??0)))reasons.push('start-rotation-curves');
 if(i.randomizeRotationDirection)reasons.push('flip-rotation');
 if(source.prewarm)reasons.push('prewarm-before-adapter-start');
 if(Number(source.ShapeModule?.alignToDirection)===1)reasons.push('shape-align-to-direction');
 const copy=c=>c&&({minMaxState:c.minMaxState,scalar:c.scalar,minScalar:c.minScalar??0});
 return {autoRandomSeed:source.autoRandomSeed!==false&&source.autoRandomSeed!==0,randomSeed:Number(source.randomSeed||0)>>>0,size3D:Number(i.size3D)===1,
  x:copy(curves[0]),y:copy(curves[1]),z:copy(curves[2]),reasons};
}
function stageStartRotationRuntime(options){
 if(options.dryRun)return;
 for(const name of names){const target=path.join(options.cocosRoot,'assets/script',name+'.ts'),source=fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8');fs.mkdirSync(path.dirname(target),{recursive:true});if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==source)fs.writeFileSync(target,source);}
}
function attachStartRotationRuntime(builder,reporter,options){
 const particles=builder.objects.map((p,id)=>({p,id})).filter(({p})=>p?.unityStartRotationContract);
 if(!particles.length)return;stageStartRotationRuntime(options);
 let classId=builder.cocosDb?.findScriptClass?.('UnityParticleStartRotationAdapter')?.classId;
 const meta=path.join(options.cocosRoot,'assets/script/UnityParticleStartRotationAdapter.ts.meta');
 if(!classId&&fs.existsSync(meta))classId=compressUuid(JSON.parse(fs.readFileSync(meta,'utf8')).uuid);
 for(const {p,id} of particles){
  const {reasons,...spec}=p.unityStartRotationContract,signs=p.unityRendererContract?.eulerSigns;
  if(reasons.length||!classId||signs?.length!==3){reporter.high('PARTICLE_START_ROTATION_ADAPTER_REQUIRED',options.src||'',builder.objects[p.node.__id__]?._name||'',reasons.length?reasons.join(', '):!classId?'AssetDB must import UnityParticleStartRotationAdapter; refresh and rerun':'Missing native renderer Euler signs');continue;}
  builder.addComponent(p.node.__id__,classId,{source:{__id__:id},sourceContract:JSON.stringify({...spec,signs})},null,`cmp-unity-start-rotation-${id}`);
  reporter.low('PARTICLE_START_ROTATION_ADAPTER_BOUND',options.src||'',builder.objects[p.node.__id__]?._name||'','Independent native automatic-birth XYZ rotation bound; full emission schedule and visual acceptance remain separate gates.');
 }
}
module.exports={startRotationContract,stageStartRotationRuntime,attachStartRotationRuntime};
