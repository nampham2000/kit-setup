'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {applyUnityParticleDataToCocos}=require('./particle-system-converter');
const curve=scalar=>({minMaxState:0,scalar});
test('separate size X reads Unity curve field rather than stale template X',()=>{
  const objects=[{_sizeOvertimeModule:{__id__:1}},{size:{__id__:2},x:{__id__:3},y:{__id__:4},z:{__id__:5}},{},{constant:99},{},{}];
  applyUnityParticleDataToCocos({objects},0,{SizeModule:{enabled:true,separateAxes:true,curve:curve(.4),y:curve(.6),z:curve(.8)}});
  assert.equal(objects[3].constant,.4);assert.equal(objects[4].constant,.6);assert.equal(objects[5].constant,.8);
});
test('mesh axial angles reflect Z as negative X/Y and positive Z',()=>{
  const objects=[{startRotationX:{__id__:1},startRotationY:{__id__:2},startRotationZ:{__id__:3}},{},{},{}];
  applyUnityParticleDataToCocos({objects},0,{InitialModule:{rotation3D:true,startRotationX:curve(.3),startRotationY:curve(.4),startRotation:curve(.5)}},{m_RenderMode:4});
  assert.deepEqual(objects.slice(1).map(c=>c.constant),[-.3,-.4,.5]);
});
