'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'runtime/UnityNoiseKernel.ts'),'utf8');
const m={exports:{}};new Function('exports','module',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m.exports,m);
const fixture=require('./fixtures/particle-noise-high.json');
test('High curl matches independent native seed, octave, damping, frequency and scroll holdouts',()=>{
 const producer=fs.readFileSync(path.join(__dirname,'fixtures/capture-noise-high.cs'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(crypto.createHash('sha256').update(producer).digest('hex'),fixture.sourceProbeSha256);
 const k=new m.exports.UnityNoiseKernel(1),out=new Float64Array(3);let squared=0,max=0;
 for(const row of fixture.holdouts){k.reset(row.seed);k.sample(out,...row.position,row.scroll,{...row,quality:2,octaveMultiplier:.5,octaveScale:2});for(let i=0;i<3;i++){const e=out[i]-row.field[i];squared+=e*e;max=Math.max(max,Math.abs(e));}}
 const rms=Math.sqrt(squared/(fixture.holdouts.length*3));console.log({samples:fixture.holdouts.length,rms,max});assert.ok(rms<.00015);assert.ok(max<.0015);
});
