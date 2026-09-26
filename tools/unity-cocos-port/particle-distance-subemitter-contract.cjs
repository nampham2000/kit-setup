'use strict';
function distanceSubEmitterContract(entry,target){
  const e=target?.EmissionModule;
  if(Number(entry.type)!==0||!e?.enabled||!(Number(e.rateOverDistance?.scalar)>0))return null;
  const unsupported=[];
  if(Number(e.rateOverDistance.minMaxState)!==0)unsupported.push('random/curve distance rate');
  if(Number(e.rateOverTime?.minMaxState)!==0||Number(e.rateOverTime?.scalar)!==0)unsupported.push('combined time emission');
  if(Number(e.m_BurstCount||0)!==0||(e.m_Bursts||[]).length)unsupported.push('combined burst emission');
  if(Number(entry.properties||0)!==0)unsupported.push('inheritance');
  if(Number(entry.emitProbability??1)!==1)unsupported.push('random birth probability');
  const space=Number(target.moveWithTransform);
  if(![0,1].includes(space))unsupported.push('custom simulation space');
  if(unsupported.length)throw new Error('Unverified distance sub-emitter: '+unsupported.join(', '));
  return{rate:Number(e.rateOverDistance.scalar),simulationSpace:space===0?1:0};
}
module.exports={distanceSubEmitterContract};
