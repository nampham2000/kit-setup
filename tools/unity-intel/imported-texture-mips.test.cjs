'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {normalize,main}=require('./imported-texture-mips.cjs');
test('native mip normalization flips rows once, preserves UUID, validates before write and is idempotent',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-mips-'));
 try{
  fs.mkdirSync(path.join(root,'Assets'));fs.writeFileSync(path.join(root,'Assets/t.png'),'source');fs.writeFileSync(path.join(root,'Assets/t.png.meta'),'importer');
  fs.writeFileSync(path.join(root,'t.meta'),JSON.stringify({subMetas:{texture:{importer:'texture',uuid:'native-texture-uuid'}}}));
  const texture={schemaVersion:1,path:'Assets/t.png',srgb:true,format:'DXT5_SRGB',mips:[{width:1,height:2,rgba:Buffer.from([1,2,3,4,5,6,7,8]).toString('base64')},{width:1,height:1,rgba:Buffer.from([9,10,11,12]).toString('base64')}]};
  const capture={schemaVersion:1,textures:[texture]},mapping=[{unityPath:texture.path,cocosMeta:'t.meta',output:'out.json'}];
  const result=JSON.parse(normalize(capture,mapping,root,root,'hash')[0].text);
  assert.deepEqual([...Buffer.from(result.mips[0].rgba,'base64')],[5,6,7,8,1,2,3,4]);assert.equal(result.textureUuid,'native-texture-uuid');
  fs.writeFileSync(path.join(root,'capture.json'),JSON.stringify(capture));fs.writeFileSync(path.join(root,'mapping.json'),JSON.stringify(mapping));
  const args=['--capture',path.join(root,'capture.json'),'--mapping',path.join(root,'mapping.json'),'--unity-project',root,'--cocos-project',root];
  main(args);const before=fs.statSync(path.join(root,'out.json')).mtimeMs,bytes=fs.readFileSync(path.join(root,'out.json'));
  main(args);main([...args,'--check']);main(['--help']);assert.throws(()=>main([...args,'--invalid']));
  assert.equal(fs.statSync(path.join(root,'out.json')).mtimeMs,before);assert.deepEqual(fs.readFileSync(path.join(root,'out.json')),bytes);
  texture.mips[1].rgba='AA==';assert.throws(()=>normalize(capture,mapping,root,root,'hash'),/byte count/);
  texture.srgb=false;assert.throws(()=>normalize(capture,mapping,root,root,'hash'),/sRGB/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
