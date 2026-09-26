'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
function compile(name,deps={}){const m={exports:{}};new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(m.exports,m,k=>deps[k]||{});return m.exports;}
const kernel=compile('UnityNoiseKernel'),noise=compile('UnityParticleNoise',{'./UnityNoiseKernel':kernel});
const fixture=require('./fixtures/noise-random-native.json');
const constant=scalar=>({minMaxState:0,scalar});
const vec=(x=0,y=0,z=0)=>({x,y,z,set(a,b,c){this.x=a;this.y=b;this.z=c;}});
test('random Noise oracle binds native producer and held-out wrapping seeds',()=>{
 const producer=fs.readFileSync(path.join(__dirname,'fixtures/capture-noise-random.cs'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(crypto.createHash('sha256').update(producer).digest('hex'),fixture.sourceProbeSha256);assert.equal(fixture.cases.length,312);
});
for(const c of fixture.cases)test(`Noise random seed ${c.particleSeed}, axes=${c.separateAxes}, quality=${c.quality}, authored=${c.authored}, size3D=${c.threeD}`,()=>{
 const strengths=c.ranges.map(([minScalar,scalar])=>({minMaxState:3,minScalar,scalar}));
 const spec={version:1,enabled:true,quality:c.quality,separateAxes:c.separateAxes,autoRandomSeed:false,randomSeed:c.systemSeed,frequency:c.frequency,damping:c.damping,octaves:1,octaveMultiplier:.5,octaveScale:2,strength:strengths[0],strengthY:strengths[1],strengthZ:strengths[2],scrollSpeed:constant(0),positionAmount:constant(1),rotationAmount:constant(c.authored?1:0),sizeAmount:constant(c.authored?1:0),remapEnabled:false,size3D:c.threeD,rotation3D:false,rotationSigns:[-1,1,-1]};
 const module={},system={processor:{_runAnimateList:[module],_particles:{length:1},enableModule(){},updateParticles(){}},noiseModule:module,time:0,duration:5};
 noise.installUnityParticleNoise(system,spec,c.systemSeed);
 const p={position:vec(c.initialPosition[0],c.initialPosition[1],-c.initialPosition[2]),startSize:vec(1,1,1),size:vec(1,1,1),animatedVelocity:vec(),ultimateVelocity:vec(),remainingLifetime:10,startLifetime:10,randomSeed:c.particleSeed,startEuler:vec(),rotation:vec()};
 for(const [i,s] of c.samples.entries()){
  p.remainingLifetime-=c.dt;p.animatedVelocity.set(0,0,0);p.ultimateVelocity.set(0,0,0);module.animate(p,c.dt);
  p.position.set(p.position.x+p.ultimateVelocity.x*c.dt,p.position.y+p.ultimateVelocity.y*c.dt,p.position.z+p.ultimateVelocity.z*c.dt);
  for(let axis=0;axis<3;axis++)assert.ok(Math.abs([p.position.x,p.position.y,-p.position.z][axis]-s.position[axis])<8e-5,`step ${i} axis ${axis} position`);
  assert.ok(Math.abs(-p.rotation.z*180/Math.PI-s.rotation)<8e-5,`step ${i} rotation`);
  // Rotated billboard edge lengths preserve size; an AABB would mix X and Y.
  const distances=[];for(let j=1;j<s.vertices.length;j++)distances.push(Math.hypot(...s.vertices[j].map((v,k)=>v-s.vertices[0][k])));
  distances.sort((a,b)=>a-b);const sizes=[p.size.x,p.size.y].sort((a,b)=>a-b);
  for(let axis=0;axis<2;axis++)assert.ok(Math.abs(sizes[axis]-distances[axis])<8e-5,`step ${i} size ${sizes[axis]} vs ${distances[axis]}`);
 }
});
