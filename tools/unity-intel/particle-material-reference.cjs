'use strict';
// Compare the active shader model, not similarly named serialized properties.
// Values here are GPU-linear coefficients, not display-space brightness scores.
function particleMultiplyContract({shader, gpuColor, srcBlend, dstBlend, keywords=[]}) {
 if(!Array.isArray(gpuColor)||gpuColor.length!==4||gpuColor.some(v=>!Number.isFinite(v)||v<0))throw Error('A finite nonnegative GPU RGBA color is required');
 let factor, property, rgbPremultiplyAlpha=false;
 if(shader==='Legacy Shaders/Particles/Additive'||shader==='Legacy Shaders/Particles/Alpha Blended'){
  factor=2;property='_TintColor';
  const expected=shader.endsWith('/Additive')?[5,1]:[5,10];
  if(srcBlend!==expected[0]||dstBlend!==expected[1])throw Error('Legacy blend contract mismatch');
 }else if(shader==='Legacy Shaders/Particles/Additive (Soft)'){
  if(srcBlend!==1||dstBlend!==6)throw Error('Legacy soft-additive blend contract mismatch');
  if(gpuColor.some(v=>v!==1))throw Error('Legacy soft-additive has no material tint multiplier');
  factor=1;property=null;rgbPremultiplyAlpha=true;
 }else if(shader==='Universal Render Pipeline/Particles/Unlit'){
  const supported=new Set(['_SURFACE_TYPE_TRANSPARENT']);
  if(keywords.some(k=>!supported.has(k)))throw Error('Unmeasured URP particle keyword');
  if(!keywords.includes('_SURFACE_TYPE_TRANSPARENT')||srcBlend!==5||![1,10].includes(dstBlend))throw Error('Unsupported URP particle blend');
  factor=1;property='_BaseColor';
 }else throw Error('Unsupported particle multiply shader: '+shader);
 return {shader,property,srcBlend,dstBlend,rgbaCoefficient:gpuColor.map(v=>v*factor),alphaClamp:factor===2,rgbPremultiplyAlpha};
}
function assertParticleMaterialReference(candidate,reference){
 const differences=[];
 for(const key of ['shader','property','srcBlend','dstBlend','rgbaCoefficient','alphaClamp','rgbPremultiplyAlpha'])
  if(!Object.hasOwn(candidate,key)||!Object.hasOwn(reference,key)||JSON.stringify(candidate[key])!==JSON.stringify(reference[key]))differences.push(key);
 if(differences.length)throw Object.assign(Error('Particle material reference differs: '+differences.join(', ')),{code:'PARTICLE_MATERIAL_REFERENCE_MISMATCH',differences});
 return true;
}
module.exports={particleMultiplyContract,assertParticleMaterialReference};
