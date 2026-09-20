'use strict';
// Use only after measuring imported V=1-UnityV. Conjugate the complete
// source UV transform instead of reversing time or changing particle size.
// Own variants per renderer; flow needs the opt-in reflected displacement shader.
function reflectedST(scaleY,offsetY,speedY,time,cocosV) {
  return cocosV*scaleY+(1-scaleY-offsetY)-speedY*time;
}
function convertReflectedParticleMaterial(properties, options = {}) {
  if (properties.distortion?.z && !options.reflectedFlow) throw new Error('Flow distortion needs a separately validated UV adapter');
  const result=JSON.parse(JSON.stringify(properties));
  for(const key of ['mainST','noiseST','flowST','maskST','normalST']) {
    const st=result[key];
    if(st)st.w=1-st.y-st.w;
  }
  if(result.uvSpeed){result.uvSpeed.y=-result.uvSpeed.y;result.uvSpeed.w=-result.uvSpeed.w;}
  if(result.distortion)result.distortion.y=-result.distortion.y;
  return result;
}
// For Cocos texture coordinates (u,1-v), conjugating source uv-flow gives
// target uv-(flow.x,-flow.y). Keep the sign independent of sampled color.
function reflectedFlowOffset(x,y) { return [x,-y]; }
// Native BakeTrailsMesh: newest-to-oldest U is unchanged; across the
// camera-facing ribbon, imported Cocos V is 1-Unity V. Lit trail sampling
// therefore needs the same conjugation, including the normal-map atlas.
function convertReflectedLitTrailMaterial(properties) {
  return convertReflectedParticleMaterial(properties);
}
const reflectedFlowGlsl=`vec2 flowOffset=sourceSample(flowTexture,flowUV,textureSrgb.z,textureAlpha.z).xy*mask.xy*distortion.z;
      #if AOE_REFLECTED_FLOW
        flowOffset.y=-flowOffset.y;
      #endif
      mainUV-=flowOffset;`;
function patchReflectedFlow(source) {
  if(source.includes(reflectedFlowGlsl))return source;
  const previous='mainUV-=sourceSample(flowTexture,flowUV,textureSrgb.z,textureAlpha.z).xy*mask.xy*distortion.z;';
  if(!source.includes(previous))throw new Error('Unknown particle flow shader contract');
  return source.replace(previous,reflectedFlowGlsl);
}
module.exports={reflectedST,reflectedFlowOffset,convertReflectedParticleMaterial,convertReflectedLitTrailMaterial,patchReflectedFlow};
