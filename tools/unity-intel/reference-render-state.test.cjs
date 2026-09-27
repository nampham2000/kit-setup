const {test}=require('node:test'),assert=require('node:assert/strict');
const {assertReferenceRenderState}=require('./reference-render-state.cjs');
const expected={renderPipeline:'Built-in',colorSpace:'Linear',pixelLightCount:150,antiAliasing:4,softParticles:true,lightsUseLinearIntensity:true};
test('reference uses the active pipeline, not the camera Forward label',()=>{
 assert.throws(()=>assertReferenceRenderState({...expected,renderPipeline:'UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset',renderingPath:'Forward'},expected),/renderPipeline/);
 assert.equal(assertReferenceRenderState({...expected,renderingPath:'Forward'},expected),true);
});
test('missing quality asset defaults and old manifests cannot pass reference acceptance',()=>{
 assert.throws(()=>assertReferenceRenderState({...expected,pixelLightCount:4},expected),/pixelLightCount/);
 assert.throws(()=>assertReferenceRenderState({colorSpace:'Linear'},expected),/Reference render-state mismatch/);
 for(const key of ['antiAliasing','softParticles','lightsUseLinearIntensity'])assert.throws(()=>assertReferenceRenderState({...expected,[key]:false},expected),new RegExp(key));
});
test('an incomplete expected contract is rejected',()=>assert.throws(()=>assertReferenceRenderState(expected,{renderPipeline:'Built-in'}),/Missing expected/));
