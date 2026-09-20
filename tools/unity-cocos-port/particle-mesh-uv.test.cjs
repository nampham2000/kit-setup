'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reflectedST,convertReflectedParticleMaterial}=require('./particle-mesh-uv');
test('mesh texture boundary preserves authored UV math with signed scrolling, tiling and offsets',()=>{
  for(const v of [-.2,.17,.81,1.2])for(const scale of [.5,2,-3])for(const offset of [-.3,.4])for(const speed of [-2,1])for(const t of [0,.125,.5,2]){
    const source=v*scale+offset+speed*t;
    assert.ok(Math.abs(reflectedST(scale,offset,speed,t,1-v)-(1-source))<1e-12);
  }
});
test('radial panner direction is preserved after V reflection',()=>{
  // Chain's source Noise V speed is +1. Texture features at constant phase
  // move toward decreasing source V. The imported V derivative must reverse.
  const sourceV=.8,dt=.125;
  const initial=reflectedST(2,0,1,0,1-sourceV);
  const next=reflectedST(2,0,1,dt,1-(sourceV-dt/2));
  assert.ok(Math.abs(initial-next)<1e-12);
  assert.notEqual((1-sourceV)*2,(1-(sourceV-dt/2))*2+dt);
});
test('UV conversion owns a material copy and refuses unmeasured flow distortion',()=>{
  const source={mainST:{x:1,y:2,z:.3,w:.2},uvSpeed:{x:1,y:2,z:3,w:4},distortion:{x:0,y:0,z:0}};
  const target=convertReflectedParticleMaterial(source);
  assert.equal(target.mainST.w,-1.2);assert.equal(target.uvSpeed.w,-4);
  assert.equal(source.mainST.w,.2);assert.equal(source.uvSpeed.w,4);
  assert.throws(()=>convertReflectedParticleMaterial({distortion:{z:1}}),/separately validated/);
});
