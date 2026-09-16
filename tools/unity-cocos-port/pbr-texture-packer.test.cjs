const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {encodePng,decodePng,packPbrOrmTexture}=require('./pbr-texture-packer.js');
const zlib=require('node:zlib');
test('PNG Paeth ties select up before upper-left, preserving roughness scanlines',()=>{
  const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);return b;};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2);ihdr.writeUInt32BE(2,4);ihdr[8]=8;ihdr[9]=0;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.from([0,4,0,4,2,10]))),chunk('IEND',Buffer.alloc(0))]);
  const d=decodePng(png).data;
  assert.deepEqual([d[0],d[4],d[8],d[12]],[4,0,6,10]);
});
test('16-bit source channels decode instead of silently becoming a default map',()=>{
  // Construct a one-pixel PNG; decoder fixtures do not depend on project assets.
  const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);return b;};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1);ihdr.writeUInt32BE(1,4);ihdr[8]=16;ihdr[9]=6;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.from([0,128,128,64,64,32,32,200,200]))),chunk('IEND',Buffer.alloc(0))]);
  assert.deepEqual([...decodePng(png).data],[128,64,32,200]);
});
test('invalid provided source is an error, not a default ORM success',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'invalid-orm-'));
  try {const file=path.join(dir,'bad.png');fs.writeFileSync(file,'broken');assert.throws(()=>packPbrOrmTexture({metallicGlossPath:file}),/Cannot decode metallic/);}
  finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('Unity metallic sRGB metadata affects RGB while gloss scale affects linear alpha',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unity-orm-'));
  try{
    const source=path.join(dir,'metal.png');
    fs.writeFileSync(source,encodePng(1,1,Buffer.from([128,0,0,200])));
    fs.writeFileSync(source+'.meta','TextureImporter:\n  sRGBTexture: 1\n');
    const packed=decodePng(packPbrOrmTexture({metallicGlossPath:source,smoothnessScale:0.5}).buffer);
    assert.deepEqual([...packed.data],[255,155,55,255]);
    const linear=decodePng(packPbrOrmTexture({metallicGlossPath:source,metallicSrgb:false}).buffer);
    assert.deepEqual([...linear.data],[255,55,128,255]);
    assert.deepEqual([...decodePng(fs.readFileSync(source)).data],[128,0,0,200]);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
