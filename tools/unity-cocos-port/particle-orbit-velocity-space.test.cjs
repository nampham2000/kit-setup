'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const fixture=require('./fixtures/orbit-velocity-space-native.json');
const {canBindOrbit,unsupportedOrbitReasons}=require('./particle-orbit-binding');
const m={exports:{}};
new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleOrbit.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText)(m.exports,m,()=>({}));
const transform=(mat,v,w)=>[0,1,2].map(i=>mat[i]*v[0]+mat[4+i]*v[1]+mat[8+i]*v[2]+w*mat[12+i]);
const byName=Object.fromEntries(fixture.cases.map(c=>[c.case,c]));
// Bound cases have zero linear velocity (world linear is rejected by the binding).
// Unity splits a scaled step into Maximum Particle Timestep (0.05 s) substeps.
function simulate(c){
  let pos=c.startPosition.slice();const out=new Float64Array(3),world=c.simulationSpace==='World';
  const scaled=c.dt*c.simulationSpeed,steps=Math.max(1,Math.ceil(scaled/fixture.maximumParticleTimestep-1e-6)),dt=scaled/steps;
  return c.position.map(()=>{
    for(let s=0;s<steps;s++){
      const local=world?transform(c.worldToLocal,pos,1):pos;
      m.exports.orbitalDelta(out,...local,...c.orbital,c.radial,dt);
      const delta=world?transform(c.localToWorld,Array.from(out),0):Array.from(out);
      pos=pos.map((v,i)=>v+dt*(delta[i]+c.startVelocity[i]));
    }
    return pos;
  });
}
const bound=fixture.cases.filter(c=>c.linear.every(v=>v===0)&&!(c.simulationSpace==='World'&&c.scalingMode!=='Hierarchy'));
test('orbital/radial motion matches native Local and World velocity space (rotated, non-uniformly scaled parent, simulation speed 5)',()=>{
  assert.equal(bound.length,14);
  let max=0;
  for(const c of bound){
    simulate(c).forEach((p,i)=>{max=Math.max(max,Math.hypot(...p.map((v,k)=>v-c.position[i][k])));});
  }
  assert.ok(max<2e-5,`native velocity-space orbit error ${max}`);
});
test('velocity space changes only the linear axes',()=>{
  for(const sim of ['local','world'])for(const k of ['radial','radial-simspeed5','orbital-radial','radial-local-scaling','linear','linear-radial']){
    const a=byName[`${sim}-sim-local-velocity-${k}`],b=byName[`${sim}-sim-world-velocity-${k}`];
    const diff=Math.max(...a.position.map((p,i)=>Math.hypot(...p.map((v,j)=>v-b.position[i][j]))));
    if(k.startsWith('linear'))assert.ok(diff>0.1,`${sim} ${k} differs`);else assert.ok(diff<1e-6,`${sim} ${k} identical`);
  }
});
test('binding accepts world velocity space only with zero linear axes',()=>{
  const constant=v=>({minMaxState:0,scalar:v});
  const spec=linear=>({enabled:true,simulationSpace:0,inWorldSpace:true,limitEnabled:false,noiseEnabled:false,velocity:{x:constant(linear),y:constant(0),z:constant(0),
    orbitalX:constant(0),orbitalY:constant(0),orbitalZ:constant(0),orbitalOffsetX:constant(0),orbitalOffsetY:constant(0),orbitalOffsetZ:constant(0),radial:constant(-2.67),speedModifier:constant(1)}});
  assert.equal(canBindOrbit(spec(0)),true);
  assert.deepEqual(unsupportedOrbitReasons(spec(0.4)),['world-linear-velocity']);
  assert.deepEqual(unsupportedOrbitReasons({...spec(0),simulationSpace:2}),['custom-simulation-space']);
});
test('native velocity-space fixture binds its producer',()=>{
  const text=fs.readFileSync(path.join(__dirname,'fixtures/capture-orbit-velocity-space.cs'),'utf8').replace(/\r\n/g,'\n');
  assert.equal(crypto.createHash('sha256').update(text).digest('hex'),fixture.sourceProbeSha256);
});
