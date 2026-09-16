'use strict';
function unityTextureSampling(text){
 const number=(key,fallback)=>Number(text.match(new RegExp('^\\s*'+key+':\\s*(-?\\d+)','m'))?.[1]??fallback);
 const filter=number('filterMode',1),mips=number('enableMipMap',0)===1;
 return {minfilter:filter===0?'nearest':'linear',magfilter:filter===0?'nearest':'linear',mipfilter:mips?(filter===2?'linear':'nearest'):'none',anisotropy:Math.max(1,number('aniso',1))};
}
module.exports={unityTextureSampling};
