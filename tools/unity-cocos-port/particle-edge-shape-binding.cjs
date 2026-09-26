'use strict';
const fs=require('node:fs'),path=require('node:path');
const {compressUuid}=require('./core-utils');
function edgeShapeContract(source){
 const s=source.ShapeModule,e=source.EmissionModule;
 if(!s?.enabled||Number(s.type)!==12)return null;
 const reasons=[],r=s.radius;
 if(r?.mode!==1||r.spread!==0||r.speed?.minMaxState!==0||!Number.isFinite(r.value)||r.value<0||!Number.isFinite(r.speed?.scalar)||r.speed.scalar<0)reasons.push('edge-loop-constant-radius-speed-required');
 if(!e?.enabled||e.rateOverTime?.minMaxState!==0||!(e.rateOverTime.scalar>0)||e.rateOverDistance?.minMaxState!==0||e.rateOverDistance.scalar!==0||e.m_BurstCount||e.m_Bursts?.length)reasons.push('edge-continuous-constant-rate-required');
 if(source.prewarm||s.alignToDirection)reasons.push('edge-prewarm-or-align-unmeasured');
 return {radius:r?.value,speed:r?.speed?.scalar,reasons};
}
function stageEdgeShapeRuntime(options){
 if(options.dryRun)return;
 for(const name of ['UnityParticleEdgeShape','UnityParticleEdgeShapeAdapter','UnityParticleShapeDistribution']){
  const target=path.join(options.cocosRoot,'assets/script',name+'.ts'),text=fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8');
  fs.mkdirSync(path.dirname(target),{recursive:true});if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==text)fs.writeFileSync(target,text);
 }
}
function attachEdgeShapeRuntime(builder,reporter,options){
 const particles=builder.objects.map((p,id)=>({p,id})).filter(({p})=>p?.unityEdgeShapeContract);
 if(!particles.length)return;stageEdgeShapeRuntime(options);
 let classId=builder.cocosDb?.findScriptClass?.('UnityParticleEdgeShapeAdapter')?.classId;
 const meta=path.join(options.cocosRoot,'assets/script/UnityParticleEdgeShapeAdapter.ts.meta');
 if(!classId&&fs.existsSync(meta))classId=compressUuid(JSON.parse(fs.readFileSync(meta,'utf8')).uuid);
 for(const {p,id}of particles){
  const {reasons,...spec}=p.unityEdgeShapeContract,node=builder.objects[p.node.__id__]?._name||'';
  if(reasons.length||!classId){reporter.high('PARTICLE_EDGE_SHAPE_ADAPTER_REQUIRED',options.src||'',node,reasons.join(', ')||'Refresh AssetDB and rerun to import UnityParticleEdgeShapeAdapter');continue;}
  builder.addComponent(p.node.__id__,classId,{source:{__id__:id},sourceContract:JSON.stringify(spec)},null,`cmp-unity-edge-shape-${id}`);
  reporter.medium('PARTICLE_EDGE_LOOP_ENDPOINT_UNVERIFIED',options.src||'',node,'Native X segment and +Y direction restored; exact float loop wrap endpoint and random stream identity remain unverified.');
 }
}
module.exports={edgeShapeContract,stageEdgeShapeRuntime,attachEdgeShapeRuntime};
