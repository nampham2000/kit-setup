'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { particleRendererContract: contract } = require('./particle-renderer-contract');
test('Local billboard is source-frame clockwise, mesh is counter-clockwise', () => {
  const local = contract({}, {m_RenderMode:0,m_RenderAlignment:2});
  assert.deepEqual(local.eulerSigns,[1,1,-1]);
  assert.equal(local.cocosAlignment,0);
  assert.equal(local.sourceRendererPivot[3],2);
  assert.equal(local.requiresMaterialAdapter,true);
  assert.deepEqual(contract({}, {m_RenderMode:4,m_RenderAlignment:2}).eulerSigns,[-1,-1,1]);
  assert.equal(contract({}, {m_RenderMode:0,m_RenderAlignment:0}).requiresMaterialAdapter,false);
});
test('Velocity world-frame shortcut requires every source proof', () => {
  const p={ShapeModule:{enabled:1,type:5,randomDirectionAmount:0,sphericalDirectionAmount:0,m_Rotation:{x:0,y:0,z:0}},InitialModule:{startSpeed:{minMaxState:0,scalar:35},gravityModifier:{minMaxState:0,scalar:0}},VelocityModule:{enabled:0},ForceModule:{enabled:0},NoiseModule:{enabled:0}};
  const r={m_RenderMode:4,m_RenderAlignment:4};
  assert.equal(contract(p,r).straightBoxVelocity,true);
  assert.equal(contract(p,r).cocosAlignment,0);
  for(const key of ['VelocityModule','ForceModule','NoiseModule']) {
    const changed=structuredClone(p);changed[key].enabled=1;
    assert.equal(contract(changed,r).straightBoxVelocity,false);
  }
  const missing=structuredClone(p);delete missing.ShapeModule.m_Rotation;
  assert.equal(contract(missing,r).straightBoxVelocity,false);
  const random=structuredClone(p);random.InitialModule.gravityModifier.minMaxState=3;
  assert.equal(contract(random,r).straightBoxVelocity,false);
});
test('Pivot is per-renderer and unmeasured axes stay blocking',()=>{
  assert.deepEqual(contract({}, {m_RenderMode:1,m_Pivot:{x:0,y:1,z:0}}).sourceRendererPivot,[0,1,0,0]);
  assert.ok(contract({}, {m_RenderMode:0,m_RenderAlignment:2,m_Pivot:{x:0,y:0,z:.1}}).unsupported.includes('pivot-axes'));
  assert.deepEqual(contract({}, {m_RenderMode:0,m_Pivot:{x:.15,y:0,z:.1}}).sourceRendererPivot,[.15,0,.1,0]);
  assert.deepEqual(contract({}, {m_RenderMode:4,m_RenderAlignment:1}).sourceRendererPivot,[0,0,0,3]);
});
test('Min/Max Particle Size keep Unity defaults and only the measured stretched maximum',()=>{
  assert.deepEqual(contract({}, {m_RenderMode:0}).sourceRendererSize,[0,0.5,0,1]);
  assert.deepEqual(contract({}, {m_RenderMode:0,m_MinParticleSize:'',m_MaxParticleSize:null}).sizeClamp,{min:0,max:0.5});
  assert.deepEqual(contract({}, {m_RenderMode:2,m_MinParticleSize:0.1,m_MaxParticleSize:25}).sourceRendererSize,[0.1,25,0,1]);
  assert.deepEqual(contract({}, {m_RenderMode:1,m_MaxParticleSize:0.5}).unsupported,[]);
  assert.ok(contract({}, {m_RenderMode:1,m_MinParticleSize:0.2}).unsupported.includes('stretched-min-particle-size'));
  assert.deepEqual(contract({}, {m_RenderMode:0,m_MinParticleSize:0.2}).unsupported,[]);
});
// JellyCubeRun2048 ParHitEffect: Blast (Facing, start size 25, Size over Lifetime curve peaking at 1,
// max particle size 0.3) is clamped by Unity to 0.3 viewport widths; the builtin effect cannot clamp.
test('particles large enough to reach the Min/Max Particle Size clamp use the source effect', () => {
  const blast = { InitialModule: { startSize: { minMaxState: 0, scalar: 25 } }, SizeModule: { enabled: 1, curve: { minMaxState: 1, scalar: 1, maxCurve: { m_Curve: [{ value: 0 }, { value: 1 }] } } } };
  const spark = { InitialModule: { startSize: { minMaxState: 3, scalar: 0.5, minScalar: 0.2 } }, SizeModule: { enabled: 1, curve: { minMaxState: 1, scalar: 0.5, maxCurve: { m_Curve: [{ value: 1 }, { value: 0 }] } } } };
  for (const alignment of [0, 3]) {
    const c = contract(blast, { m_RenderMode: 0, m_RenderAlignment: alignment, m_MaxParticleSize: 0.3 });
    assert.equal(c.clampReachable, true);
    assert.equal(c.requiresMaterialAdapter, true);
    assert.deepEqual(c.sourceRendererSize, [0, 0.3, 0, 1]);
  }
  assert.equal(contract(blast, { m_RenderMode: 1, m_MaxParticleSize: 0.3 }).requiresMaterialAdapter, true, 'stretched widths are clamped too');
  assert.equal(contract(spark, { m_RenderMode: 0, m_RenderAlignment: 0, m_MaxParticleSize: 0.3 }).requiresMaterialAdapter, false, '0.25 m View billboards keep the builtin effect');
  assert.equal(contract(blast, { m_RenderMode: 4, m_MaxParticleSize: 0.3 }).clampReachable, false, 'mesh particles are never clamped');
  assert.equal(contract({ InitialModule: { startSize: { minMaxState: 0, scalar: 0.8 } } }, { m_RenderMode: 0 }).requiresMaterialAdapter, false, 'default 0.5 clamp needs over 1 m');
});

test('scalar mesh axis binding is bounded to measured local Sphere births',()=>{
 const p={moveWithTransform:0,InitialModule:{rotation3D:false},ShapeModule:{enabled:true,type:0,radius:{value:.01},arc:{mode:0},m_Rotation:{x:0,y:0,z:0}}},r={m_RenderMode:4,m_RenderAlignment:2};
 assert.equal(!!contract(p,r).meshScalarAxis,true);
 for(const changed of [{...p,moveWithTransform:1},{...p,InitialModule:{rotation3D:true}},{...p,RotationModule:{enabled:true}},{...p,ShapeModule:{...p.ShapeModule,type:2}}])assert.equal(!!contract(changed,r).meshScalarAxis,false);
 assert.equal(!!contract(p,{...r,m_RenderAlignment:1}).meshScalarAxis,false);
});
