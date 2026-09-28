'use strict';
// Pooled non-looping burst systems under the simulation-step clock (SOF_Point:
// 15 @ 0 s, 25 @ 0.1 s, 15 @ 0.15 s, duration 2 s, Unity total 55).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function load(name,modules){
  const m={exports:{}},code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('exports','module','require',code)(m.exports,m,id=>{const key=id.replace('./','');if(!(key in modules))throw new Error('unexpected import '+id);return modules[key];});
  return m.exports;
}
const cc={Vec3:class{set(){}},pseudoRandom:()=>0,Mat4:class{}};
const burstModule=load('UnityParticleBurstEmission',{cc});
const stepModule=load('UnityParticleSimulationStep',{cc,UnityParticleBirthTiming:load('UnityParticleBirthTiming',{cc}),UnityParticleBurstEmission:burstModule});

// Creator 3.8.8 cocos/particle/burst.ts and particle-system.ts (play, stop, reset,
// update, _emit), reduced to the members the emission path reads.
const repeat=(t,l)=>Math.min(Math.max(t-Math.floor(t/l)*l,0),l);
class Burst{
  constructor(time,count){this.time=time;this.repeatCount=1;this.repeatInterval=0.01;this.count={evaluate:()=>count};this._remainingCount=0;this._curTime=0;}
  update(psys,dt){
    if(this._remainingCount===0){this._remainingCount=this.repeatCount;this._curTime=this.time;}
    if(this._remainingCount>0){
      let pre=repeat(psys.time-psys.startDelay.evaluate(0,1),psys.duration)-dt;pre=pre>0?pre:0;
      const cur=repeat(psys.time-psys.startDelay.evaluate(0,1),psys.duration);
      if(this._curTime>=pre&&this._curTime<cur){psys.emit(this.count.evaluate(this._curTime/psys.duration,1),dt-(cur-this._curTime));this._curTime+=this.repeatInterval;--this._remainingCount;}
    }
  }
  reset(){this._remainingCount=0;this._curTime=0;}
}
function pointSystem(){
  const s={duration:2,loop:false,playOnAwake:true,simulationSpeed:1,startDelay:{evaluate:()=>0},rateOverTime:{evaluate:()=>0},
    bursts:[new Burst(0,15),new Burst(0.1,25),new Burst(0.15,15)],node:{getWorldPosition(){}},
    _time:0,_isPlaying:false,_isPaused:false,_isStopped:true,_isEmitting:false,_needToRestart:false,_emitRateTimeCounter:0,
    enabledInHierarchy:false,alive:[],births:[],
    get time(){return this._time;},get isPlaying(){return this._isPlaying;},
    getParticleCount(){return this.alive.length;},
    processor:{updateParticles(dt){s.alive=s.alive.map(l=>l-dt).filter(l=>l>0);return s.alive.length;},clear(){s.alive=[];},getModel(){return null;}},
    emit(count){this.births.push({at:this._time,count});for(let i=0;i<count;i++)this.alive.push(1.5);},
    play(){if(this._needToRestart){this.reset();this._needToRestart=false;}this._isPaused=false;this._isStopped=false;this._isPlaying=true;this._isEmitting=true;},
    stopEmitting(){this._isEmitting=false;this._needToRestart=true;},
    stop(){if(this._isPlaying||this._isPaused)this.clear();this._isPlaying=false;this._isPaused=false;this._isEmitting=false;this._isStopped=true;this.reset();},
    reset(){this._time=0;this._emitRateTimeCounter=0;this.bursts.forEach(b=>b.reset());},
    clear(){if(this.enabledInHierarchy)this.processor.clear();},
    onEnable(){this.enabledInHierarchy=true;if(this.playOnAwake)this.play();},
    onDisable(){this.enabledInHierarchy=false;},
    update(dt){const d=dt*this.simulationSpeed;if(this._isPlaying){this._time+=d;this._emit(d);if(this.processor.updateParticles(d)===0&&!this._isEmitting)this.stop();}},
    _emit(dt){
      const delay=this.startDelay.evaluate(0,1);
      if(this._time>delay){
        const timeLeft=this._time-(this.duration+delay);
        if(timeLeft>dt&&!this.loop)this._isEmitting=false;
        if(!this._isEmitting)return;
        if(timeLeft<=0||this.loop)for(const b of this.bursts)b.update(this,dt);
      }
    }};
  return s;
}
const pooled=(maximumDeltaTime=0.03)=>{const s=pointSystem();stepModule.installUnityParticleSimulationStep(s,maximumDeltaTime);return s;};
// ScrewVfxPool.spawn: node.active = true (onEnable -> playOnAwake play) then playAll -> play.
function spawn(s){s.births.length=0;s.onEnable();s.play();}
// ScrewVfxPool.park: stop() then node.active = false.
function park(s){s.stop();s.onDisable();}
const total=s=>s.births.reduce((sum,b)=>sum+b.count,0);
function runFor(s,frames){for(const dt of frames){if(!s._isPlaying)break;s.update(dt);}}
const steady=n=>Array(n).fill(1/60);

test('fixture reproduces the defect: stock Burst.update on the float32 step clock replays the 0.1 s burst',()=>{
  // The pair the step adapter hands the engine: time = float32 clock, dt = fround(frame).
  const s=pointSystem();s.onEnable();let clock=0;
  for(let i=0;i<12;i++){const dt=Math.fround(1/60);clock=Math.fround(clock+dt);s._time=clock;s._emit(dt);}
  assert.equal(total(s),80,'the unpatched path emits 15 + 25 + 25 + 15');
});

test('steady 60 fps emits each SOF_Point burst exactly once (55)',()=>{
  const s=pooled();spawn(s);runFor(s,steady(200));
  assert.equal(total(s),55);assert.deepEqual(s.births.map(b=>b.count),[15,25,15]);
});

for(const frame of [0.05,0.0852,0.1,0.1714,0.25])test(`a ${frame} s frame across the 0.1 s burst still emits 55`,()=>{
  for(const lead of [0,1,5,6]){
    const s=pooled();spawn(s);runFor(s,[...steady(lead),frame,...steady(200)]);
    assert.equal(total(s),55,`lead ${lead}`);assert.deepEqual(s.births.map(b=>b.count),[15,25,15],`lead ${lead}`);
  }
});

test('a zero-length step does not rewind the clock and replay bursts',()=>{
  const s=pooled();spawn(s);runFor(s,[...steady(7),0,...steady(3),0,...steady(200)]);
  assert.equal(total(s),55);
});

test('prewarm then reuse restarts the clock: t=0 burst kept, timings from zero',()=>{
  // One short prewarm update, park, then a first reuse step longer than the prewarm time.
  const s=pooled(0.1);spawn(s);runFor(s,[0.01]);park(s);
  spawn(s);runFor(s,[0.03,...steady(200)]);
  assert.equal(total(s),55);
  assert.deepEqual(s.births.map(b=>b.count),[15,25,15]);
  assert.ok(Math.abs(s.births[0].at-0.03)<1e-6,'first burst on the first reuse step, not offset by the prewarm clock');
});

test('reuse after a mid-run park and after natural completion emits 55 each time',()=>{
  const s=pooled();
  spawn(s);runFor(s,steady(8));park(s);
  for(let round=0;round<3;round++){spawn(s);runFor(s,steady(200));assert.equal(total(s),55,`round ${round}`);assert.equal(s._isPlaying,false);park(s);}
});

test('jittered 60 fps with long frames, prewarm and pool reuse never leaves 55',()=>{
  let seed=7;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
  for(const maximumDeltaTime of [0.02,0.03,1/30,0.1,1/3])for(let run=0;run<300;run++){
    const s=pooled(maximumDeltaTime);
    const frame=()=>{const x=rnd();return x<0.03?0:x<0.2?0.03+rnd()*0.2:1/60+(rnd()-0.5)*0.002;};
    spawn(s);for(let i=0;i<2;i++)s.update(frame());park(s);
    for(let use=0;use<3;use++){
      spawn(s);let frames=0;while(s._isPlaying&&frames++<400)s.update(frame());
      assert.equal(total(s),55,`maxDt ${maximumDeltaTime} run ${run} use ${use}`);
      park(s);
    }
  }
});

test('looping systems keep stock bursts; installation stays idempotent',()=>{
  const looping=pointSystem();looping.loop=true;const update=looping.bursts[1].update;
  stepModule.installUnityParticleSimulationStep(looping,0.03);
  assert.equal(looping.bursts[1].update,update);
  const s=pooled();const patched=s.bursts[1].update,reset=s.reset;
  stepModule.installUnityParticleSimulationStep(s,0.03);
  assert.equal(s.bursts[1].update,patched);assert.equal(s.reset,reset);
});

test('the simulation-step binding stages the burst catch-up it imports',()=>{
  const binding=fs.readFileSync(path.join(__dirname,'particle-simulation-step-binding.js'),'utf8');
  const staged=/for\(const name of \[([^\]]+)\]\)/.exec(binding)[1];
  assert.match(staged,/'UnityParticleBurstEmission'/);
  assert.match(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleSimulationStep.ts'),'utf8'),/from '\.\/UnityParticleBurstEmission'/);
});
