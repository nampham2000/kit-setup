'use strict';
const fs=require('node:fs'),path=require('node:path');
const {writeGeneratedAssetText}=require('./generated-asset-writer.cjs');
function trailRendererContract(source={}){
  const p=source.m_Parameters,g=p?.colorGradient,unsupported=[];
  if(!p||!g)unsupported.push('source-parameters-missing');
  if(p?.alignment!==0)unsupported.push('alignment');
  if(p?.textureMode!==0)unsupported.push('texture-mode');
  // textureScale is absent from pre-2018.3 serializations; Unity reads it as (1,1).
  if(p?.textureScale&&(Number(p.textureScale.x)!==1||Number(p.textureScale.y)!==1))unsupported.push('texture-scale');
  if(p?.numCornerVertices||p?.numCapVertices)unsupported.push('rounded-geometry');
  if(p?.widthCurve?.m_Curve?.some(k=>k.weightedMode))unsupported.push('weighted-width');
  if(g?.m_Mode!==0)unsupported.push('gradient-mode');
  if(source.m_Autodestruct)unsupported.push('autodestruct');
  if(source.m_Emitting===false||Number(source.m_Emitting)===0)unsupported.push('initially-not-emitting');
  if(!(source.m_Time>0))unsupported.push('lifetime');
  const keys=(count,prefix)=>Array.from({length:count||0},(_,i)=>({time:g[prefix+i]/65535,...g['key'+i]}));
  return {time:source.m_Time,minVertexDistance:source.m_MinVertexDistance,widthMultiplier:p?.widthMultiplier,widthKeys:p?.widthCurve?.m_Curve,colors:g?keys(g.m_NumColorKeys,'ctime'):[],alphas:g?keys(g.m_NumAlphaKeys,'atime'):[],applyActiveColorSpace:!!source.m_ApplyActiveColorSpace,unsupported};
}
function stageTrailRendererRuntime(cocosRoot){
  for(const name of ['UnityTrailRendererGeometry','UnityTrailRendererAdapter','UnityNoiseKernel','UnityParticleSorting'])writeGeneratedAssetText(path.join(cocosRoot,'assets/script',name+'.ts'),fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{cocosRoot});
}
function attachTrailRenderer(builder,node,source,{classId,materialUuid,cameraPath,sorting},reporter={high(){},low(){}}){
  const contract=trailRendererContract(source),reasons=[...contract.unsupported];
  if(!classId)reasons.push('AssetDB-script-registration');
  if(!materialUuid)reasons.push('source-color-mesh-material');
  if(!cameraPath)reasons.push('source-camera');
  if(!sorting)reasons.push('source-sorting');
  if(reasons.length){reporter.high('TRAIL_RENDERER_ADAPTER_REQUIRED','','',reasons.join(', '));return false;}
  builder.addComponent(node,classId,{sourceContract:JSON.stringify({...contract,sorting}),sourceMaterial:{__uuid__:materialUuid,__expectedType__:'cc.Material'},cameraPath},null,'native-trail-'+node);
  reporter.low('TRAIL_RENDERER_ADAPTER_BOUND','','','Native View/Stretch source contract bound; verify playback, material colors, lifetime and activation in Preview');return true;
}
/**
 * Generic porter binding for a Unity TrailRenderer (class 96) on a prefab node: the camera is
 * the scene's (empty cameraPath, resolved at runtime from the node layer) and the sort key is
 * the material render queue plus the renderer sorting layer/order, as for particle renderers.
 */
function emitTrailRendererComponent({nodeId,componentId,trail,materialUuid,queue,layer,classId,name,file},builder,reporter){
  const contract=trailRendererContract(trail),reasons=[...contract.unsupported];
  if(!materialUuid)reasons.push('material-unresolved');
  if(!layer.known)reasons.push('sorting-layer-unknown');
  if(reasons.length){reporter.high('TRAIL_RENDERER_UNSUPPORTED',file,name,`Unity TrailRenderer not ported: ${reasons.join(', ')}`);return false;}
  if(!classId){reporter.high('TRAIL_RENDERER_ADAPTER_REQUIRED',file,name,'AssetDB must import assets/script/UnityTrailRendererAdapter.ts; refresh and rerun porter.');return false;}
  const sorting={path:name,fudge:0,queue:queue??3000};
  if(Number(trail.m_SortingOrder))sorting.order=Number(trail.m_SortingOrder);
  if(layer.value)sorting.layer=layer.value;
  const {unsupported,...spec}=contract;
  builder.addComponent(nodeId,classId,{_enabled:Number(trail.m_Enabled??1)!==0,sourceContract:JSON.stringify({...spec,sorting}),
    sourceMaterial:{__uuid__:materialUuid,__expectedType__:'cc.Material'},cameraPath:''},componentId,`cmp-trail-renderer-${componentId}`);
  if(queue==null)reporter.medium('TRAIL_RENDERER_QUEUE_ASSUMED',file,name,'Material render queue unknown; the trail sorts as Transparent (3000).');
  reporter.low('TRAIL_RENDERER_ADAPTER_BOUND',file,name,'Native View/Stretch TrailRenderer attached; verify playback, material colors, lifetime and activation in Preview.');
  return true;
}
module.exports={trailRendererContract,stageTrailRendererRuntime,attachTrailRenderer,emitTrailRendererComponent};
