'use strict';
// Camera.actualRenderingPath can report Forward while URP is active. Only
// GraphicsSettings.currentRenderPipeline identifies the active pipeline.
const KEYS=['renderPipeline','colorSpace','pixelLightCount','antiAliasing','softParticles','lightsUseLinearIntensity'];
function assertReferenceRenderState(actual,expected){
 const failures=[];
 for(const key of KEYS){
  if(!Object.hasOwn(expected,key))throw Error('Missing expected render-state field: '+key);
  if(!Object.hasOwn(actual,key)||actual[key]!==expected[key])failures.push(`${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`);
 }
 if(failures.length)throw Error('Reference render-state mismatch: '+failures.join('; '));
 return true;
}
module.exports={assertReferenceRenderState};
