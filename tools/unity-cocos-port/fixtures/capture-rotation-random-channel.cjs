'use strict';
// Extract a retained angular RNG oracle from automatic native particle captures.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
const inputs=[],hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function read(file){inputs.push({file,sha256:hash(path.join(root,file))});return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));}
const o=read('tools/combat-magic/oracles/live-rendering.json'),rows=[];
for(const name of ['black-arc-tornado','fire-tornado','volcanic-tornado','lightning-tornado']){
 const p=o.prefabs.find(p=>p.path.endsWith('/'+name+'.prefab')),native=read('tools/combat-magic/oracles/reference-phases/'+name+'/1280x720/manifest.json');
 if(!native.complete||native.colorSpace!=='Linear'||native.renderPipeline!=='Built-in')throw Error('Incomplete native source '+name);
 for(const node of p.nodes){const c=node.components.find(c=>c.type==='UnityEngine.ParticleSystem');if(!c)continue;
 const s=Object.values(JSON.parse(c.json))[0],m=s.RotationModule,curve=m.curve;if(!m.enabled||m.separateAxes||curve.minMaxState!==3||curve.scalar===curve.minScalar||!node.path.split('/').pop().startsWith('tornado-'))continue;
 if(s.NoiseModule.enabled&&s.NoiseModule.rotationAmount?.scalar)throw Error('Noise rotation contaminates the retained channel');
 for(const [from,to] of [[6,18],[18,36],[36,60]]){
  const a=native.frames.find(f=>f.frame===from).systems.find(n=>n.path.replaceAll('(Clone)','')===node.path),b=native.frames.find(f=>f.frame===to).systems.find(n=>n.path.replaceAll('(Clone)','')===node.path);
  for(const x of a.particles){const y=b.particles.find(y=>y.randomSeed===x.randomSeed);if(!y)continue;
   const seconds=(to-from)*Math.fround(1/60)*s.simulationSpeed,rate=(y.rotation[2]-x.rotation[2])*Math.PI/180/seconds;
   rows.push({effect:name,node:node.path,seed:x.randomSeed,from,to,seconds,min:curve.minScalar,max:curve.scalar,rotationBefore:x.rotation[2],rotationAfter:y.rotation[2],rate,random:(rate-curve.minScalar)/(curve.scalar-curve.minScalar)});
  }
 }
 }
}
const producerSha256=crypto.createHash('sha256').update(fs.readFileSync(__filename,'utf8').replace(/\r\n/g,'\n')).digest('hex');
fs.writeFileSync(output,JSON.stringify({schemaVersion:1,producerHashContract:'sha256-text-lf-v1',measurement:'Automatic native Particle.rotation3D deltas; float32 integration error bounded separately from random-channel identity.',producerSha256,inputs,rows},null,2)+'\n');
console.log(JSON.stringify({rows:rows.length,seeds:new Set(rows.map(r=>r.seed)).size}));
