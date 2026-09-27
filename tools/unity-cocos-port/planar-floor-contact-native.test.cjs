'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
const fixture=require('./fixtures/planar-floor-contacts-native.json'),out={};
new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityPlanarMeshContactGate.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(out);
test('native floor fixture binds producer and imported collision observer',()=>{
 assert.equal(fixture.rows.length,144);assert.equal(fixture.playing,true);
 for(const [file,hash] of Object.entries(fixture.sourceHashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures',file),'utf8').replace(/\r\n/g,'\n')).digest('hex'),hash);
});
test('float32 front-face gate matches all 1248 measured frozen-sphere interior contacts',()=>{
 let checked=0,excluded=0;
 for(const row of fixture.rows.filter(r=>r.frozen)){
  const gate=new out.UnityPlanarMeshContactGate(fixture.meshPositions,fixture.meshIndices,row.scale);let touching=false;
  for(const sample of row.samples){for(const event of row.events.filter(e=>e.step===sample.step))touching=event.phase!=='exit';
   const actual=gate.testSphereInterior(...sample.position,.5);
   if(actual===null){excluded++;continue;}checked++;
   assert.equal(actual,touching,`scale=${row.scale}, z=${row.z}, Translate=${row.translate}, step=${sample.step}`);
  }
 }
 assert.equal(checked,1248);assert.equal(excluded,192);
});
test('off-plane centers and border contacts remain backend-owned',()=>{
 const gate=new out.UnityPlanarMeshContactGate(fixture.meshPositions,fixture.meshIndices,3);
 assert.equal(gate.testSphereInterior(0,.01,0,.5),null);
 assert.equal(gate.testSphereInterior(14.8,0,0,.5),null);
 assert.equal(gate.testSphereInterior(Infinity,0,0,.5),null);
 assert.equal(gate.testSphereInterior(0,0,0,0),null);
 assert.throws(()=>new out.UnityPlanarMeshContactGate([0,1,0,1,1,0,0,1,1],[0,1,2],1),/near-XZ/);
});
