'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),os=require('node:os');
const native=require('./fixtures/builtin-meshes-native.json').meshes.find(m=>m.fileID===10207);
const data={};new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleBuiltinMeshData.ts'),'utf8'),{compilerOptions:{module:1}}).outputText)(data);
test('native Sphere topology is retained and reflected once for Cocos',()=>{
 assert.equal(native.positions.length/3,515);assert.deepEqual(data.unitySphereMesh.positions,native.positions);assert.deepEqual(data.unitySphereMesh.uvs,native.uvs);assert.deepEqual(data.unitySphereMesh.indices,native.indices);
 let geometry,calls=0;const out={},decorator=()=>target=>target,cc={Component:class{},ParticleSystem:class{},_decorator:{ccclass:decorator,executionOrder:decorator,executeInEditMode:target=>target,playOnFocus:target=>target,property:()=>{}},utils:{createMesh(g){calls++;geometry=g;return {isValid:true};}}};
 new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleBuiltinMeshAdapter.ts'),'utf8'),{compilerOptions:{module:1,target:7,experimentalDecorators:true}}).outputText)(out,n=>n==='cc'?cc:data);
 const first=out.nativeParticleSphere();assert.equal(out.nativeParticleSphere(),first);assert.equal(calls,1);
 for(let i=0;i<native.positions.length;i++)assert.equal(geometry.positions[i],i%3===2?-native.positions[i]:native.positions[i]);
 for(let i=0;i<native.uvs.length;i++)assert.equal(geometry.uvs[i],i%2?1-native.uvs[i]:native.uvs[i]);
 for(let i=0;i<native.indices.length;i+=3)assert.deepEqual(geometry.indices.slice(i,i+3),[native.indices[i],native.indices[i+2],native.indices[i+1]]);
});
test('native Sphere fixture is guarded by source Unity version',()=>{
 const {attachBuiltinMeshRuntime}=require('./particle-builtin-mesh-binding.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-sphere-'));
 try{fs.mkdirSync(path.join(root,'ProjectSettings'));fs.writeFileSync(path.join(root,'ProjectSettings/ProjectVersion.txt'),'m_EditorVersion: 2022.3.0f1\n');const reports=[];attachBuiltinMeshRuntime({objects:[{unityBuiltinMeshFileId:'10207'}]},{high:(...r)=>reports.push(r)},{unityRoot:path.join(root,'Assets'),dryRun:true});assert.equal(reports[0][0],'PARTICLE_NATIVE_PRIMITIVE_VERSION_UNVERIFIED');}
 finally{fs.rmSync(path.join(root,'ProjectSettings/ProjectVersion.txt'));fs.rmdirSync(path.join(root,'ProjectSettings'));fs.rmdirSync(root);}
});

test('native Sphere BakeMesh retains topology, local rotation and animated UVs',()=>{
 const baked=require('./fixtures/sphere-geometry-native.json').find(x=>x.mode==='Mesh');
 const angle=-127.533676*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 assert.equal(baked.vertices.length,native.positions.length/3);
 for(let i=0;i<baked.vertices.length;i++){
  const [x,y,z]=native.positions.slice(i*3,i*3+3);
  const expected=[4*(c*x-s*y),4*z,-4*(s*x+c*y)];
  expected.forEach((v,j)=>assert.ok(Math.abs(v-baked.vertices[i][j])<1e-6));
  assert.ok(Math.abs(native.uvs[i*2]/3-baked.uvs[i][0])<1e-7);
  assert.ok(Math.abs((native.uvs[i*2+1]+1)/3-baked.uvs[i][1])<2e-7);
 }
});
