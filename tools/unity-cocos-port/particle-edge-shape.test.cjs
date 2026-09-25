'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {applyUnityParticleDataToCocos}=require('./particle-system-converter');
// Tanks! DustTrail_Jungle: Unity single-sided Edge (type 12), radius 0.1669, emitting toward shape +Y.
test('Unity single-sided edge becomes a Box volume flattened to a 2*radius line turned toward +Y',()=>{
  const objects=[{_shapeModule:{__id__:1}},{arcSpeed:{__id__:2}},{}];
  applyUnityParticleDataToCocos({objects},0,{ShapeModule:{enabled:true,type:12,radius:{value:0.16686675,mode:0},m_Rotation:{x:0,y:0,z:0},m_Scale:{x:1.5,y:1,z:1}}});
  const shape=objects[1];
  assert.equal(shape._shapeType,0);assert.equal(shape.emitFrom,3);
  assert.deepEqual([shape._scale.x,shape._scale.y,shape._scale.z],[2*0.16686675*1.5,0,0]);
  assert.deepEqual([shape._rotation.x,shape._rotation.y,shape._rotation.z],[90,0,0]);
});
