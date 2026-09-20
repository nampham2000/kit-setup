'use strict';
// Use only after measuring imported V=1-UnityV. Conjugate the complete
// source UV transform instead of reversing time or changing particle size.
// Keep the shared particle shader unchanged and own variants per renderer.
function reflectedST(scaleY,offsetY,speedY,time,cocosV) {
  return cocosV*scaleY+(1-scaleY-offsetY)-speedY*time;
}
function convertReflectedParticleMaterial(properties) {
  if (properties.distortion?.z) throw new Error('Flow distortion needs a separately validated UV adapter');
  const result=JSON.parse(JSON.stringify(properties));
  for(const key of ['mainST','noiseST','flowST','maskST']) {
    const st=result[key];
    if(st)st.w=1-st.y-st.w;
  }
  if(result.uvSpeed){result.uvSpeed.y=-result.uvSpeed.y;result.uvSpeed.w=-result.uvSpeed.w;}
  if(result.distortion)result.distortion.y=-result.distortion.y;
  return result;
}
module.exports={reflectedST,convertReflectedParticleMaterial};
