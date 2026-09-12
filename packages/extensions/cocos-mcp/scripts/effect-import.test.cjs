'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path');
const {AssetAdvancedTools}=require('../dist/tools/asset-advanced-tools.js');
test('effect gate queries AssetDB metadata separately and rejects a wrong importer',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'effect-import-'));
  fs.mkdirSync(path.join(root,'temp/logs'),{recursive:true}); fs.writeFileSync(path.join(root,'temp/logs/project.log'),'');
  const prior=global.Editor; let importer='effect'; const calls=[];
  global.Editor={Project:{path:root},Message:{request:async(_pkg,op,id)=>{
    calls.push([op,id]);
    if(op==='reimport-asset')return true;
    if(op==='query-asset-info')return {uuid:'effect-id',type:'cc.EffectAsset'};
    if(op==='query-asset-meta')return {uuid:'effect-id',importer};
    throw new Error(op);
  }}};
  try {
    const tool=new AssetAdvancedTools();
    const args={effectUrl:'db://assets/effects/Test.effect'};
    assert.equal((await tool.execute('validate_effect_import',args)).success,true);
    assert.ok(calls.some(([op,id])=>op==='query-asset-meta'&&id==='effect-id'));
    importer='text';
    assert.equal((await tool.execute('validate_effect_import',args)).success,false);
  } finally {global.Editor=prior;fs.rmSync(root,{recursive:true,force:true});}
});
