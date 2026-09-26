'use strict';
function randomForceContract(source){
 const force=source?.ForceModule;if(!force?.enabled||!force.randomizePerFrame)return null;
 const unsupported=[];
 for(const axis of ['x','y','z'])if(Number(force[axis]?.minMaxState)!==3)unsupported.push('XYZ two-constant ranges required');
 if(!force.inWorldSpace)unsupported.push('Local force space not measured');
 if(unsupported.length)throw new Error('Unverified randomized Force: '+unsupported.join(', '));
 return{autoRandomSeed:!!source.autoRandomSeed,randomSeed:Number(source.randomSeed)>>>0,
  x:[Number(force.x.minScalar),Number(force.x.scalar)],y:[Number(force.y.minScalar),Number(force.y.scalar)],z:[-Number(force.z.scalar),-Number(force.z.minScalar)]};
}
module.exports={randomForceContract};
