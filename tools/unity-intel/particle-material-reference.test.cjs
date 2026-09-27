'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {particleMultiplyContract:contract,assertParticleMaterialReference:compare}=require('./particle-material-reference.cjs');
const legacy={shader:'Legacy Shaders/Particles/Additive',gpuColor:[0.214041144,0.214041144,0.214041144,0.5],srcBlend:5,dstBlend:1};
const urp={shader:'Universal Render Pipeline/Particles/Unlit',gpuColor:[1,1,1,1],srcBlend:5,dstBlend:1,keywords:['_SURFACE_TYPE_TRANSPARENT']};
test('legacy gray tint and URP white base preserve equal alpha but different RGB',()=>{
 const a=contract(legacy),b=contract(urp);
 assert.deepEqual(a.rgbaCoefficient,[0.428082288,0.428082288,0.428082288,1]);
 assert.deepEqual(b.rgbaCoefficient,[1,1,1,1]);
 assert.equal(a.alphaClamp,true);assert.equal(b.alphaClamp,false);
 assert.throws(()=>compare(a,b),{code:'PARTICLE_MATERIAL_REFERENCE_MISMATCH'});
 assert.equal(compare(a,structuredClone(a)),true);
});
test('alpha blend is independently bound and cannot be confused with additive',()=>{
 const a=contract({...legacy,shader:'Legacy Shaders/Particles/Alpha Blended',dstBlend:10});
 assert.throws(()=>compare(a,contract(legacy)),/dstBlend/);
 assert.throws(()=>contract({...legacy,dstBlend:10}),/blend contract/);
 assert.equal(contract({...urp,dstBlend:10}).dstBlend,10);
});
test('reject unmeasured color modes, fades, premultiplication and missing transparency',()=>{
 for(const keyword of ['_COLOROVERLAY_ON','_COLORADDSUBDIFF_ON','_SOFTPARTICLES_ON','_FADING_ON','_ALPHAPREMULTIPLY_ON'])
  assert.throws(()=>contract({...urp,keywords:[...urp.keywords,keyword]}),/Unmeasured/);
 assert.throws(()=>contract({...urp,keywords:[]}),/Unsupported/);
 assert.throws(()=>contract({...urp,srcBlend:1}),/Unsupported/);
});
test('incomplete and invalid material evidence cannot pass',()=>{
 assert.throws(()=>contract({...urp,gpuColor:[1,1,NaN,1]}),/finite/);
 assert.throws(()=>contract({...urp,shader:'Unknown'}),/Unsupported/);
 assert.throws(()=>compare({},{}),/reference differs/);
});
test('soft-additive mist is not interchangeable with URP additive despite equal white coefficients',()=>{
 const soft=contract({shader:'Legacy Shaders/Particles/Additive (Soft)',gpuColor:[1,1,1,1],srcBlend:1,dstBlend:6});
 assert.deepEqual(soft.rgbaCoefficient,contract(urp).rgbaCoefficient);
 assert.equal(soft.property,null);assert.equal(soft.rgbPremultiplyAlpha,true);
 assert.throws(()=>compare(soft,contract(urp)),/rgbPremultiplyAlpha/);
 assert.throws(()=>contract({...legacy,shader:soft.shader}),/blend contract/);
 assert.throws(()=>contract({shader:soft.shader,gpuColor:[.5,.5,.5,1],srcBlend:1,dstBlend:6}),/no material tint/);
});
