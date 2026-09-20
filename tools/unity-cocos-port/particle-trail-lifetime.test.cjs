'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {applyTrailModule}=require('./particle-system-converter');
function convert(lifetime){
  const objects=[{startLifetime:{__id__:1},_trailModule:{__id__:2}},{mode:0,constant:1},{lifeTime:{__id__:3}},{mode:0,constant:1}];
  applyTrailModule({objects,add(v){return objects.push(v)-1;}},objects[0],{enabled:true,lifetime});
  return{objects,range:objects[3]};
}
test('short trail lifetime stays authored while Cocos allocates a >=1s envelope',()=>{
  const {objects,range}=convert({minMaxState:0,scalar:.3});
  assert.equal(range.mode,1);assert.equal(range.multiplier,1);
  assert.deepEqual(objects[range.spline.__id__]._values.map(v=>v.value),[.3,.3]);
});
test('random short lifetime retains both endpoints',()=>{
  const {objects,range}=convert({minMaxState:3,minScalar:.1,scalar:.3});
  assert.equal(range.mode,2);assert.equal(range.multiplier,1);
  assert.equal(objects[range.splineMin.__id__]._values[0].value,.1);
  assert.equal(objects[range.splineMax.__id__]._values[0].value,.3);
});
test('long lifetime is unchanged',()=>{
  const {range}=convert({minMaxState:0,scalar:2});assert.equal(range.mode,0);assert.equal(range.constant,2);
});
test('curve allocation normalization retains evaluated values and tangents',()=>{
  const {objects,range}=convert({minMaxState:1,scalar:.4,maxCurve:{m_Curve:[{time:0,value:.5,inSlope:2,outSlope:2},{time:1,value:1,inSlope:0,outSlope:0}]}});
  assert.equal(range.multiplier,1);
  const values=objects[range.spline.__id__]._values;
  assert.equal(values[0].value,.2);assert.equal(values[1].value,.4);
  assert.equal(values[0].rightTangent,.8);
});
