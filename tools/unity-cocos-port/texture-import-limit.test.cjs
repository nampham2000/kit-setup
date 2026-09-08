'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),sharp=require('sharp');
const {copyTextureWithLimit,textureImportLimit}=require('./texture-import-limit');
const {optionsFingerprint}=require('./port-cache');
const createPorter=require('./asset-import-porter');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'texture-import-limit-'));
test.after(()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(root).startsWith('texture-import-limit-'));fs.rmSync(root,{recursive:true});});
async function fixture(name) {
 const dir=path.join(root,name);fs.mkdirSync(path.join(dir,'assets/resources'),{recursive:true});
 const source=path.join(dir,'source.png'),dest=path.join(dir,'assets/map.png');
 await sharp({create:{width:64,height:32,channels:4,background:{r:240,g:130,b:40,alpha:.5}}}).png().toFile(source);
 return {dir,source,dest};
}
test('scoped resize preserves aspect ratio, alpha, source bytes and existing UUID',async()=>{
 const {dir,source,dest}=await fixture('alpha'),bytes=fs.readFileSync(source);
 fs.writeFileSync(dest+'.meta','{"uuid":"keep-this-uuid"}');
 assert.equal(copyTextureWithLimit(source,dest,16,dir),'copied');
 const m=await sharp(dest).metadata();assert.equal(m.width,16);assert.equal(m.height,8);assert.equal(m.hasAlpha,true);
 const {data}=await sharp(dest).raw().toBuffer({resolveWithObject:true});assert.ok(data[3]>=127&&data[3]<=128);
 assert.deepEqual(fs.readFileSync(source),bytes);assert.equal(JSON.parse(fs.readFileSync(dest+'.meta')).uuid,'keep-this-uuid');
 assert.equal(copyTextureWithLimit(source,dest,16,dir),'unchanged');
});
test('cache invalidates when limit, source pixels or output bytes change',async()=>{
 const {dir,source,dest}=await fixture('cache');copyTextureWithLimit(source,dest,16,dir);
 copyTextureWithLimit(source,dest,8,dir);assert.equal((await sharp(dest).metadata()).width,8);
 await sharp({create:{width:64,height:32,channels:4,background:'blue'}}).png().toFile(source);
 assert.equal(copyTextureWithLimit(source,dest,8,dir),'refreshed');
 fs.writeFileSync(dest,'broken');assert.equal(copyTextureWithLimit(source,dest,8,dir),'refreshed');
 assert.equal((await sharp(dest).metadata()).width,8);
});
test('small images are not upscaled; Unity and external output paths are rejected',async()=>{
 const {dir,source,dest}=await fixture('bounds');copyTextureWithLimit(source,dest,128,dir);
 assert.equal((await sharp(dest).metadata()).width,64);
 assert.throws(()=>copyTextureWithLimit(source,source,16,dir),/read-only/);
 assert.throws(()=>copyTextureWithLimit(source,path.join(dir,'external.png'),16,dir),/inside Cocos/);
});
test('porter uses config override and prefab cache observes changes to the cap',async()=>{
 const {dir,source}=await fixture('porter'),cfg=path.join(dir,'assets/resources/playable-config.json');
 const options={cocosRoot:dir},asset={path:source,relativePath:'Map/image.png'},reporter={add(){},low(){}};
 const write=size=>fs.writeFileSync(cfg,JSON.stringify({custom:{assetImport:{textureMaxSizes:{'Map/image.png':size}}}}));
 write(16);const before=optionsFingerprint(options);
 assert.equal(textureImportLimit('UI/unchanged.png',options),0);
 const porter=createPorter({ensureDirectoryMetas(){},ensurePreparedAssetMeta(){return true;}});
 const dest=porter.copyUnityAssetToCocos(asset,options,reporter,'image');assert.equal((await sharp(dest).metadata()).width,16);
 // A repeat port keeps the prepared texture, never restores the large source.
 porter.copyUnityAssetToCocos(asset,options,reporter,'image');assert.equal((await sharp(dest).metadata()).width,16);
 write(8);assert.notEqual(optionsFingerprint(options),before);
});
test('unconfigured images stay byte-identical; invalid caps are rejected',async()=>{
 const {dir,source}=await fixture('unconfigured'),options={cocosRoot:dir};
 const porter=createPorter({ensureDirectoryMetas(){},ensurePreparedAssetMeta(){return true;}});
 const dest=porter.copyUnityAssetToCocos({path:source,relativePath:'plain.png'},options,{add(){},low(){}},'image');
 assert.deepEqual(fs.readFileSync(dest),fs.readFileSync(source));
 assert.throws(()=>textureImportLimit('x.png',{_textureImportLimits:{'x.png':-1}}),/Invalid/);
});
