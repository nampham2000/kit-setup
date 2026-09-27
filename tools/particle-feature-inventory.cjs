'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
function inventory(source){
 const prefabs=[...(source.prefabs||[]),...(source.dependencyPrefabs||[])],materials=new Map((source.materials||[]).map(m=>[m.path,m.shader])),counts={},effects=[];let systems=0;
 for(const prefab of prefabs){const features=new Set();let count=0;
  for(const node of prefab.nodes||[])for(const component of node.components||[]){
   if(component.type!=='UnityEngine.ParticleSystem')continue;
   const s=JSON.parse(component.json).ParticleSystem;if(!s)throw Error('Missing ParticleSystem source');count++;systems++;
   for(const [key,value]of Object.entries(s))if(key.endsWith('Module')&&value?.enabled){counts[key]=(counts[key]||0)+1;features.add('module:'+key);}
   const renderer=(node.components||[]).find(c=>c.type==='UnityEngine.ParticleSystemRenderer'),r=renderer?JSON.parse(renderer.json).ParticleSystemRenderer:null;
   const mode=r?.m_RenderMode;features.add('renderer:'+(mode??'unknown'));
   // Unity serialized moveWithTransform: 0 Local, 1 World, 2 Custom.
   features.add('source-space-scale:'+(s.moveWithTransform??s.simulationSpace??'unknown')+':'+(s.scalingMode??'unknown'));
   for(const material of renderer?.materials||[])if(material)features.add('shader-renderer:'+materials.get(material)+':'+mode);
   if(s.NoiseModule?.enabled){features.add('noise-quality:'+s.NoiseModule.quality);features.add('noise-strength-mode:'+s.NoiseModule.strength?.minMaxState);if(s.NoiseModule.sizeAmount?.scalar)features.add('interaction:noise-size');}
   if(s.ForceModule?.enabled)features.add('force:'+s.ForceModule.randomizePerFrame+':'+s.ForceModule.inWorldSpace);
   if(s.ShapeModule?.enabled){features.add('shape:'+s.ShapeModule.type);if(s.ShapeModule.alignToDirection)features.add('interaction:shape-alignment-speed-'+(s.InitialModule?.startSpeed?.scalar===0?'zero':'nonzero'));}
   if(s.TrailModule?.enabled&&mode===1)features.add('interaction:stretched-trails');
   if(s.SubModule?.enabled&&s.CollisionModule?.enabled)features.add('interaction:collision-subemitter');
  }
  effects.push({prefab:prefab.path,systems:count,features:[...features].sort()});
 }
 const uncovered=new Set(effects.flatMap(e=>e.features)),representatives=[];
 while(uncovered.size){let best=null,added=[];for(const e of effects){const a=e.features.filter(f=>uncovered.has(f));if(a.length>added.length){best=e;added=a;}}if(!best)break;representatives.push({prefab:best.prefab,newFeatures:added});for(const f of added)uncovered.delete(f);}
 return {schemaVersion:1,scope:'Source feature triage only. Representatives cover observed feature signatures, not all interactions or visual acceptance. Every catalog effect still needs phase validation.',prefabs:prefabs.length,primaryPrefabs:(source.prefabs||[]).length,systems,moduleCounts:counts,featureCount:new Set(effects.flatMap(e=>e.features)).size,representatives,effects};
}
if(require.main===module){const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--source'||args[2]!=='--out')throw Error('Usage: node particle-feature-inventory.cjs --source live-rendering.json --out inventory.json');const raw=fs.readFileSync(args[1]),r=inventory(JSON.parse(raw));r.sourceSha256=crypto.createHash('sha256').update(raw).digest('hex');fs.writeFileSync(args[3],JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({prefabs:r.prefabs,systems:r.systems,features:r.featureCount,representatives:r.representatives.length}));}
module.exports={inventory};
