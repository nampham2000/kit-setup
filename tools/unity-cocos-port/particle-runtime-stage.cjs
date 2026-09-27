#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const SOURCE=path.join(__dirname,'runtime');
const FEATURES={
  burst:['UnityParticleBurstEmission'],
  birth:['UnityParticleNestedEmission','UnityParticleBirthBurst','UnityParticleSubEmitterFollower','UnityParticleDistanceSubEmitter','UnityParticleBirthTiming'],
  death:['UnityParticleDeathBurst','UnityParticleSubEmitterFollower','UnityParticleDistanceSubEmitter','UnityParticleBirthTiming'],
};
const USAGE='Usage: node playable-shared-kit/tools/unity-cocos-port/particle-runtime-stage.cjs --cocos-root <path> --feature <birth|death|burst|all> [--check] | --help';
function parse(args){
  if(args.length===1&&args[0]==='--help')return{help:true};
  const out={check:false};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--check'&&!out.check)out.check=true;
    else if(args[i]==='--cocos-root'&&!out.root&&args[i+1])out.root=path.resolve(args[++i]);
    else if(args[i]==='--feature'&&!out.feature&&args[i+1])out.feature=args[++i];
    else throw new Error(USAGE);
  }
  if(!out.root||!['birth','death','burst','all'].includes(out.feature))throw new Error(USAGE);
  return out;
}
function stage(options){
  const names=[...new Set(options.feature==='all'?Object.values(FEATURES).flat():FEATURES[options.feature])];
  const targetDir=path.join(options.root,'assets/script');
  const rows=names.map(name=>{
    const target=path.join(targetDir,name+'.ts'),source=fs.readFileSync(path.join(SOURCE,name+'.ts'));
    const current=fs.existsSync(target)?fs.readFileSync(target):null;
    return{name,target,status:current?.equals(source)?'unchanged':current?'conflict':'missing',source};
  });
  if(options.check)return{ok:rows.every(r=>r.status==='unchanged'),files:rows.map(({name,status})=>({name,status}))};
  // Existing different files may have user edits and must not be overwritten.
  if(rows.some(r=>r.status==='conflict'))return{ok:false,files:rows.map(({name,status})=>({name,status}))};
  fs.mkdirSync(targetDir,{recursive:true});
  for(const row of rows)if(row.status==='missing')fs.writeFileSync(row.target,row.source);
  return{ok:true,files:rows.map(({name,status})=>({name,status:status==='missing'?'staged':status}))};
}
function main(args=process.argv.slice(2)){
  let options;try{options=parse(args);}catch(e){process.stderr.write(e.message+'\n');return 2;}
  if(options.help){process.stdout.write(USAGE+'\n');return 0;}
  const result=stage(options);process.stdout.write(JSON.stringify(result)+'\n');return result.ok?0:1;
}
if(require.main===module)process.exitCode=main();
module.exports={parse,stage,main};
