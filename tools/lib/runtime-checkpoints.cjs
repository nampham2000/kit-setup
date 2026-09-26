'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

function validateCheckpoints(cases){
  if(!Array.isArray(cases)||cases.length<1||cases.length>2048)throw new Error('Runtime checkpoints require 1-2048 cases');
  const names=new Set();
  for(const entry of cases){
    if(!entry||!/^\w[\w.-]{0,119}$/.test(entry.name||'')||names.has(entry.name))throw new Error('Invalid or duplicate runtime checkpoint name');
    names.add(entry.name);
    if(typeof entry.expression!=='string'||!entry.expression.trim()||entry.expression.length>1048576)throw new Error('Missing or oversized checkpoint expression');
  }
  return cases;
}

/** Reuse one isolated Preview session; every case must establish its own state. */
async function captureRuntimeCheckpoints(session,sessionId,cases,options){
  validateCheckpoints(cases);
  const records=[];
  for(const entry of cases){
    const record={name:entry.name,ok:false};
    const exceptionsBefore=options.eventCounts?.exceptions||0,errorsBefore=options.eventCounts?.consoleErrors||0;
    try {
      const evaluated=await session.send('Runtime.evaluate',{expression:entry.expression,returnByValue:true,awaitPromise:true,timeout:60000},sessionId);
      if(evaluated?.exceptionDetails)throw new Error(evaluated.exceptionDetails.exception?.description||evaluated.exceptionDetails.text||'Checkpoint evaluation failed');
      record.value=evaluated?.result?.value;
      if(record.value===undefined)throw new Error('Checkpoint returned no evidence');
      if(entry.requireOk&&record.value?.ok!==true)throw new Error('Checkpoint evidence must contain ok=true');
      const dimensions=await session.send('Runtime.evaluate',{expression:'(()=>{const c=document.querySelector("canvas");return c?{width:c.width,height:c.height}:null})()',returnByValue:true},sessionId);
      record.viewport=dimensions?.result?.value;
      if(options.viewportSize&&(record.viewport?.width!==options.viewportSize.width||record.viewport?.height!==options.viewportSize.height))throw new Error('Checkpoint canvas differs from reference viewport');
      const screenshot=await session.send('Page.captureScreenshot',{format:'png'},sessionId);
      if(!screenshot?.data)throw new Error('Checkpoint screenshot missing');
      const bytes=Buffer.from(screenshot.data,'base64');
      if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.subarray(12,16).toString()!=='IHDR')throw new Error('Checkpoint screenshot is not PNG');
      if(options.viewportSize&&(bytes.readUInt32BE(16)!==options.viewportSize.width||bytes.readUInt32BE(20)!==options.viewportSize.height))throw new Error('Checkpoint PNG differs from reference viewport');
      const file=path.join(options.directory,entry.name+'.png');
      fs.mkdirSync(options.directory,{recursive:true});fs.writeFileSync(file,bytes);
      record.screenshot=file;record.sha256=crypto.createHash('sha256').update(bytes).digest('hex');
      record.ok=(options.eventCounts?.exceptions||0)===exceptionsBefore&&(options.eventCounts?.consoleErrors||0)===errorsBefore;
      if(!record.ok)record.error='New runtime exception or console error during checkpoint';
    }catch(error){record.error=error.message;}
    records.push(record);
    options.onCheckpoint?.(record);
    if(!record.ok&&options.failFast!==false)break;
  }
  return {ok:records.length===cases.length&&records.every(record=>record.ok),requested:cases.length,complete:records.length===cases.length,cases:records};
}
module.exports={validateCheckpoints,captureRuntimeCheckpoints};
