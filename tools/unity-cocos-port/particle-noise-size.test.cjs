'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
function compile(name,deps={}){const m={exports:{}};new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(m.exports,m,k=>deps[k]||{});return m.exports;}
const kernel=compile('UnityNoiseKernel'),noise=compile('UnityParticleNoise',{'./UnityNoiseKernel':kernel});
const fixture=require('./fixtures/noise-size-native.json');
const constant=scalar=>({minMaxState:0,scalar});
const vec=(x=0,y=0,z=0)=>({x,y,z,set(a,b,c){this.x=a;this.y=b;this.z=c;}});
test('Noise size fixture binds its producer and covers billboard/mesh, 2D/3D sizes and lifetime composition',()=>{
  const producer=fs.readFileSync(path.join(__dirname,'fixtures/capture-noise-size.cs'),'utf8').replace(/\r\n/g,'\n');
  assert.equal(crypto.createHash('sha256').update(producer).digest('hex'),fixture.sourceProbeSha256);
  assert.equal(fixture.cases.length,48);
});
for(const c of fixture.cases)test(`native Noise size ${c.sizeAmount}, ${c.steps} steps, 3D=${c.threeD}, mesh=${c.meshMode}, lifetime=${c.sizeOverLife}`,()=>{
  const spec={version:1,enabled:true,quality:2,separateAxes:false,autoRandomSeed:false,randomSeed:c.seed,frequency:1,damping:false,octaves:1,octaveMultiplier:.5,octaveScale:2,strength:constant(c.strength),strengthY:constant(c.strength),strengthZ:constant(c.strength),scrollSpeed:constant(0),positionAmount:constant(1),rotationAmount:constant(0),sizeAmount:constant(c.sizeAmount),remapEnabled:false};
  const module={},system={processor:{_runAnimateList:[module],_particles:{length:1},enableModule(){},updateParticles(){}},noiseModule:module,sizeOvertimeModule:{enable:c.sizeOverLife},time:0,duration:5};
  noise.installUnityParticleNoise(system,spec,c.seed);
  const p={position:vec(c.initialPosition[0],c.initialPosition[1],-c.initialPosition[2]),startSize:vec(...c.initialSize),size:vec(...c.initialSize),animatedVelocity:vec(),ultimateVelocity:vec(),remainingLifetime:10,startLifetime:10};
  for(let i=0;i<c.steps;i++){
    p.remainingLifetime-=c.dt;p.animatedVelocity.set(0,0,0);p.ultimateVelocity.set(0,0,0);
    if(c.sizeOverLife){const scale=1+1-p.remainingLifetime/p.startLifetime;p.size.set(...c.initialSize.map(n=>n*scale));}
    module.animate(p,c.dt);
    p.position.set(p.position.x+p.ultimateVelocity.x*c.dt,p.position.y+p.ultimateVelocity.y*c.dt,p.position.z+p.ultimateVelocity.z*c.dt);
  }
  const axes=c.meshMode?3:2;
  for(let axis=0;axis<axes;axis++){
    const values=c.vertices.map(v=>v[axis]),extent=Math.max(...values)-Math.min(...values),size=[p.size.x,p.size.y,p.size.z][axis];
    assert.ok(Math.abs(size-extent)<8e-5,`axis ${axis} size ${size}, native BakeMesh extent ${extent}`);
  }
  for(let axis=0;axis<3;axis++)assert.ok(Math.abs([p.position.x,p.position.y,-p.position.z][axis]-c.position[axis])<8e-5,'Native Noise displacement stays unchanged');
});
