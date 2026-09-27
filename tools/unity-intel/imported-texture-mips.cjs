'use strict';
// Native decoded pixels are an import artifact, not the original PNG. Never
// mutate the Unity importer or manufacture Cocos UUIDs to obtain this artifact.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function normalize(capture, mappings, unityRoot, cocosRoot, readbackHash){
 if(capture.schemaVersion!==1||!Array.isArray(capture.textures)||!mappings.length)throw Error('Invalid native mip capture');
 const outputs=[],seen=new Set();
 for(const mapping of mappings){
  if(!/^Assets\//.test(mapping.unityPath)||mapping.unityPath.split('/').includes('..'))throw Error('Invalid Unity asset path');
  const matches=capture.textures.filter(t=>t.path===mapping.unityPath);
  if(matches.length!==1)throw Error('Missing or duplicate native texture: '+mapping.unityPath);
  const texture=matches[0],meta=JSON.parse(fs.readFileSync(path.resolve(cocosRoot,mapping.cocosMeta)));
  const entries=Object.values(meta.subMetas||{}).filter(m=>m.importer==='texture');
  if(entries.length!==1||!entries[0].uuid)throw Error('Unique AssetDB texture UUID required');
  if(texture.schemaVersion!==1||texture.srgb!==true||!texture.format?.endsWith('_SRGB')||!texture.mips?.length)throw Error('Only native sRGB imports are measured');
  const first=texture.mips[0],full=1+Math.floor(Math.log2(Math.max(first.width,first.height)));
  if(!Number.isInteger(first.width)||!Number.isInteger(first.height)||first.width<1||first.height<1||![1,full].includes(texture.mips.length))throw Error('Invalid native mip chain');
  const mips=texture.mips.map((mip,level)=>{
   if(mip.width!==Math.max(1,first.width>>level)||mip.height!==Math.max(1,first.height>>level))throw Error('Invalid mip dimensions');
   const raw=Buffer.from(mip.rgba,'base64'),stride=mip.width*4;
   if(raw.length!==stride*mip.height)throw Error('Invalid mip byte count');
   const top=Buffer.alloc(raw.length);
   for(let y=0;y<mip.height;y++)raw.copy(top,y*stride,(mip.height-1-y)*stride,(mip.height-y)*stride);
   return {width:mip.width,height:mip.height,rgba:top.toString('base64')};
  });
  const output=path.resolve(cocosRoot,mapping.output);
  if(seen.has(output)||!output.endsWith('.json'))throw Error('Duplicate or invalid output');seen.add(output);
  const source=path.resolve(unityRoot,mapping.unityPath);
  if(texture.sourceTextureSha256&&texture.sourceTextureSha256!==sha(fs.readFileSync(source)))throw Error("Source texture changed after native capture");
  if(texture.sourceImporterSha256&&texture.sourceImporterSha256!==sha(fs.readFileSync(source+".meta")))throw Error("Source importer changed after native capture");
  outputs.push({path:output,text:JSON.stringify({...texture,mips,textureUuid:entries[0].uuid,rowOrder:'top-to-bottom',sourceTextureSha256:sha(fs.readFileSync(source)),sourceImporterSha256:sha(fs.readFileSync(source+'.meta')),nativeReadbackSha256:readbackHash})});
 }
 return outputs;
}
function main(args){
 if(args.length===1&&args[0]==='--help'){console.log('imported-texture-mips.cjs --capture <native.json> --mapping <map.json> --unity-project <root> --cocos-project <root> [--check]');return;}
 const opts={};for(let i=0;i<args.length;i++){
  const key=args[i];if(key==='--check'){opts.check=true;continue;}
  if(!['--capture','--mapping','--unity-project','--cocos-project'].includes(key)||!args[i+1]||args[i+1].startsWith('--')||opts[key])throw Error('Invalid arguments');opts[key]=args[++i];
 }
 for(const k of ['--capture','--mapping','--unity-project','--cocos-project'])if(!opts[k])throw Error('Missing '+k);
 const raw=fs.readFileSync(opts['--capture']);
 const outputs=normalize(JSON.parse(raw),JSON.parse(fs.readFileSync(opts['--mapping'])),opts['--unity-project'],opts['--cocos-project'],sha(raw));
 for(const output of outputs){
  if(fs.existsSync(output.path)&&fs.readFileSync(output.path,'utf8')===output.text)continue;
  if(opts.check)throw Error('Native mip artifact is stale: '+output.path);
  fs.mkdirSync(path.dirname(output.path),{recursive:true});fs.writeFileSync(output.path,output.text);
 }
 console.log(`${outputs.length} native imported texture contracts ${opts.check?'verified':'normalized'}`);
}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={normalize,main};
