'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const {lintManagedAudio}=require('./managed-audio-linter.cjs');
test('managed audio rejects gameplay bypasses, preserves trusted backend and ignores comments',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'managed-audio-lint-'));
  try{
    const file=path.join(root,'assets/script/Game.ts'),shared=path.join(root,'assets/script/shared/core/Backend.ts');
    fs.mkdirSync(path.dirname(shared),{recursive:true});
    fs.writeFileSync(file,'// manager.playSound("hit");\nsource.playOneShot(clip);');
    fs.writeFileSync(shared,'manager.playSound("hit");source.playOneShot(clip);');
    assert.deepEqual(lintManagedAudio([file,shared],{projectRoot:root}),[]);
    fs.writeFileSync(file,'import { AudioSource as Source } from "cc"; manager.playSound("hit");node.addComponent(Source);source.playOneShot(clip);manager.playSFX("hit");');
    assert.equal(lintManagedAudio([file,shared],{projectRoot:root}).filter(v=>v.rule==='MANAGED_AUDIO_BYPASS').length,3);
    fs.mkdirSync(path.join(root,'tools'));fs.writeFileSync(path.join(root,'tools/audio-port-map.json'),'{"schemaVersion":1,"entries":[]}');
    assert.ok(lintManagedAudio([file],{projectRoot:root}).some(v=>v.rule==='AUDIO_PORT_MAP_INVALID'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
