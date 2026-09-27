'use strict';
// Unity 6000.3.1f1 native: the Velocity over Lifetime speed modifier scales the orbital rotation angle and the radial
// step (exact rotation), it does not stretch the per-step chord of the unscaled rotation (outward spiral).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto');
const dir=__dirname;const fixture=require('./fixtures/particle-orbit-speed-modifier-native.json');
function compile(file,deps={}){const m={exports:{}};new Function('exports','module','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m.exports,m,k=>deps[k]||{});return m.exports;}
const kernel=compile(dir+'/runtime/UnityNoiseKernel.ts');
class V{constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}}
const orbit=compile(dir+'/runtime/UnityParticleOrbit.ts',{'./UnityNoiseKernel':kernel,cc:{Vec3:V,Mat4:class{}},'./UnityParticleLimitVelocity':{installUnityParticleLimitVelocity(){}}});
const c=v=>({minMaxState:0,scalar:v});
function simulate(speed){
  const system={velocityOvertimeModule:{},node:{}};
  orbit.installUnityParticleOrbit(system,{enabled:true,simulationSpace:0,inWorldSpace:false,limitEnabled:false,velocity:{
    x:c(0),y:c(0),z:c(0),orbitalX:c(fixture.omega[0]),orbitalY:c(fixture.omega[1]),orbitalZ:c(fixture.omega[2]),radial:c(fixture.radial),
    orbitalOffsetX:c(0),orbitalOffsetY:c(0),orbitalOffsetZ:c(0),speedModifier:c(speed)}});
  const e=fixture.emit,dt=fixture.dt;
  const p={remainingLifetime:2,startLifetime:2,randomSeed:1,position:new V(e[0],e[1],-e[2]),velocity:new V(),animatedVelocity:new V(),ultimateVelocity:new V()};
  const out=[];
  for(let step=1;step<=60;step++){
    p.remainingLifetime-=dt;
    system.velocityOvertimeModule.animate(p,dt);
    p.position.set(p.position.x+p.ultimateVelocity.x*dt,p.position.y+p.ultimateVelocity.y*dt,p.position.z+p.ultimateVelocity.z*dt);
    if(step%fixture.sampleEvery===0)out.push([p.position.x,p.position.y,-p.position.z]);
  }
  return out;
}
test('speed modifier scales the orbital angle and radial step like Unity',()=>{
  for(const [name,row] of Object.entries(fixture.variants)){
    const got=simulate(row.speedModifier);
    const max=Math.max(...got.map((q,i)=>Math.hypot(...q.map((v,k)=>v-row.positions[i][k]))));
    assert.ok(max<0.005,`${name} max error ${max}`);
  }
});
test('zero speed modifier freezes the orbit without NaN',()=>{for(const q of simulate(0))for(const v of q)assert.ok(Number.isFinite(v));});
test('native fixture retains its capture producer hash',()=>{
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'fixtures',fixture.producer.file),'utf8').replace(/\r\n/g,'\n')).digest('hex'),fixture.producer.sha256);
});
