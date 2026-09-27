'use strict';
function contentProbeClips(width,height,extra=[]){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw Error('Invalid content probe viewport');
 if(!Array.isArray(extra)||extra.length>16||extra.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1)))throw Error('Content probes must be at most 16 normalized [x,y] points');
 const sizeX=Math.min(16,width),sizeY=Math.min(16,height);
 return [[.15,.15],[.5,.5],[.8,.8],...extra].map(([x,y])=>({x:Math.min(width-sizeX,Math.floor(width*x)),y:Math.min(height-sizeY,Math.floor(height*y)),width:sizeX,height:sizeY,scale:1}));
}
module.exports={contentProbeClips};
