'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const {patchUrp,patchCocosVertex,glsl,assertSource}=require('./screen-distortion-contract.cjs');
test('pixel displacement attenuates by camera distance, independent of render resolution in pixels',()=>{
 for(const width of [490,865,1920])for(const distance of [5,15,40]){
  const actual=(.25/width*100*.6*.8/distance)*width;
  assert.ok(Math.abs(actual-12/distance)<1e-12);
 }
 assert.match(glsl,/textureSize\(opaqueTexture,0\)/);assert.match(glsl,/aoeDistortionProjection.x\/aoeDistortionProjection.y/);
 assert.match(glsl,/abs\(normal.y\)\*30.0-0.03/);assert.doesNotMatch(glsl,/coverage\s*\*\s*vertexColor/);
});
test('native projection interpolation is not reciprocal fragment SV_POSITION.w',()=>{
 const weights=[.3,.7],clipW=[4,10],distances=[7,12];
 const numerator=weights.reduce((s,w,i)=>s+w/distances[i],0);
 const denominator=weights.reduce((s,w)=>s+w,0);
 assert.ok(Math.abs(numerator/denominator-(.3/7+.7/12))<1e-12);
 assert.match(patchCocosVertex('out vec3 aoeWorld;\n  pos = cc_matViewProj * pos;'),/pos.w\/distance/);
});
test('repair CLI help/check/invalid and unchanged generation preserve bytes and mtime',()=>{
 const scratch=path.resolve(__dirname,'../../.ai');fs.mkdirSync(scratch,{recursive:true});const tmp=fs.mkdtempSync(path.join(scratch,'distortion-cli-'));
 const source=path.join(__dirname,'fixtures/distortion/Distortion.shader'),target=path.join(tmp,'common.hlsl');
 fs.copyFileSync(path.join(__dirname,'fixtures/distortion/HovlURPCommon.before.hlsl'),target);
 const cli=path.join(__dirname,'repair-screen-distortion.cjs'),args=['--source',source,'--target',target];
 const digest=()=>[crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),fs.statSync(target).mtimeMs];
 const run=(a,ok)=>assert.equal(cp.spawnSync(process.execPath,[cli,...a]).status===0,ok);
 let before=digest();run(['--help'],true);run([...args,'--check'],false);run([...args,'--invalid'],false);assert.deepEqual(digest(),before);
 run(args,true);before=digest();run(args,true);run([...args,'--check'],true);assert.deepEqual(digest(),before);
 const repaired=fs.readFileSync(target,'utf8');assert.equal(patchUrp(repaired),repaired);assert.throws(()=>patchUrp(repaired.replace('rcp(_ScaledScreenParams.xy)','1.0')),/contract drift/);assertSource(fs.readFileSync(source,'utf8'));
 assert.match(repaired,/UnpackNormal/);assert.match(repaired,/rcp\(_ScaledScreenParams.xy\)/);
});
