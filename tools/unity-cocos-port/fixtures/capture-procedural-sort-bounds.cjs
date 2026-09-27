'use strict';
// Extract source-bound observations from real automatic ReferenceCapture frames.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('Usage: node capture-procedural-sort-bounds.cjs --project=<port-project> --out=<fixture.json>');process.exit(0);}
if(args.length!==2||!args[0].startsWith('--project=')||!args[1].startsWith('--out='))throw Error('Expected --project and --out');
const root=path.resolve(args[0].slice(10)),destination=path.resolve(args[1].slice(6));
const {unityProceduralSortCenter}=require('../particle-procedural-sort-center.cjs');
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f)));
const corpus='tools/combat-magic/oracles/live-rendering.json',original=read('tools/combat-magic/oracles/original-source.json');
const cases=[],manifests={};
for(const prefab of read(corpus).prefabs){
 if(!['black-arc','blood-fx','fire-fx','frost-fx','hex-fx'].some(group=>prefab.path.includes('/resources/'+group+'/')))continue;
 const name=path.basename(prefab.path,'.prefab'),file='tools/combat-magic/oracles/reference-phases/'+name+'/1280x720/manifest.json',native=read(file);
 if(!native.complete||native.renderPipeline!=='Built-in'||native.pixelLightCount!==150||native.lightsUseLinearIntensity!==false)throw Error('Wrong native render state '+name);
 manifests[file]=hash(fs.readFileSync(path.join(root,file)));
 for(const node of prefab.nodes){
  const component=node.components.find(c=>c.type==='UnityEngine.ParticleSystem');if(!component)continue;
  const source=JSON.parse(component.json).ParticleSystem;if(!unityProceduralSortCenter(source))continue;
  const curve=c=>({minMaxState:c.minMaxState,scalar:c.scalar,minScalar:c.minScalar});
  const input={moveWithTransform:source.moveWithTransform,scalingMode:source.scalingMode,ringBufferMode:source.ringBufferMode,
   InitialModule:{gravityModifier:curve(source.InitialModule.gravityModifier),startSpeed:curve(source.InitialModule.startSpeed),startLifetime:curve(source.InitialModule.startLifetime)},
   ShapeModule:Object.fromEntries(['enabled','type','arc','radius','m_Position','m_Rotation','m_Scale','randomDirectionAmount','sphericalDirectionAmount','randomPositionAmount','alignToDirection'].map(k=>[k,source.ShapeModule[k]]))};
  input.ShapeModule.arc={value:source.ShapeModule.arc.value,mode:source.ShapeModule.arc.mode};input.ShapeModule.radius={value:source.ShapeModule.radius.value};
  for(const [key,value] of Object.entries(source))if(key.endsWith('Module')&&key!=='InitialModule'&&key!=='ShapeModule')input[key]={enabled:value.enabled};
  const samples=[];
  for(const frame of native.frames.filter(f=>f.frame>0)){
   const system=frame.systems.find(s=>s.path.replaceAll('(Clone)','')===node.path);
   if(system?.count)samples.push({frame:frame.frame,count:system.count,matrix:system.matrix,center:system.boundsCenter});
  }
  if(samples.length)cases.push({effect:name,path:node.path,input,samples});
 }
}
const fixture={sourceCommit:original.commit,sourceCorpusSha256:hash(fs.readFileSync(path.join(root,corpus))),producerSha256LF:hash(fs.readFileSync(__filename,'utf8').replace(/\r\n/g,'\n')),
 referenceCaptureSha256LF:hash(fs.readFileSync(path.join(root,'playable-shared-kit/packages/unity-intelligence/Capture/Editor/ReferenceCapture.cs'),'utf8').replace(/\r\n/g,'\n')),
 scope:'Automatic local-space Hierarchy procedural bounds; full arcs, unrotated shapes, gated motion modules. Numeric bounds observations, not whole-effect visual acceptance.',manifests,cases};
const text=JSON.stringify(fixture)+'\n';if(!fs.existsSync(destination)||fs.readFileSync(destination,'utf8')!==text)fs.writeFileSync(destination,text);
console.log(JSON.stringify({cases:cases.length,samples:cases.reduce((n,c)=>n+c.samples.length,0)}));
