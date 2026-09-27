'use strict';
const fs=require('node:fs'),path=require('node:path');
const {writeGeneratedAssetText}=require('./generated-asset-writer.cjs');
function particleLightsContract(module,light){
  if(!module.enabled||module.ratio===0)return null;
  if(module.ratio!==1)throw new Error('Unverified particle-light random ratio');
  if(!light||light.type!==2||light.shadows!==0||light.useColorTemperature)throw new Error('Unsupported native particle-light template');
  if(module.rangeCurve.minMaxState!==0||module.intensityCurve.minMaxState!==0)throw new Error('Unverified particle-light curve/random multiplier');
  return{range:light.range,intensity:light.intensity,color:light.color,rangeMultiplier:module.rangeCurve.scalar,intensityMultiplier:module.intensityCurve.scalar,
    useParticleColor:module.color,sizeAffectsRange:module.range,alphaAffectsIntensity:module.intensity,maxLights:module.maxLights};
}
function stageParticleLightsRuntime(root){for(const name of ['UnityParticleLightKernel','UnityParticleLightsAdapter'])writeGeneratedAssetText(path.join(root,'assets/script',name+'.ts'),fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{cocosRoot:root});}
module.exports={particleLightsContract,stageParticleLightsRuntime};
