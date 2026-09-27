'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto');
const native=require('./fixtures/particle-shape-alignment-native.json'),m={exports:{}};
new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleEulerRotation.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m.exports,m,()=>({}));
const {addUnityShapeAlignment,installUnityParticleShapeAlignment}=m.exports,D=Math.PI/180;
const vec=(x=0,y=0,z=0)=>({x,y,z,set(a,b,c){this.x=a;this.y=b;this.z=c;}});
test('native capture identity and additive Euler alignment across 48 directions/start rotations',()=>{
 const script=fs.readFileSync(path.join(__dirname,'fixtures/capture-shape-alignment.cs'),'utf8').replace(/\r\n/g,'\n');
 assert.equal(crypto.createHash('sha256').update(script).digest('hex'),native.source.captureSha256Lf);
 const rows=native.rows.filter(r=>r.align);assert.equal(rows.length,48);
 for(const r of rows){const e=vec(-r.initial[0]*D,-r.initial[1]*D,r.initial[2]*D);addUnityShapeAlignment(e,r.velocity[0],r.velocity[1],-r.velocity[2],[-1,-1,1]);
 [e.x,e.y,e.z].forEach((v,i)=>assert.ok(Math.abs(v-r.rotation[i]*D*[-1,-1,1][i])<1e-6));}
});
test('birth captures direction before zero speed; pool reuse does not accumulate old alignment',()=>{
 const p={velocity:vec(),startEuler:vec(),rotation:vec()},seen=[];
 const system={simulationSpace:1,unityEulerRotation:true,shapeModule:{enable:true,alignToDirection:true,shapeType:3,emit(p){p.velocity.set(1,0,0);}},processor:{setNewParticle(p){seen.push(p.startEuler.y);}}};
 assert.equal(installUnityParticleShapeAlignment(system,[-1,-1,1]),true);
 const hook=system.shapeModule.emit;assert.equal(installUnityParticleShapeAlignment(system,[-1,-1,1]),true);assert.equal(hook,system.shapeModule.emit);
 for(let i=0;i<2;i++){system.shapeModule.emit(p);p.velocity.set(0,0,0);p.startEuler.set(-Math.PI,0,0);system.processor.setNewParticle(p);}
 assert.deepEqual(seen,[-Math.PI/2,-Math.PI/2]);assert.ok(Number.isFinite(p.rotation.x));
 assert.equal(installUnityParticleShapeAlignment({...system,unityShapeAlignment:false,simulationSpace:0},[-1,-1,1]),false);
});
test('binding serializes measured alignment and reports unsupported space',()=>{
 const {attachEulerRotationRuntime}=require('./particle-euler-rotation-binding');
 for(const space of [0,1]){const p={__type__:'cc.ParticleSystem',node:{__id__:0},_simulationSpace:space,_shapeModule:{__id__:2},_rotationOvertimeModule:{__id__:3},unityRendererContract:{mode:4,eulerSigns:[-1,-1,1]}},objects=[{_name:'crystals'},p,{alignToDirection:true,_shapeType:3},{_enable:true}],bound=[],issues=[];
 attachEulerRotationRuntime({objects,cocosDb:{findScriptClass:()=>({classId:'native-euler'})},addComponent(n,t,s){bound.push(s);}},{high(c){issues.push(c);},low(){}},{dryRun:true,cocosRoot:__dirname});
 assert.equal(JSON.parse(bound[0].sourceContract).shapeAlignment===true,space===1);
 assert.equal(issues.includes('PARTICLE_SHAPE_ALIGNMENT_UNMEASURED'),space===0);}
});
