'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
/** Read-only reuse gate. A successful case cannot rescue a failed overall capture. */
function validateRuntimeCaptureCache({manifestPath,bindingDigest,viewport,caseNames,readFileSync=fs.readFileSync}){
 try{
  const read=p=>JSON.parse(readFileSync(p,'utf8')),manifest=read(manifestPath);
  if(manifest.ok!==true)return {valid:false,reason:'capture-failed'};
  if(manifest.captureBinding?.digest!==bindingDigest)return {valid:false,reason:'source-binding'};
  if(JSON.stringify(manifest.captureBinding?.recipe?.viewport)!==JSON.stringify(viewport))return {valid:false,reason:'viewport-recipe'};
  const cases=manifest.checkpoints?.cases||[];
  if(cases.length!==caseNames.length||new Set(cases.map(c=>c.name)).size!==cases.length||caseNames.some(name=>!cases.some(c=>c.name===name&&c.ok===true)))return {valid:false,reason:'case-coverage'};
  for(const name of caseNames){
   if(!/^[a-zA-Z0-9_-]+$/.test(name))return {valid:false,reason:'case-path'};
   const base=path.join(path.dirname(manifestPath),name),record=read(base+'.json'),png=readFileSync(base+'.png');
   if(record.ok!==true||record.captureDigest!==bindingDigest)return {valid:false,reason:'case-binding'};
   if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==viewport[0]||png.readUInt32BE(20)!==viewport[1])return {valid:false,reason:'image-viewport'};
   const digest=crypto.createHash('sha256').update(png).digest('hex');
   if(digest!==record.sha256||digest!==cases.find(c=>c.name===name).sha256)return {valid:false,reason:'image-hash'};
  }
  return {valid:true,manifest};
 }catch(error){return {valid:false,reason:error.code||error.message};}
}
module.exports={validateRuntimeCaptureCache};
