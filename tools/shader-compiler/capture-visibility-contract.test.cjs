'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {cameraIncludesNodeLayer,validateCaptureVisibility}=require('./capture-visibility-contract.cjs');
const DEFAULT=1<<30,CAPTURE=1<<16;
test('OR-ing DEFAULT into a capture layer excludes the node from the capture camera',()=>{
  assert.equal(cameraIncludesNodeLayer(CAPTURE,DEFAULT|CAPTURE),false);
  const result=validateCaptureVisibility(CAPTURE,[{path:'floor',layer:DEFAULT|CAPTURE,expectedIncluded:true}]);
  assert.equal(result.ok,false);assert.equal(result.errors[0].code,'CAPTURE_LAYER_MISMATCH');
});
test('exclusive capture layers include the backdrop while excluding the distortion surface',()=>{
  assert.equal(validateCaptureVisibility(CAPTURE,[{path:'floor',layer:CAPTURE,expectedIncluded:true},{path:'distortion',layer:DEFAULT,expectedIncluded:false}]).ok,true);
  assert.equal(cameraIncludesNodeLayer(DEFAULT|CAPTURE,CAPTURE),true);
});
test('a broadened capture mask cannot include its own distortion surface',()=>{
  assert.equal(validateCaptureVisibility(DEFAULT|CAPTURE,[{path:'distortion',layer:DEFAULT,expectedIncluded:false}]).ok,false);
  assert.equal(validateCaptureVisibility(CAPTURE,[]).complete,false);
});
