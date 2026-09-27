'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const m={exports:{}};
new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleEulerRotation.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m.exports,m,()=>({}));
const {unityRotationRandom,installUnityParticleEulerRotation}=m.exports;
const native=require('./fixtures/rotation-random-channel-native.json');
const {applyRotationModule}=require('./particle-system-converter');
const vec=(x=0,y=0,z=0)=>({x,y,z,set(x,y,z){Object.assign(this,{x,y,z});}});
function converted(min,max,sign){
 const objects=[{_rotationOvertimeModule:{__id__:1}},{_enable:true,separateAxes:false,x:{__id__:2},y:{__id__:3},z:{__id__:4}},{},{},{}];
 applyRotationModule({objects},objects[0],{enabled:true,separateAxes:false,x:{minMaxState:0,scalar:0},y:{minMaxState:0,scalar:0},curve:{minMaxState:3,minScalar:min,scalar:max}},{eulerSigns:[1,1,sign]});
 return objects[4];
}
test('retained native rotation draw matches 217 automatic deltas and 84 birth seeds',()=>{
 const producer=fs.readFileSync(path.join(__dirname,'fixtures/capture-rotation-random-channel.cjs'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(native.producerHashContract,'sha256-text-lf-v1');
 assert.equal(crypto.createHash('sha256').update(producer).digest('hex'),native.producerSha256);
 assert.equal(native.rows.length,217);assert.equal(new Set(native.rows.map(r=>r.seed)).size,84);
 for(const r of native.rows)assert.ok(Math.abs(unityRotationRandom(r.seed)-r.random)<1e-5,`${r.node} seed ${r.seed}`);
});
test('reflected TwoConstants preserve endpoint identity, including reverse authored ranges',()=>{
 for(const [a,b] of [[-2,2],[14,18],[4,2]])for(const sign of [-1,1]){
  const c=converted(a,b,sign);assert.equal(c.constantMin,a*sign);assert.equal(c.constantMax,b*sign);
 }
});
test('converter plus runtime preserves native signed angular deltas',()=>{
 for(const r of native.rows){
  const z=converted(r.min,r.max,-1);z.evaluate=(_,u)=>z.constantMin+(z.constantMax-z.constantMin)*u;
  const system={rotationOvertimeModule:{separateAxes:false,z}};installUnityParticleEulerRotation(system);
  const p={unityNativeSeed:r.seed,randomSeed:17,startLifetime:2,remainingLifetime:1,startEuler:vec(0,0,-r.rotationBefore*Math.PI/180),rotation:vec()};
  system.rotationOvertimeModule.animate(p,r.seconds);
  assert.ok(Math.abs(p.startEuler.z*180/Math.PI+r.rotationAfter)<0.002,`${r.node} seed ${r.seed}`);
 }
});
test('TwoCurves keeps the explicitly unverified legacy fallback',()=>{
 const draws=[],z={mode:2,evaluate:(_,u)=>{draws.push(u);return 0;}};
 const system={rotationOvertimeModule:{separateAxes:false,z}};installUnityParticleEulerRotation(system);
 for(const seed of [1,2])system.rotationOvertimeModule.animate({unityNativeSeed:seed,randomSeed:19,startLifetime:1,remainingLifetime:.5,startEuler:vec(),rotation:vec()},.1);
 assert.equal(draws[0],draws[1]);
});
