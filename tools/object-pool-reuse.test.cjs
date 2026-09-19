'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript');
test('prewarmed ObjectPool reuses tracking metadata through repeated get/put cycles',async()=>{
  const file=path.join(__dirname,'../packages/playable-core/utils/pool/ObjectPool.ts');
  const out={};
  new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(()=>({director:{},Director:{}}),out);
  const pool=new out.ObjectPool();let created=0;
  const handle=pool.register('impact',{create:()=>({id:++created})});
  await handle.prewarm(1);
  const item=handle.get(),metadata=pool.meta.get(item);
  handle.put(item);
  for(let i=0;i<1000;i++){assert.equal(handle.get(),item);assert.equal(pool.meta.get(item),metadata);handle.put(item);assert.equal(pool.meta.get(item),metadata);}
  assert.equal(created,1);
  assert.throws(()=>handle.put(item),/Double put/);
});
