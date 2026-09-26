'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {closeRuntimeProfile}=require('./runtime-profile.cjs');
const root=path.resolve('runtime-profile-fixture');
const profile={root,directory:path.join(root,'playable-runtime-Ab1234')};
test('waits for browser shutdown and retries Windows locked files',async()=>{
  const events=[],child={exitCode:null,signalCode:null,kill(){throw new Error('should close normally')}};
  let attempts=0;
  const result=await closeRuntimeProfile(child,{async send(method){events.push(method);child.exitCode=0},close(){events.push('socket-close')}},profile,{
    async lstat(){return{isSymbolicLink:()=>false}},
    async rm(target){assert.equal(target,profile.directory);assert.equal(child.exitCode,0);events.push('remove');if(++attempts<3)throw Object.assign(new Error('locked'),{code:'EBUSY'})},
  },async()=>{});
  assert.equal(result.ok,true);assert.equal(attempts,3);assert.deepEqual(events.slice(0,2),['Browser.close','socket-close']);
});
test('backs off ~30 s over 16 attempts while Chrome helpers still hold first_party_sets.db',async()=>{
  // Loaded Windows machine: EBUSY persisted past the old ~14 s (10 attempts) and retained a profile per case.
  const waits=[];let attempts=0;
  const r=await closeRuntimeProfile({exitCode:0,signalCode:null},null,profile,{async lstat(){return{isSymbolicLink:()=>false}},async rm(){if(++attempts<16)throw Object.assign(new Error("EBUSY: resource busy or locked, unlink 'first_party_sets.db'"),{code:'EBUSY'})}},async ms=>{waits.push(ms)});
  assert.equal(r.ok,true);assert.equal(r.attempts,16);
  assert.deepEqual(waits,[250,500,750,1000,1250,1500,1750,2000,2250,2500,2750,3000,3250,3500,3750]);
  assert.equal(waits.reduce((a,b)=>a+b,0),30000);
});
test('reports persistent cleanup failure instead of swallowing it',async()=>{
  const r=await closeRuntimeProfile({exitCode:0,signalCode:null},null,profile,{async lstat(){return{isSymbolicLink:()=>false}},async rm(){throw Object.assign(new Error('locked'),{code:'EPERM'})}},async()=>{});
  assert.equal(r.ok,false);assert.equal(r.directory,profile.directory);
});
test('rejects paths outside owned root and redirected directories before deleting',async()=>{
  const io={async lstat(){return{isSymbolicLink:()=>true}},async rm(){throw new Error('must not run')}};
  await assert.rejects(closeRuntimeProfile({},null,{root,directory:path.resolve(root,'../playable-runtime-Ab1234')},io),/outside/);
  await assert.rejects(closeRuntimeProfile({},null,profile,io),/redirected/);
});
