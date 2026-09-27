'use strict';
// Creator 3.8.8 scene-culling.ts and particle CPU camera selection require
// every node-layer bit in the camera mask (unlike Unity's intersection test).
function cameraIncludesNodeLayer(visibility, layer) { return (visibility & layer) === layer; }
function validateCaptureVisibility(visibility, entries) {
  const errors=[];
  for(const entry of entries) {
    const included=cameraIncludesNodeLayer(visibility,entry.layer);
    if(included!==entry.expectedIncluded)errors.push({code:'CAPTURE_LAYER_MISMATCH',path:entry.path,layer:entry.layer,visibility,expectedIncluded:entry.expectedIncluded,included});
  }
  return {ok:errors.length===0&&entries.length>0,complete:entries.length>0,errors,checked:entries.length};
}
module.exports={cameraIncludesNodeLayer,validateCaptureVisibility};
