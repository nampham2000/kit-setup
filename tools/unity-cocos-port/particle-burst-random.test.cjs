'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleBurstRandom.ts'),'utf8'),{compilerOptions:{module:1}}).outputText)(out,()=>({}));
const fixture=require('./fixtures/burst-counts-native.json');
function setup(seed,spec={time:0,min:1,max:1000}){
 const calls=[],system={duration:1,loop:true,_isEmitting:true,unityInitialState:{seed},bursts:[{}],processor:{clear(){}},emit(count,delay){calls.push({count,delay,frame:this.frame});},_emit(dt){this.bursts[0].update(this,dt);}};
 out.installUnityParticleBurstRandom(system,[spec]);return {system,calls};
}
test('native random burst modulo stream and wrapped event clock match 48 observed counts',()=>{
 for(const row of fixture.rows){const {system,calls}=setup(row.seed);system._emit(0);assert.equal(calls.length,0);for(let f=0;f<=180;f++){system.frame=f;system._emit(Math.fround(1/60));}assert.deepEqual(calls.map(x=>x.count),row.counts);assert.deepEqual(calls.map(x=>x.frame),[0,60,120,180]);
 system.processor.clear();calls.length=0;for(let f=0;f<=180;f++){system.frame=f;system._emit(Math.fround(1/60));}assert.deepEqual(calls.map(x=>x.count),row.counts);}
});
test('native random-count source gate rejects unmeasured probability, repeats and moving rates',()=>{
 const {nativeBurstCountContract}=require('./particle-initial-state-binding.cjs'),zero={minMaxState:0,scalar:0},burst={time:.3,probability:1,cycleCount:1,countCurve:{minMaxState:3,minScalar:1,scalar:30}},source={startDelay:zero,EmissionModule:{enabled:true,rateOverTime:zero,rateOverDistance:zero,m_Bursts:[burst]}};
 assert.deepEqual(nativeBurstCountContract(source),[{time:.3,min:1,max:30}]);
 for(const b of [{...burst,probability:.5},{...burst,cycleCount:2},{...burst,countCurve:{...burst.countCurve,scalar:1.5}}])assert.equal(nativeBurstCountContract({...source,EmissionModule:{...source.EmissionModule,m_Bursts:[b]}}),null);
 assert.equal(nativeBurstCountContract({...source,EmissionModule:{...source.EmissionModule,rateOverTime:{minMaxState:3,scalar:5,minScalar:1}}}),null);
});

test('offset bursts match native float boundary; constant continuous rate uses an independent stream',()=>{
 const offset=require('./fixtures/burst-offset-native.json'), rate=require('./fixtures/burst-rate-offset-native.json');
 for(const row of offset.rows){const {system,calls}=setup(row.seed,{time:.3,min:1,max:1000});for(let f=0;f<=198;f++){system.frame=f;system._emit(Math.fround(1/60));}assert.deepEqual(calls.map(x=>x.count),row.counts);assert.deepEqual(calls.map(x=>x.frame),[17,78,138,198]);assert.deepEqual(rate.rows.find(x=>x.seed===row.seed).counts.map((n,i)=>n-row.counts[i]),[1,0,1,0]);}
});

test('multiple ordered bursts preserve the shared native emission stream across loops',()=>{
 for(const row of require('./fixtures/burst-multiple-native.json').rows){const calls=[],system={duration:1,loop:true,_isEmitting:true,unityInitialState:{seed:row.seed},bursts:[{},{}],processor:{clear(){}},emit(count){calls.push({count,frame:this.frame});},_emit(dt){for(const b of this.bursts)b.update(this,dt);}};out.installUnityParticleBurstRandom(system,[{time:.05,min:1,max:1000},{time:.15,min:1,max:1000}]);for(let f=0;f<=180;f++){system.frame=f;system._emit(Math.fround(1/60));}for(const c of calls)assert.equal(c.count,row.counts[c.frame],JSON.stringify({seed:row.seed,...c}));assert.equal(calls.length,6);}
});
