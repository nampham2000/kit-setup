'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto'),ts=require('typescript');
const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleBirthState.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(out,()=>({Mat4:class{}}));
const mul=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const inv=q=>[-q[0],-q[1],-q[2],q[3]],rotate=(q,v)=>mul(mul(q,[...v,0]),inv(q)).slice(0,3);
function quat(e){const axis=(i)=>{const a=e[i]*Math.PI/360,q=[0,0,0,Math.cos(a)];q[i]=Math.sin(a);return q;};return mul(mul(axis(1),axis(0)),axis(2));}
test('36 native frame trajectories: unit scale or local simulation with uniform scale',()=>{
 const f=require('./fixtures/module-frame-native.json');assert.equal(f.isPlaying,true);assert.equal(f.rows.length,72);
 assert.equal(f.sourceProbeSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/capture-module-frame.cs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'));
 const rows=f.rows.filter(r=>r.scale[0]===r.scale[1]&&r.scale[1]===r.scale[2]&&(r.local||r.scale[0]===1));assert.equal(rows.length,36);
 for(const r of rows){const q=quat(r.euler),p=[0,0,0],v=[0,0,0];let updates=0;
  const module={enable:true,frame:null,update(space,matrix){updates++;this.frame=(space===0)===r.worldModule?null:space===0?matrix.q:inv(matrix.q);matrix.q=null;}};
  const system={simulationSpace:r.local?1:0,node:{getWorldMatrix(m){m.q=q;}},processor:{setNewParticle(){},updateParticles(dt){const value=module.frame?rotate(module.frame,[1,3,2]):[1,3,2];for(let a=0;a<3;a++){if(r.force)v[a]+=value[a]*dt;else v[a]=value[a];p[a]+=v[a]*dt;}return 1;}}};
  system[r.force?'forceOvertimeModule':'velocityOvertimeModule']=module;out.installUnityParticleBirthState(system);
  for(const frame of r.steps){system.processor.updateParticles(f.dt);const world=r.local?rotate(q,p.map(x=>x*r.scale[0])):p;for(let a=0;a<3;a++){assert.ok(Math.abs(p[a]-frame.position[a])<4e-6,JSON.stringify({r:{local:r.local,world:r.worldModule,force:r.force},a,p,expected:frame.position}));assert.ok(Math.abs(world[a]-frame.world[a])<5e-6);}}
  assert.equal(updates,12);
 }
});
test('each module receives a fresh matrix, and updated node frames precede particle simulation',()=>{
 let generation=0;const seen=[];const make=()=>({enable:true,update(space,m){seen.push(m.generation);m.generation=-1;}});
 const s={simulationSpace:1,node:{getWorldMatrix(m){m.generation=generation;}},velocityOvertimeModule:make(),forceOvertimeModule:make(),limitVelocityOvertimeModule:make(),processor:{setNewParticle(){},updateParticles(){assert.deepEqual(seen.slice(-3),[generation,generation,generation]);return 9;}}};
 out.installUnityParticleBirthState(s);assert.equal(s.processor.updateParticles(.1),9);generation=7;s.processor.updateParticles(.1);assert.deepEqual(seen,[0,0,0,7,7,7]);
});

