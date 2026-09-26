'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {validateRuntimeCaptureCache}=require('./runtime-capture-cache.cjs');
function fixture(){
 const root=path.resolve('capture-cache-test'),name='effect-frame-00018',png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(1280,16);png.writeUInt32BE(720,20);
 const digest=crypto.createHash('sha256').update(png).digest('hex'),record={ok:true,captureDigest:'source',sha256:digest},manifest={ok:true,captureBinding:{digest:'source',recipe:{viewport:[1280,720]}},checkpoints:{cases:[{name,ok:true,sha256:digest}]}};
 const options={manifestPath:path.join(root,'manifest.json'),bindingDigest:'source',viewport:[1280,720],caseNames:[name],readFileSync(file){if(file.endsWith('manifest.json'))return JSON.stringify(manifest);if(file.endsWith('.json'))return JSON.stringify(record);return png;}};
 return {options,record,manifest,png};
}
test('complete source-bound image evidence can be reused without writes',()=>assert.equal(validateRuntimeCaptureCache(fixture().options).valid,true));
for(const [name,mutate] of [
 ['failed receipt',f=>f.manifest.ok=false],['stale source',f=>f.options.bindingDigest='changed'],['wrong viewport',f=>f.options.viewport=[720,1280]],
 ['missing case',f=>f.manifest.checkpoints.cases=[]],['failed case',f=>f.record.ok=false],['stale checkpoint',f=>f.record.captureDigest='old'],
 ['changed PNG',f=>f.png[12]=1],['mismatched PNG dimensions',f=>f.png.writeUInt32BE(10,16)],['mismatched receipt hash',f=>f.manifest.checkpoints.cases[0].sha256='other'],
 ['path traversal',f=>f.options.caseNames=['../escape']]
])test(`cache rejects ${name}`,()=>{const f=fixture();mutate(f);assert.equal(validateRuntimeCaptureCache(f.options).valid,false);});
