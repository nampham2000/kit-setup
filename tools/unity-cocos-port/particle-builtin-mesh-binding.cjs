'use strict';
const fs=require('node:fs'),path=require('node:path');
const {compressUuid}=require('./core-utils');
const {writeGeneratedAssetText}=require('./generated-asset-writer.cjs');
function attachBuiltinMeshRuntime(builder,reporter,options){
 const particles=builder.objects.map((p,id)=>({p,id})).filter(({p})=>p?.unityBuiltinMeshFileId==='10207');
 if(!particles.length)return;
 let root=path.resolve(options.unityRoot||'');if(path.basename(root).toLowerCase()==='assets')root=path.dirname(root);
 const versionFile=path.join(root,'ProjectSettings/ProjectVersion.txt');
 const version=fs.existsSync(versionFile)?/^m_EditorVersion:\s*(\S+)/m.exec(fs.readFileSync(versionFile,'utf8'))?.[1]:null;
 if(version!=='6000.3.1f1'){reporter.high('PARTICLE_NATIVE_PRIMITIVE_VERSION_UNVERIFIED',options.src||'','','Native Sphere topology/UV fixture was captured on Unity 6000.3.1f1; export this source version before claiming primitive parity.');return;}
 if(!options.dryRun)for(const name of ['UnityParticleBuiltinMeshAdapter','UnityParticleBuiltinMeshData'])writeGeneratedAssetText(path.join(options.cocosRoot,'assets/script',name+'.ts'),fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{cocosRoot:options.cocosRoot});
 let classId=builder.cocosDb?.findScriptClass?.('UnityParticleBuiltinMeshAdapter')?.classId;
 const meta=path.join(options.cocosRoot,'assets/script/UnityParticleBuiltinMeshAdapter.ts.meta');
 if(!classId&&fs.existsSync(meta))classId=compressUuid(JSON.parse(fs.readFileSync(meta,'utf8')).uuid);
 for(const {p,id} of particles){const name=builder.objects[p.node.__id__]?._name||'';
  if(!classId){reporter.high('PARTICLE_NATIVE_PRIMITIVE_IMPORT_REQUIRED',options.src||'',name,'Refresh AssetDB for native Sphere runtime, then rerun the affected prefab.');continue;}
  builder.addComponent(p.node.__id__,classId,{source:{__id__:id}},null,'cmp-unity-native-primitive-'+id);
  reporter.low('PARTICLE_NATIVE_PRIMITIVE_BOUND',options.src||'',name,'Native Sphere vertex topology and UVs replace approximate Cocos primitive at initialization; visual verification still required.');
 }
}
module.exports={attachBuiltinMeshRuntime};
