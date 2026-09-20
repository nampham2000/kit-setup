'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {parse,stage}=require('./particle-runtime-stage.cjs');
test('all new birth/death/burst runtime modules stage without meta and remain idempotent',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'particle-runtime-stage-'));
  try{
    const options={root,feature:'all',check:false};
    assert.equal(stage({...options,check:true}).ok,false);assert.equal(fs.existsSync(path.join(root,'assets')),false);
    const written=stage(options);assert.equal(written.ok,true);assert.equal(written.files.length,5);
    const hashes=written.files.map(f=>fs.statSync(path.join(root,'assets/script',f.name+'.ts')).mtimeMs);
    assert.ok(stage(options).files.every(f=>f.status==='unchanged'));
    assert.deepEqual(written.files.map(f=>fs.statSync(path.join(root,'assets/script',f.name+'.ts')).mtimeMs),hashes);
    assert.equal(stage({...options,check:true}).ok,true);
    assert.equal(fs.readdirSync(path.join(root,'assets/script')).some(f=>f.endsWith('.meta')),false);
    const fingerprint=()=>written.files.map(f=>{
      const file=path.join(root,'assets/script',f.name+'.ts');
      return[crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),fs.statSync(file).mtimeMs];
    });
    const before=fingerprint(),cli=path.join(__dirname,'particle-runtime-stage.cjs');
    for(const args of [['--help'],['--cocos-root',root,'--feature','all','--check'],['--cocos-root',root,'--feature','all','--unknown']]){
      const result=cp.spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
      assert.equal(result.status,args.includes('--unknown')?2:0);
      assert.deepEqual(fingerprint(),before);
    }
    const target=path.join(root,'assets/script/UnityParticleBirthBurst.ts');fs.writeFileSync(target,'user edit');
    assert.equal(stage(options).ok,false);assert.equal(fs.readFileSync(target,'utf8'),'user edit');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('invalid modes fail before touching files',()=>{
  assert.deepEqual(parse(['--help']),{help:true});
  for(const argv of [[],['--feature','oops','--cocos-root','/x'],['--cocos-root','/x','--feature','all','--wat'],['--feature','all']])assert.throws(()=>parse(argv));
});
