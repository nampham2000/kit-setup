'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function compile(name,deps={}){const m={exports:{}};new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(m.exports,m,k=>deps[k]||{});return m.exports;}
const kernel=compile('UnityNoiseKernel'),orbit=compile('UnityParticleOrbit',{'./UnityNoiseKernel':kernel}),noise=compile('UnityParticleNoise',{'./UnityNoiseKernel':kernel});
const fixture=require('./fixtures/particle-noise-orbit-native.json');
test('native composition fixture binds its portable capture producer',()=>{
 const producer=fs.readFileSync(path.join(__dirname,'fixtures/capture-noise-orbit.cs'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(require('node:crypto').createHash('sha256').update(producer).digest('hex'),fixture.sourceProbeSha256);
});
const {canBindOrbit}=require('./particle-orbit-binding');
const spec={enabled:true,simulationSpace:0,inWorldSpace:false,limitEnabled:false,noiseEnabled:true,noise:fixture.noise,velocity:fixture.velocity};
test('generic orbital eligibility accepts measured High composition and rejects unmeasured variants',()=>{
 assert.equal(canBindOrbit(spec),true);
 assert.equal(canBindOrbit({...spec,noise:{...spec.noise,quality:3}}),false);
 // Binds only when both the orbit and noise bindings accept the measured limit composition.
 const composition=require('./particle-limit-velocity-binding').LIMIT_VELOCITY_COMPOSITION==='animated-velocity-before-limit';
 assert.equal(canBindOrbit({...spec,limitEnabled:true}),composition);
 assert.equal(canBindOrbit({...spec,velocity:{...spec.velocity,speedModifier:{minMaxState:0,scalar:2}}}),false);
});
const vec=(x=0,y=0,z=0)=>({x,y,z,set(x,y,z){this.x=x;this.y=y;this.z=z;}});
test('actual runtime module composition matches native authored trajectories with matched births and radial draws',()=>{
 const s=fixture.motion,system={noiseModule:{},velocityOvertimeModule:{},processor:{_runAnimateList:[],updateParticles(){},enableModule(){}}};
 orbit.installUnityParticleOrbit(system,spec);noise.installUnityParticleNoise(system,fixture.noise,s.seed);
 const radial=fixture.velocity.radial,min=kernel.sampleNoiseCurve(radial,0,0),max=kernel.sampleNoiseCurve(radial,0,1);
 const particles=s.rows[0].particles.map(p=>{const random=(s.draws.find(d=>d.seed===p.seed).speed-min)/(max-min);return{seed:p.seed,randomSeed:Math.imul((Math.round(random*4294967296)-1013904223)|0,4276115653)>>>0,position:vec(p.position[0],p.position[1],-p.position[2]),velocity:vec(),animatedVelocity:vec(),ultimateVelocity:vec(),startLifetime:p.startLife,remainingLifetime:p.life};});
 let maxPosition=0,maxVelocity=0;
 for(let step=1;step<=30;step++){
  for(const p of particles){p.remainingLifetime-=s.delta;if(p.remainingLifetime<=0)continue;system.velocityOvertimeModule.animate(p,s.delta);system.noiseModule.animate(p,s.delta);for(const key of ['x','y','z'])p.position[key]+=p.ultimateVelocity[key]*s.delta;}
  const row=s.rows.find(r=>Math.abs(r.time-step*s.delta)<1e-6);if(!row)continue;
  for(const native of row.particles){const p=particles.find(p=>p.seed===native.seed);maxPosition=Math.max(maxPosition,Math.hypot(p.position.x-native.position[0],p.position.y-native.position[1],p.position.z+native.position[2]));maxVelocity=Math.max(maxVelocity,Math.hypot(p.ultimateVelocity.x-native.totalVelocity[0],p.ultimateVelocity.y-native.totalVelocity[1],p.ultimateVelocity.z+native.totalVelocity[2]));}
 }
 console.log({maxPosition,maxVelocity});assert.ok(maxPosition<.0001);assert.ok(maxVelocity<.001);
});
