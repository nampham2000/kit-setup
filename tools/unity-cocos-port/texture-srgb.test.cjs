'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require('typescript');
const source=fs.readFileSync(require.resolve('./runtime/UnitySrgbTexture.ts'),'utf8');
function fixture(){
  const uploaded=[],destroyed=[];
  class Texture2D {
    setFilters(...v){this.filters=v;} setMipFilter(v){this.mip=v;}
    setWrapMode(...v){this.wrap=v;} setAnisotropy(v){this.aniso=v;}
    reset(v){this.info=v;} uploadData(v){this.pixels=Array.from(v);uploaded.push(this);}
    destroy(){destroyed.push(this);}
  }
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{
    exports:module.exports,require:()=>({Texture2D,gfx:{Format:{SRGB8_A8:37}}}),
    document:{createElement:()=>({getContext:()=>({drawImage(){},getImageData(){return {data:new Uint8ClampedArray([255,0,0,13,0,255,0,27])};}})})},
  });
  const sampler={minFilter:2,magFilter:2,mipFilter:1,addressU:0,addressV:2,addressW:0,maxAnisotropy:4};
  return {cache:new module.exports.UnitySrgbTexture(),uploaded,destroyed,texture:{name:'source',width:2,height:1,image:{data:{}},getSamplerInfo:()=>sampler}};
}
test('hardware sRGB preserves encoded RGB and bakes grayscale alpha before mip reduction',()=>{
  const {cache,texture}=fixture(),out=cache.get(texture,1);
  assert.equal(out.info.format,37);
  assert.deepEqual(out.pixels,[255,0,0,85,0,255,0,85]);
  assert.deepEqual(Array.from(out.filters),[2,2]);assert.equal(out.mip,1);
  assert.deepEqual(Array.from(out.wrap),[0,2,0]);assert.equal(out.aniso,4);
});
test('cache separates alpha ownership and destroys only derived textures',()=>{
  const {cache,texture,uploaded,destroyed}=fixture();
  const original=cache.get(texture,0),gray=cache.get(texture,1),opaque=cache.get(texture,2);
  assert.equal(cache.get(texture,1),gray);assert.equal(uploaded.length,3);
  assert.deepEqual(original.pixels,[255,0,0,13,0,255,0,27]);
  assert.deepEqual(opaque.pixels,[255,0,0,255,0,255,0,255]);
  cache.destroy();assert.equal(destroyed.length,3);assert.ok(!destroyed.includes(texture));
  assert.notEqual(cache.get(texture,1),gray);
});
test('missing decoded pixels fails explicitly instead of retaining a dark fallback',()=>{
  const {cache,texture}=fixture();texture.image=null;
  assert.throws(()=>cache.get(texture,1),/decoded source pixels/);
});
test('material conversion reports the reusable sampling contract for future ports',()=>{
  const {generateMaterialAssetManifest}=require('../shader-compiler/unity-material-converter.cjs');
  const manifest=generateMaterialAssetManifest('Material:\n  m_SavedProperties:\n    m_TexEnvs:\n    - _MainTex:\n        m_Texture: {fileID: 2800000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}\n');
  assert.equal(manifest.textureDiagnostics._MainTex.samplingContract.mipReduction,'linear-rgb-independent-alpha');
});
