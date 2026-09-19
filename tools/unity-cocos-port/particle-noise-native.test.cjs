'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'runtime/UnityNoiseKernel.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const moduleValue={exports:{}};new Function('exports','module',compiled)(moduleValue.exports,moduleValue);
const {UnityNoiseKernel,sampleNoiseCurve}=moduleValue.exports;
const fixture=require('./fixtures/particle-noise-native.json');
const spec={frequency:1,octaves:1,octaveMultiplier:.5,octaveScale:2,damping:false};
test('native holdouts bind the portable capture producer',()=>{
  const producer=fs.readFileSync(path.join(__dirname,'fixtures/capture-noise-holdouts.cs'),'utf8').replace(/\r\n/g,'\n');
  assert.equal(crypto.createHash('sha256').update(producer).digest('hex'),fixture.sourceProbeSha256);
});

test('all 65,536 analytic lattice gradients match the native Unity lattice digest',()=>{
  const k=new UnityNoiseKernel(1),out=new Float64Array(2),codes=new Uint8Array(65536);
  const gx=[Math.SQRT2,1,0,-1,-Math.SQRT2,-1,0,1],gy=[0,1,Math.SQRT2,1,0,-1,-Math.SQRT2,-1];
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    k.gradient(out,x,y);const code=gx.findIndex((v,i)=>Math.abs(v-out[0])<1e-10&&Math.abs(gy[i]-out[1])<1e-10);
    assert.ok(code>=0);codes[y*256+x]=code;
  }
  assert.equal(crypto.createHash('sha256').update(codes).digest('hex'),fixture.nativeGradientLatticeSha256);
});
test('analytic curl passes 1024 independent native position, scroll and frequency holdouts',()=>{
  const kernel=new UnityNoiseKernel(1),out=new Float64Array(3);let error=0,energy=0,max=0;
  for(const row of fixture.holdouts){
    kernel.sample(out,...row.position,row.scroll,{...spec,frequency:row.frequency});
    for(let i=0;i<3;i++){const delta=out[i]-row.field[i];error+=delta*delta;energy+=row.field[i]**2;max=Math.max(max,Math.abs(delta));}
  }
  assert.equal(fixture.holdouts.length,1024);
  assert.ok(Math.sqrt(error/energy)<.0001,`NRMSE ${Math.sqrt(error/energy)}`);
  assert.ok(max<.0015,`Maximum field error ${max}`);
});
test('native phase RNG reproduces a second system seed without a fitted phase offset',()=>{
  const kernel=new UnityNoiseKernel(1234),out=new Float64Array(3);
  for(const row of fixture.seed1234){
    kernel.sample(out,...row.input,0,spec);
    for(let i=0;i<3;i++)assert.ok(Math.abs(out[i]-(row.position[i]-row.input[i])/row.dt)<.0002);
  }
});
test('Hermite strength curves retain source tangents and are not replaced by scalar strength',()=>{
  const curve={minMaxState:1,scalar:.5,maxCurve:{m_Curve:[{time:0,value:1,inSlope:0,outSlope:0},{time:1,value:0,inSlope:-2,outSlope:-2}]}};
  assert.equal(sampleNoiseCurve(curve,0),.5);
  assert.equal(sampleNoiseCurve(curve,.5),.375);
  assert.equal(sampleNoiseCurve(curve,1),0);
});
