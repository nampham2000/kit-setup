'use strict';
const fs=require('node:fs'),path=require('node:path');
const {assertSource,patchUrp}=require('./screen-distortion-contract.cjs');
function main(argv){
 if(argv.length===1&&argv[0]==='--help'){console.log('node repair-screen-distortion.cjs --source <original.shader> --target <URP.hlsl> [--check]');return;}
 const opts={};for(let i=0;i<argv.length;i++){const k=argv[i];if(k==='--check'){if(opts.check)throw Error('Duplicate mode');opts.check=true;}else if(k==='--source'||k==='--target'){if(opts[k]||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Invalid argument');opts[k]=argv[++i];}else throw Error('Unknown argument: '+k);}
 if(!opts['--source']||!opts['--target'])throw Error('Source and target required');
 assertSource(fs.readFileSync(path.resolve(opts['--source']),'utf8'));
 const target=path.resolve(opts['--target']),before=fs.readFileSync(target,'utf8'),after=patchUrp(before);
 if(before!==after){if(opts.check)throw Error('URP distortion repair required');fs.writeFileSync(target,after);}
 console.log(JSON.stringify({ok:true,changed:before!==after,check:!!opts.check}));
}
if(require.main===module)main(process.argv.slice(2));module.exports={main};
