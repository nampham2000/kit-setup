'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateCheckpoints,captureRuntimeCheckpoints}=require('./lib/runtime-checkpoints.cjs');
const image=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(image);image.write('IHDR',12);image.writeUInt32BE(1280,16);image.writeUInt32BE(720,20);const png=image.toString('base64');
function fake(overrides={}){const calls=[];return {calls,send:async(method,params)=>{calls.push({method,params});if(method==='Page.captureScreenshot')return {data:png};if(params.expression.includes('querySelector'))return {result:{value:{width:1280,height:720}}};return overrides.evaluated||{result:{value:{ok:true}}};}};}
test('reuses the same target, captures every case and binds screenshot hashes',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-checkpoints-'));
  try {const session=fake();const result=await captureRuntimeCheckpoints(session,'same-target',[{name:'a',expression:'resetA()',requireOk:true},{name:'b',expression:'resetB()',requireOk:true}],{directory,viewportSize:{width:1280,height:720}});
    assert.equal(result.ok,true);assert.equal(result.cases.length,2);assert.match(result.cases[0].sha256,/^[a-f0-9]{64}$/);assert.equal(session.calls.filter(call=>call.method==='Page.captureScreenshot').length,2);
  }finally{assert.equal(path.dirname(fs.realpathSync(directory)),fs.realpathSync(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});}
});
test('fails closed for thrown evaluation, missing evidence, negative assertion and viewport drift',async()=>{
  for(const evaluated of [{exceptionDetails:{text:'bad shader'}},{result:{}},{result:{value:{ok:false}}},{result:{value:{ok:true}}}]){
    const result=await captureRuntimeCheckpoints(fake({evaluated}),'target',[{name:'a',expression:'probe()',requireOk:true},{name:'b',expression:'probe()'}],{directory:os.tmpdir(),viewportSize:{width:720,height:1280}});
    assert.equal(result.ok,false);assert.equal(result.complete,false);assert.equal(result.cases.length,1);assert.ok(result.cases[0].error);
  }
});
test('checkpoint filenames are unique and cannot escape output',()=>{
  for(const cases of [[],[{name:'../escape',expression:'a'}],[{name:'a',expression:''}],[{name:'a',expression:'a'},{name:'a',expression:'b'}]])assert.throws(()=>validateCheckpoints(cases));
});
