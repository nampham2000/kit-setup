'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseArgs,parseViewportSize,applyViewportSize}=require('./verify-runtime.cjs');
test('page dimensions are explicit and independent of window chrome',async()=>{
  const options=parseArgs(['--window-size','1400x900','--viewport-size=1280x720']);
  assert.deepEqual(options.viewportSize,{width:1280,height:720});
  const calls=[];await applyViewportSize({send:async(...args)=>calls.push(args)},'page',options.viewportSize);
  assert.deepEqual(calls,[['Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},'page']]);
});
test('reference viewport dimensions never silently fall back',()=>{
  for(const value of ['','wide','0x720','1280x-1','20000x720'])assert.throws(()=>parseViewportSize(value),/viewport-size/);
  assert.deepEqual(parseArgs(['--viewport-size','720,1280']).viewportSize,{width:720,height:1280});
});
