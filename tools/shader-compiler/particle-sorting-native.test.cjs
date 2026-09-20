'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript');
test('sorting runtime matches 45 native samples, including off-axis renderer bounds',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../unity-cocos-port/runtime/UnityParticleSorting.ts'),'utf8');
 const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:()=>({}),Math});
 const rows=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/distortion/native-sort.json'),'utf8'));
 for(const r of rows){
  const camera={node:{worldPosition:{x:r.eye[0],y:r.eye[1],z:r.eye[2]}}};
  const models=[r.redCenter,r.blueCenter].map(center=>({worldBounds:{center:{x:center[0],y:center[1],z:center[2]}}}));
  const systems=models.map(model=>({node:{worldPosition:{x:999,y:999,z:999}},processor:{_model:model,beforeRender(){}}}));
  systems.forEach((s,i)=>{exports.installUnityParticleSorting(s,camera,{path:'test',fudge:i===0?r.fudge:0,queue:3000});s.processor.beforeRender();});
  if(Math.abs(models[0].priority-models[1].priority)<1e-7)continue;
  assert.equal(models[0].priority>models[1].priority,r.r>r.b,JSON.stringify(r));
 }
});
