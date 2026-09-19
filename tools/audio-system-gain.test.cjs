'use strict';
const fs=require('node:fs'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript');
const moduleResult={exports:{}};
const source=fs.readFileSync(path.join(__dirname,'../packages/playable-core/audio/AudioSystem.ts'),'utf8');
new Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(moduleResult.exports);
test('per-playback gain composes with master, mute and fade without changing another voice',()=>{
  const levels=[];
  const backend={start(i,h,c,l,v){levels[i]=v;},stop(i){levels[i]=0;},pause(){},resume(){},volume(i,v){levels[i]=v;}};
  const system=new moduleResult.exports.AudioSystem({maxSfxVoices:2,sounds:{hit:{path:'hit',cooldownMs:0,maxConcurrent:2,priority:1,volume:.8,loop:false,stealable:false}}},backend,()=>0);
  system.bind('hit',{});system.unlockFromGesture();system.setVolume(.6);
  const first=system.play('hit',.5),second=system.play('hit',1);
  assert.equal(levels[0],.24);assert.equal(levels[1],.48);
  assert.equal(system.setPlaybackGain(first,.3),true);assert.equal(levels[0],.144);assert.equal(levels[1],.48);
  system.fadeOut(first,1);system.update(.5);assert.equal(levels[0],.072);
  system.setMuted(true);assert.deepEqual(levels,[0,0]);system.setMuted(false);assert.deepEqual(levels,[.072,.48]);
  system.stop(first);const third=system.play('hit',.2);
  assert.ok(third!==first&&third!==second);assert.equal(system.setPlaybackGain(first,1),false);assert.equal(levels[0],.096);
});
