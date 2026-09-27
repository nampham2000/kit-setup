'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { particleNoiseContract } = require('./particle-noise-contract');
test('disabled noise does not invent active adapter obligations', () => {
  assert.deepEqual(particleNoiseContract(), {version:1,enabled:false});
  assert.deepEqual(particleNoiseContract({NoiseModule:{enabled:0}}), {version:1,enabled:false});
});
test('noise contract retains signed curves, quality and native integration semantics', () => {
  const source={enabled:1,quality:1,separateAxes:0,frequency:1.2,damping:0,octaves:2,octaveMultiplier:1,octaveScale:2,
    strength:{minMaxState:1,scalar:.5,maxCurve:{m_Curve:[{time:0,value:1,outSlope:0},{time:1,value:0,inSlope:-2}]}},
    scrollSpeed:{minMaxState:3,minScalar:-2,scalar:1},positionAmount:{minMaxState:0,scalar:1},
    rotationAmount:{minMaxState:0,scalar:0},sizeAmount:{minMaxState:0,scalar:0},remapEnabled:0};
  const c=particleNoiseContract({NoiseModule:source});
  assert.deepEqual(c.strength,source.strength);
  assert.deepEqual(c.scrollSpeed,source.scrollSpeed);
  assert.equal(c.quality,1); assert.equal(c.octaveMultiplier,1);
  assert.equal(c.integration,'animated-velocity-before-limit');
  assert.equal(c.requiresNativeValidatedAdapter,true);
  source.strength.scalar=999;
  assert.equal(c.strength.scalar,.5);
});
test('authored fixed system seed is retained as an unsigned value',()=>{
  const c=particleNoiseContract({autoRandomSeed:false,randomSeed:4294967295,NoiseModule:{enabled:1}});
  assert.equal(c.autoRandomSeed,false);assert.equal(c.randomSeed,4294967295);
});
test('Noise preserves authored scalar versus 3D size semantics',()=>{
 for(const size3D of [0,1])assert.equal(particleNoiseContract({InitialModule:{size3D},NoiseModule:{enabled:1}}).size3D,!!size3D);
});
