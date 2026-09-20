'use strict';
function active(c){
  if(!c)return false;
  if(c.minMaxState===0)return c.scalar!==0;
  if(c.minMaxState===3)return c.scalar!==0||c.minScalar!==0;
  return (c.minMaxState===1?[c.maxCurve]:[c.maxCurve,c.minCurve]).some(v=>v?.m_Curve?.some(k=>k.value!==0||k.inSlope!==0||k.outSlope!==0));
}
function particleOrbitContract(p){
  const v=p.VelocityModule;
  if(!v?.enabled||!['orbitalX','orbitalY','orbitalZ','radial'].some(k=>active(v[k])))return {enabled:false};
  return {enabled:true,version:1,simulationSpace:p.moveWithTransform,inWorldSpace:!!v.inWorldSpace,
    noiseEnabled:!!p.NoiseModule?.enabled,limitEnabled:!!p.ClampVelocityModule?.enabled,velocity:JSON.parse(JSON.stringify(v))};
}
module.exports={particleOrbitContract};
