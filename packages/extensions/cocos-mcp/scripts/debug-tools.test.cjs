'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const {DebugTools}=require('../dist/tools/debug-tools.js');
const manifest=require('../package.json');
test('debug executes through its own registered scene extension',async()=>{
 let request;
 global.Editor={Message:{request:async(...args)=>{request=args;return 42;}}};
 try{const result=await new DebugTools().execute('execute_script',{script:'const x=21; x*2'});assert.equal(result.data.result,42);assert.deepEqual(request,['scene','execute-scene-script',{name:manifest.name,method:'executeScript',args:['const x=21; x*2']}]);assert.ok(manifest.contributions.scene.methods.includes('executeScript'));}finally{delete global.Editor;}
});
