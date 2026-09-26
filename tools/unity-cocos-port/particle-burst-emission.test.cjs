'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'runtime/UnityParticleBurstEmission.ts'),'utf8');
const moduleResult={exports:{}};
new Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(moduleResult.exports);
for(const step of [0.02,0.1,0.5]) test(`Knives source burst retains all 40 events at dt=${step}, including replay`,()=>{
  let count=0;
  const burst={time:0,repeatCount:40,repeatInterval:0.03,count:{evaluate:()=>1},reset(){}};
  const ps={bursts:[burst],time:0,duration:3,startDelay:{evaluate:()=>0},emit(n){count+=n;}};
  moduleResult.exports.installUnityParticleBurstEmission(ps);
  for(let run=0;run<2;run++){
    burst.reset();count=0;
    for(let t=step;t<2.01;t+=step){ps.time=t;burst.update(ps,step);}
    assert.equal(count,40);
  }
});
for(const sample of require('./fixtures/burst-spread.json'))test(`Unity burst spread count=${sample.count}, arc=${sample.arc}`,()=>{
  const shape={arcMode:3,_arc:sample.arc*Math.PI/180,arcSpread:0,generateArcAngle(){throw new Error('Stock Cocos arc cannot distribute a burst');}};
  let positions=[];
  const ps={shapeModule:shape,bursts:[],emit(n){for(let i=0;i<n;i++){const a=shape.generateArcAngle();positions.push([2*Math.cos(a),2*Math.sin(a),0]);}}};
  moduleResult.exports.installUnityParticleBurstEmission(ps);
  for(let replay=0;replay<2;replay++){
    positions=[];ps.emit(sample.count,0);
    for(let i=0;i<sample.count;i++)for(let axis=0;axis<3;axis++)assert.ok(Math.abs(positions[i][axis]-sample.positions[i][axis])<1e-6,`particle ${i} axis ${axis}`);
  }
});
for(const sample of require('./fixtures/burst-cycles.json').cases)test(`native burst cycles per step: ${sample.name}`,()=>{
  let count=0;
  const burst={time:0,repeatCount:sample.cycles,repeatInterval:sample.interval,count:{evaluate:()=>sample.count},reset(){}};
  const ps={bursts:[burst],time:0,duration:sample.duration,startDelay:{evaluate:()=>0},emit(n){count+=n;}};
  moduleResult.exports.installUnityParticleBurstEmission(ps);
  burst.reset();
  let mismatches=0;
  for(let step=1;step<sample.particles.length;step++){
    ps.time=Math.fround(step*sample.dt);
    // A non-looping system stops emitting once its duration has elapsed.
    if(ps.time<=sample.duration)burst.update(ps,sample.dt);
    if(Math.abs(count-sample.particles[step])>sample.count)mismatches++;
  }
  assert.equal(mismatches,0,`${sample.name}: per-step counts drift from Unity`);
  assert.equal(count,sample.particles[sample.particles.length-1],`${sample.name}: total`);
});
