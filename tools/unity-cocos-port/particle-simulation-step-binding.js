'use strict';
const fs=require('node:fs'),path=require('node:path');
const {compressUuid}=require('./core-utils');
const {writeGeneratedAssetText}=require('./generated-asset-writer.cjs');
function maximumParticleDeltaTime(unityRoot) {
  const file=path.join(unityRoot||'','ProjectSettings/TimeManager.asset');
  if(!fs.existsSync(file))return null;
  const match=/^\s*Maximum Particle Timestep:\s*([^\r\n]+)/m.exec(fs.readFileSync(file,'utf8'));
  const value=Number(match?.[1]);return value>0&&Number.isFinite(value)?value:null;
}
function sourceGravityY(unityRoot) {
  const file=path.join(unityRoot||'','ProjectSettings/DynamicsManager.asset');
  if(!fs.existsSync(file))return null;
  const match=/m_Gravity:\s*\{[^}]*\by:\s*([^,}]+)/.exec(fs.readFileSync(file,'utf8'));
  const value=Number(match?.[1]);return match&&Number.isFinite(value)?value:null;
}
function attachSimulationStepRuntime(builder,reporter,options) {
  const systems=builder.objects.map((p,id)=>({p,id})).filter(({p})=>p?.__type__==='cc.ParticleSystem');
  if(!systems.length)return;
  const maximumDeltaTime=maximumParticleDeltaTime(options.unityRoot);
  if(maximumDeltaTime===null) {
    reporter.high('PARTICLE_TIMESTEP_SOURCE_REQUIRED',options.src||'','',
      'Read Maximum Particle Timestep from source ProjectSettings/TimeManager.asset; a guessed timestep cannot verify short emission windows.');return;
  }
  if(!options.dryRun)for(const name of ['UnityParticleSimulationStep','UnityParticleSimulationStepAdapter','UnityParticleBirthTiming','UnityRandomForceKernel','UnityParticleRandomForce']) {
    const target=path.join(options.cocosRoot,'assets/script',name+'.ts');
    writeGeneratedAssetText(target,fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{cocosRoot:options.cocosRoot});
  }
  let classId=builder.cocosDb?.findScriptClass?.('UnityParticleSimulationStepAdapter')?.classId;
  const meta=path.join(options.cocosRoot,'assets/script/UnityParticleSimulationStepAdapter.ts.meta');
  if(!classId&&fs.existsSync(meta))classId=compressUuid(JSON.parse(fs.readFileSync(meta,'utf8')).uuid);
  const gravityY=sourceGravityY(options.unityRoot);
  for(const {p,id} of systems) {
    if(!classId){reporter.high('PARTICLE_TIMESTEP_ADAPTER_REQUIRED',options.src||'',builder.objects[p.node.__id__]?._name||'',
      'Refresh AssetDB to register UnityParticleSimulationStepAdapter.ts, then rerun porter.');continue;}
    if(p.unityForceContract?.unsupported)reporter.high('PARTICLE_RANDOM_FORCE_UNVERIFIED',options.src||'',builder.objects[p.node.__id__]?._name||'',p.unityForceContract.unsupported);
    builder.addComponent(p.node.__id__,classId,{source:{__id__:id},maximumDeltaTime,...(gravityY!==null?{gravityY}:{}),
      ...(p.unityForceContract&&!p.unityForceContract.unsupported?{sourceForceContract:JSON.stringify(p.unityForceContract)}:{})},null,`cmp-unity-simulation-step-${id}`);
  }
}
module.exports={maximumParticleDeltaTime,sourceGravityY,attachSimulationStepRuntime};
