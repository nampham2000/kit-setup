'use strict';
const fs=require('fs'),path=require('path'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
class V{constructor(x=0,y=0,z=0){this.set(x,y,z);}set(x,y,z){if(typeof x==='object')Object.assign(this,{x:x.x,y:x.y,z:x.z});else Object.assign(this,{x,y,z});}}
const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleModuleScale.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(out,()=>({Vec3:V}));
function quat(e){const [x,y,z]=e.map(v=>v*Math.PI/360),sx=Math.sin(x),cx=Math.cos(x),sy=Math.sin(y),cy=Math.cos(y),sz=Math.sin(z),cz=Math.cos(z);return {x:sx*cy*cz+cx*sy*sz,y:cx*sy*cz-sx*cy*sz,z:cx*cy*sz-sx*sy*cz,w:cx*cy*cz+sx*sy*sz};}
test('72 native Hierarchy module trajectories include scaled world and nonuniform local frames',()=>{
 const f=require('./fixtures/module-frame-native.json');assert.equal(f.rows.length,72);
 for(const r of f.rows)for(const reflect of [false,true]){const zsign=reflect?-1:1;
  const module={enable:true,space:r.worldModule?0:1,needTransform:true,speedModifier:{mode:0,evaluate(){return 1;}},animate(p,dt){assert.equal(this.needTransform,false);if(r.force){p.velocity.x+=dt;p.velocity.y+=3*dt;p.velocity.z+=2*zsign*dt;p.ultimateVelocity.set(p.velocity);}else {p.animatedVelocity.set(1,3,2*zsign);p.ultimateVelocity.set(p.velocity.x+1,p.velocity.y+3,p.velocity.z+2*zsign);}}};
  const s={simulationSpace:r.local?1:0,node:{worldRotation:quat(reflect?[-r.euler[0],-r.euler[1],r.euler[2]]:r.euler),worldScale:new V(...r.scale)}};s[r.force?'forceOvertimeModule':'velocityOvertimeModule']=module;
  out.installUnityParticleModuleScale(s);const p={velocity:new V(),animatedVelocity:new V(),ultimateVelocity:new V(),startLifetime:10,remainingLifetime:10,randomSeed:17},pos=new V();
  for(const frame of r.steps){p.remainingLifetime-=f.dt;p.animatedVelocity.set(0,0,0);module.animate(p,f.dt);assert.equal(module.needTransform,true);for(const [axis,key] of ['x','y','z'].entries()){pos[key]+=p.ultimateVelocity[key]*f.dt;assert.ok(Math.abs(pos[key]-frame.position[axis]*(axis===2?zsign:1))<5e-6,JSON.stringify({r,axis,actual:pos[key],expected:frame.position[axis]}));assert.ok(Math.abs(p.velocity[key]-frame.velocity[axis]*(axis===2?zsign:1))<5e-6);}}
 }
});
test('velocity frame correction keeps speed modifier and existing animated channels',()=>{
 const module={space:0,needTransform:true,speedModifier:{mode:0,evaluate(){return 2;}},animate(p){p.animatedVelocity.y+=3;p.ultimateVelocity.set(0,0,0);}};
 const s={simulationSpace:0,node:{worldRotation:quat([0,0,0]),worldScale:new V(2,3,4)},velocityOvertimeModule:module};out.installUnityParticleModuleScale(s);
 const p={velocity:new V(1,0,0),animatedVelocity:new V(0,1,0),ultimateVelocity:new V(),startLifetime:2,remainingLifetime:1,randomSeed:7};module.animate(p,.1);assert.deepEqual(p.animatedVelocity,new V(0,10,0));assert.deepEqual(p.ultimateVelocity,new V(2,20,0));
});
test('native shapeless startSpeed stays unscaled in all scaling modes, including automatic births',()=>{
 const crypto=require('crypto');
 for(const name of ['start-speed-scale','start-speed-gameplay']){const f=require('./fixtures/'+name+'-native.json');assert.equal(f.isPlaying,true);assert.equal(f.sourceProbeSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/capture-'+name+'.cs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'));assert.equal(f.rows.length,name.endsWith('scale')?108:18);
  for(const row of f.rows){const p=row.particles?row.particles[0]:row;assert.ok(Math.abs(Math.hypot(...p.velocity)-5)<2e-6);assert.ok(Math.abs(Math.hypot(...p.position)-1)<2e-6);}
 }
});

