'use strict';
// Extract measured native Play Mode BakeMesh data; never synthesize reference vertices.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(process.argv[2]),out=path.join(__dirname,'trail-playback-native.json');
const oracle=JSON.parse(fs.readFileSync(path.join(root,'tools/combat-magic/oracles/live-rendering.json')));
const prefab=oracle.prefabs.find(p=>p.index===59),node=prefab.nodes.find(n=>n.components.some(c=>c.type==='UnityEngine.TrailRenderer'));
const source=JSON.parse(node.components.find(c=>c.type==='UnityEngine.TrailRenderer').json).TrailRenderer;
const file=path.join(root,'tools/combat-magic/oracles/reference-detailed/fire-fireball/1280x720/manifest.json');
const manifest=JSON.parse(fs.readFileSync(file));if(!manifest.complete||manifest.error)throw new Error('Incomplete native trail capture');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')).digest('hex');
const result={unityVersion:manifest.unityVersion,sourcePrefab:prefab.path,source,producerSha256:hash(__filename),captureProducerSha256:hash(path.resolve(__dirname,'../../../packages/unity-intelligence/Capture/Editor/ReferenceCapture.cs')),nativeManifestSha256:hash(file),cameraForward:[0,-Math.sin(Math.PI/12),Math.cos(Math.PI/12)],frames:manifest.frames.map(f=>({frame:f.frame,time:f.time,trail:f.trails[0]}))};
fs.writeFileSync(out,JSON.stringify(result)+'\n');console.log(JSON.stringify({out,frames:result.frames.length}));
