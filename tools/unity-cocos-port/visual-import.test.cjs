'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {applyUnityTextureAlpha,encodeRgba}=require('./texture-alpha.cjs');
const {decodePng}=require('../resource-stats.cjs');
const {unityToCocosSH,BASIS_OVER_PI}=require('./spherical-harmonics.cjs');
test('grayscale alpha removes an opaque black border and leaves RGB/source unchanged',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unity-alpha-'));
 try {
 const src=path.join(dir,'source.png'),dst=path.join(dir,'target.png');
 const bytes=encodeRgba(3,1,Buffer.from([0,0,0,255,128,128,128,255,255,255,255,255]));
 fs.writeFileSync(src,bytes);fs.writeFileSync(dst,bytes);fs.writeFileSync(src+'.meta','TextureImporter:\n  alphaUsage: 2\n');
 assert.equal(applyUnityTextureAlpha(src,dst),true);
 assert.deepEqual([...decodePng(fs.readFileSync(dst)).rgba],[0,0,0,0,128,128,128,128,255,255,255,255]);
 assert.deepEqual(fs.readFileSync(src),bytes);
 assert.equal(applyUnityTextureAlpha(src,dst),false);
 fs.writeFileSync(src+'.meta','TextureImporter:\n  alphaUsage: 1\n');
 assert.equal(applyUnityTextureAlpha(src,dst),false);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('Unity live SH oracle matches Cocos shader polynomial in four directions',()=>{
 const red=[0.08996153,0.08939045,-0.0589731,0.0032599736,-0.003531702,-0.0616359264,0.00372453174,0.0182399228,-0.00672315853];
 const expected=[0.182351,0.082774,0.038437,0.003570];
 const cocos=unityToCocosSH(red.map(x=>({x,y:x,z:x})));
 const dirs=[[0,1,0],[1,0,0],[0,0,-1],[0,-1,0]];
 dirs.forEach(([x,y,z],idx)=>{
 const factors=[1,y,z,x,x*y,y*z,z*z-1/3,x*z,x*x-y*y];
 const value=factors.reduce((sum,basis,i)=>sum+cocos[i].x*BASIS_OVER_PI[i]*basis,0);
 assert.ok(Math.abs(value-expected[idx])<0.000001,`${idx}: ${value}`);
 });
});

test('Unity mip/filter settings survive porting instead of forcing no mipmaps',()=>{
 const {unityTextureSampling}=require('./texture-sampling.cjs');
 assert.deepEqual(unityTextureSampling('enableMipMap: 1\nfilterMode: 2\naniso: 8'),{minfilter:'linear',magfilter:'linear',mipfilter:'linear',anisotropy:8});
 assert.deepEqual(unityTextureSampling('enableMipMap: 1\nfilterMode: -1\naniso: -1'),{minfilter:'linear',magfilter:'linear',mipfilter:'nearest',anisotropy:1});
 assert.equal(unityTextureSampling('enableMipMap: 0\nfilterMode: 0').mipfilter,'none');
});
test('alpha conversion refuses to overwrite Unity source and leaves opaque JPEG alone',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unity-alpha-guard-'));
 try{const src=path.join(dir,'source.jpg'),dst=path.join(dir,'destination.jpg');fs.writeFileSync(src,Buffer.from([255,216,255,217]));fs.copyFileSync(src,dst);fs.writeFileSync(src+'.meta','TextureImporter:\n alphaUsage: 0\n');assert.throws(()=>applyUnityTextureAlpha(src,src),/must not overwrite/);assert.equal(applyUnityTextureAlpha(src,dst),false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
