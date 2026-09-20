'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const fixture=require('./fixtures/particle-orbit-world.json');
const m={exports:{}};
new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleOrbit.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(m.exports,m,()=>({}));
const transform=(m,v,w)=>[0,1,2].map(i=>m[i]*v[0]+m[4+i]*v[1]+m[8+i]*v[2]+w*m[12+i]);
test('world orbital frame matches 9 native translated, rotated and nonuniform-scale holdouts',()=>{
 let max=0;
 for(const c of fixture.cases){
  let pos=c.samples[0].position;const velocity=c.samples[0].velocity,out=new Float64Array(3);
  for(const row of c.samples.slice(1)){
   const local=transform(c.inverse,pos,1);
   m.exports.orbitalDelta(out,...local,...c.omega,c.radial,c.dt);
   const delta=transform(c.matrix,Array.from(out,(v,i)=>v+c.linear[i]),0);
   pos=pos.map((v,i)=>v+c.dt*(delta[i]+velocity[i]));
   max=Math.max(max,Math.hypot(...pos.map((v,i)=>v-row.position[i])));
  }
 }
 assert.ok(max<.00002,`Native world motion error: ${max}`);
});
test('native world fixture binds its producer',()=>{
 const text=fs.readFileSync(path.join(__dirname,'fixtures/capture-orbit-world.cs'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(crypto.createHash('sha256').update(text).digest('hex'),fixture.sourceProbeSha256);
});
