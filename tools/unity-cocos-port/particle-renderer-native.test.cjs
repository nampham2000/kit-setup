'use strict';
const fs=require('node:fs'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const shader=fs.readFileSync(path.join(__dirname,'source-particle.effect'),'utf8');
const expression=shader.match(/return vec4\(([\s\S]*?)\);/)[1];
const evaluate=new Function('s','c',`return [${expression}];`);
function q(a){const h=a.map(v=>v*Math.PI/360);return evaluate({x:Math.sin(h[0]),y:Math.sin(h[1]),z:Math.sin(h[2])},{x:Math.cos(h[0]),y:Math.cos(h[1]),z:Math.cos(h[2])});}
function rotate([vx,vy,vz],[x,y,z,w]){const tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);return[vx+w*tx+y*tz-z*ty,vy+w*ty+z*tx-x*tz,vz+w*tz+x*ty-y*tx];}
for(const sample of require('./fixtures/local-billboard-native.json'))test(`native Local billboard ${sample.angles} under parent ${sample.parent}`,()=>{
  const particle=q(sample.angles.map((v,i)=>i===2?-v:v));
  const parent=q(sample.parent.map((v,i)=>i===2?v:-v));
  for(let i=0;i<sample.vertices.length;i++){
    const uv=sample.uv[i],actual=rotate(rotate([2*uv[0]-1,2*uv[1]-1,0],particle),parent);
    const expected=sample.vertices[i].map((v,j)=>j===2?-v:v);
    for(let j=0;j<3;j++)assert.ok(Math.abs(actual[j]-expected[j])<1e-6,`vertex ${i}.${j}: ${actual[j]} vs ${expected[j]}`);
  }
});
