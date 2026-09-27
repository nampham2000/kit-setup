'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
function loadTs(name,imports={}){const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime',name+'.ts'),'utf8'),{compilerOptions:{module:1}}).outputText)(out,id=>imports[id]||({Vec3:{set(v,x,y,z){Object.assign(v,{x,y,z});},transformQuat(){},transformMat4(){}}}));return out;}
const nativeRadius=loadTs('UnityParticleNativeRadius');
const out=loadTs('UnityParticleShapeRandom',{'./UnityParticleNativeRadius':nativeRadius});
test('Unity 6000.3.1f1 Sphere radius interpolation holds on an independent seed and three thicknesses',()=>{
 const f=require('./fixtures/radius-native-holdout.json');assert.equal(f.unityVersion,'6000.3.1f1');assert.equal(f.seed,42);assert.deepEqual(f.rows.map(r=>r.thickness),[1,.5,.25]);
 for(const row of f.rows){const kernel=new out.UnityShapeRandomKernel(row.particles.length,true);kernel.reset(f.seed);kernel.beginBatch(row.particles.length,0,1,row.thickness,360,0);let max=0;
  for(let i=0;i<row.particles.length;i++){const radius=Math.hypot(kernel.values[i*6],kernel.values[i*6+1],kernel.values[i*6+2]);max=Math.max(max,Math.abs(radius-row.particles[i].radius));}
  assert.ok(max<.00005,JSON.stringify({thickness:row.thickness,max}));
 }
});
test('native radius profile is version gated and preserves analytic fallback',()=>{
 const shape={enable:true,shapeType:3,emitFrom:0,arcMode:0,arcSpread:0,randomDirectionAmount:0,sphericalDirectionAmount:0,randomPositionAmount:0,alignToDirection:false,radius:1,radiusThickness:1,arc:360,angle:0,emit(){}};
 const fallback=out.installUnityParticleShapeRandom({shapeModule:{...shape},capacity:8});assert.equal(fallback.radialApproximation,true);assert.equal(fallback.nativeRadiusVersion,null);
 const measured=out.installUnityParticleShapeRandom({shapeModule:{...shape},capacity:8},'6000.3.1f1');assert.equal(measured.radialApproximation,true);assert.equal(measured.nativeRadiusVersion,'6000.3.1f1');
});
test('Sphere/Hemisphere native directions with explicitly bounded analytic radius approximation',()=>{
 for(const name of ['shape-seed-matrix','shape-velocity-matrix']){
  const f=require('./fixtures/'+name+'.json');assert.equal(f.sourceProbeSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/capture-'+name+'.cs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'));
  const rows=f.rows.filter(r=>r.shape===0||r.shape===2);assert.equal(rows.length,72);
  for(const r of rows){const kernel=new out.UnityShapeRandomKernel(r.capacity);kernel.reset(r.seed);kernel.beginBatch(r.particles.length,r.shape,r.radius,r.thickness,r.arc,r.angle);
   for(let i=0;i<r.particles.length;i++)for(let axis=0;axis<3;axis++){
    const p=r.particles[i],v=kernel.values[i*6+3+axis],position=kernel.values[i*6+axis]+(p.velocity?v*p.age:0);
    assert.ok(Math.abs(position-p.position[axis])<r.radius*.007+2e-6,JSON.stringify({name,seed:r.seed,type:r.shape,i,axis,position,native:p.position[axis]}));
    if(p.velocity)assert.ok(Math.abs(v-p.velocity[axis])<2e-6,JSON.stringify({name,seed:r.seed,type:r.shape,i,axis,v,native:p.velocity[axis]}));
   }
  }
 }
});
for(const name of ['shape-seed-gameplay','shape-seed-matrix','shape-velocity-matrix'])test('native automatic Circle/Cone shape RNG '+name,()=>{
 const f=require('./fixtures/'+name+'.json');assert.equal(f.isPlaying,true);assert.match(f.driver,/no Emit or Simulate/);assert.equal(f.sourceProbeSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/capture-'+name+'.cs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'));
 for(const r of f.rows.filter(r=>r.shape===10||r.shape===4)){const kernel=new out.UnityShapeRandomKernel(r.capacity);kernel.reset(r.seed);kernel.beginBatch(r.particles.length,r.shape,r.radius??1,r.thickness??0,r.arc??360,r.angle??25);
  for(let i=0;i<r.particles.length;i++)for(let axis=0;axis<3;axis++){const p=r.particles[i],v=kernel.values[i*6+3+axis],position=kernel.values[i*6+axis]+(p.velocity?v*p.age:0);assert.ok(Math.abs(position-p.position[axis])<4e-6,JSON.stringify({name,seed:r.seed,type:r.shape,i,axis,position,native:p.position[axis]}));if(p.velocity)assert.ok(Math.abs(v-p.velocity[axis])<2e-6,JSON.stringify({name,seed:r.seed,type:r.shape,i,axis,v,native:p.velocity[axis]}));}
 }
});
test('unsupported shape streams retain their engine emitter',()=>{for(const extra of [{shapeType:0},{shapeType:5},{shapeType:2,emitFrom:3},{arcMode:1},{arcSpread:.25},{randomPositionAmount:.1},{alignToDirection:true}]){const shape={enable:true,shapeType:1,emitFrom:0,arcMode:0,randomDirectionAmount:0,sphericalDirectionAmount:0,randomPositionAmount:0,alignToDirection:false,radius:1,emit(){},...extra},emit=shape.emit;assert.equal(out.installUnityParticleShapeRandom({shapeModule:shape,capacity:16}),null);assert.equal(shape.emit,emit);}});

test('continuous automatic seed-to-position across six rates and clipped capacity',()=>{
 const f=require('./fixtures/shape-seed-continuous.json');assert.equal(f.isPlaying,true);assert.equal(f.rows.length,288);assert.equal(f.sourceProbeSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/capture-shape-seed-continuous.cs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'));
 const initial={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleStartRotation.ts'),'utf8'),{compilerOptions:{module:1}}).outputText)(initial,()=>({}));
 for(const type of [10,4])for(const rate of [60,100,120,200,1000,2000])for(const capacity of [16,128]){
  const shape=new out.UnityShapeRandomKernel(capacity),birth=new initial.UnityStartRotationKernel(capacity),positions=new Map();shape.reset(f.systemSeed);birth.reset(f.systemSeed);
  for(const row of f.rows.filter(r=>r.shape===type&&r.rate===rate&&r.capacity===capacity)){
   const count=row.particles.length-positions.size;
   if(count){shape.beginBatch(count,type,.75,Math.fround(.2),120,25);birth.beginBatch(count,false,false);for(let i=0;i<count;i++)positions.set(birth.birthSeed(i),Array.from(shape.values.slice(i*6,i*6+3)));}
   for(const p of row.particles){const pos=positions.get(p.seed);assert.ok(pos,'native seed exists');for(let axis=0;axis<3;axis++)assert.ok(Math.abs(pos[axis]-p.position[axis])<3e-6,JSON.stringify({type,rate,capacity,frame:row.frame,seed:p.seed,pos,native:p.position}));}
  }
 }
});

test('Sphere/Hemisphere continuous native seed identity with bounded radius approximation',()=>{
 const f=require('./fixtures/sphere-seed-continuous.json');assert.equal(f.isPlaying,true);assert.equal(f.rows.length,288);assert.equal(f.sourceProbeSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures/capture-sphere-seed-continuous.cs'),'utf8').replace(/\r\n/g,'\n')).digest('hex'));
 const initial={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'runtime/UnityParticleStartRotation.ts'),'utf8'),{compilerOptions:{module:1}}).outputText)(initial,()=>({}));
 for(const type of [0,2])for(const rate of [60,100,120,200,1000,2000])for(const capacity of [16,128]){
  const shape=new out.UnityShapeRandomKernel(capacity),birth=new initial.UnityStartRotationKernel(capacity),positions=new Map();shape.reset(f.systemSeed);birth.reset(f.systemSeed);
  for(const row of f.rows.filter(r=>r.shape===type&&r.rate===rate&&r.capacity===capacity)){
   const count=row.particles.length-positions.size;
   if(count){shape.beginBatch(count,type,.75,Math.fround(.2),120,25);birth.beginBatch(count,false,false);for(let i=0;i<count;i++)positions.set(birth.birthSeed(i),Array.from(shape.values.slice(i*6,i*6+3)));}
   for(const p of row.particles){const pos=positions.get(p.seed);assert.ok(pos,'native seed exists');for(let axis=0;axis<3;axis++)assert.ok(Math.abs(pos[axis]-p.position[axis])<.75*.007+3e-6,JSON.stringify({type,rate,capacity,frame:row.frame,seed:p.seed,pos,native:p.position}));}
  }
 }
});
