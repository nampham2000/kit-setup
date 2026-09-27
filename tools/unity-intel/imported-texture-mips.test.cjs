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

test('native BMP import preserves compressed pixels, mip levels and converted PNG UUID',()=>{
 const fixture=path.join(__dirname,'fixtures/native-bmp'),capture=JSON.parse(fs.readFileSync(path.join(fixture,'capture.json'))),root=fs.mkdtempSync(path.join(os.tmpdir(),'native-bmp-'));
 try{fs.writeFileSync(path.join(root,'converted.png.meta'),JSON.stringify({subMetas:{texture:{importer:'texture',uuid:'converted-png-texture'}}}));
 const output=normalize(capture,[{unityPath:'Assets/TextureImportRegression/Synthetic.bmp',cocosMeta:'converted.png.meta',output:'native.json'}],fixture,root,'fixture');const data=JSON.parse(output[0].text);assert.equal(data.textureUuid,'converted-png-texture');assert.equal(data.format,'RGBA_DXT1_SRGB');assert.equal(data.mips.length,5);assert.equal(data.sampler.filterMode,'Bilinear');
 const native=Buffer.from(capture.textures[0].mips[0].rgba,'base64'),top=Buffer.from(data.mips[0].rgba,'base64');assert.deepEqual(top.subarray(0,64),native.subarray(7*64,8*64));
 const bmp=fs.readFileSync(path.join(fixture,'Assets/TextureImportRegression/Synthetic.bmp'));let changed=0;for(let y=0;y<8;y++)for(let x=0;x<16;x++){const src=54+(y*16+x)*3,dst=(y*16+x)*4;for(let c=0;c<3;c++)if(bmp[src+2-c]!==native[dst+c])changed++;assert.equal(native[dst+3],255);}assert.ok(changed>0,'native compressed texels must differ from raw BMP conversion');
 const stale=structuredClone(capture);stale.textures[0].sourceTextureSha256='stale';assert.throws(()=>normalize(stale,[{unityPath:'Assets/TextureImportRegression/Synthetic.bmp',cocosMeta:'converted.png.meta',output:'native.json'}],fixture,root,'fixture'),/changed after/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('native producer keeps the accepted Unity ASTC Graphics.Blit readback route',()=>{
 const producer=fs.readFileSync(path.join(__dirname,'capture-imported-texture-mips.cs'),'utf8');
 assert.match(producer,/StartsWith\("ASTC_"/);assert.match(producer,/Graphics\.Blit\(texture, target, material\)/);
 assert.match(producer,/image\.ReadPixels/);assert.match(producer,/astcGpuReadbackFallback/);
 assert.doesNotMatch(producer,/!SystemInfo\.SupportsTextureFormat\(texture\.format\)\)\s*throw/);
});
